import { AppError } from '../../lib/errors/app-error.js'
import { ErrorCode } from '../../lib/errors/codes.js'
import type { AppProviders, AttendanceRecord } from '../../providers/types.js'
import { getLeavePeriodFields } from '../../providers/types.js'

async function requireApprovedStudent(userId: string, providers: AppProviders): Promise<void> {
  const profile = await providers.domainStore.getUserProfile(userId)
  if (profile.role !== 'student' || profile.lifecycle_status !== 'approved') {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      403,
      'Only approved students can access attendance history.',
    )
  }
}

export async function getAttendanceHistory(params: {
  userId: string
  startDate?: string
  endDate?: string
  limit?: number
  providers: AppProviders
}): Promise<{ items: AttendanceRecord[]; total: number }> {
  await requireApprovedStudent(params.userId, params.providers)

  const all = await params.providers.domainStore.listAttendances({
    userId: params.userId,
    startDate: params.startDate,
    endDate: params.endDate,
    limit: 100,
  })
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 100)

  return {
    items: all.slice(0, limit),
    total: all.length,
  }
}

export async function getStudentAttendanceHistory(params: {
  userId: string
  startDate?: string
  endDate?: string
  limit?: number
  providers: AppProviders
}): Promise<{ items: AttendanceRecord[]; total: number }> {
  return getAttendanceHistory(params)
}

export async function getAttendanceCalendar(params: {
  userId: string
  year: number
  month: number
  providers: AppProviders
}): Promise<{
  year: number
  month: number
  start_date: string
  end_date: string
  stats: { hadir: number; terlambat: number; alpha: number; sakit: number; izin: number }
  items: Array<{
    date: string
    status: string
    check_in_time?: string
    check_out_time?: string
    is_late?: boolean
    attachment_url?: string | null
    holiday_reason?: string
  }>
}> {
  await requireApprovedStudent(params.userId, params.providers)
  const startDate = `${params.year}-${String(params.month).padStart(2, '0')}-01`
  const lastDay = new Date(Date.UTC(params.year, params.month, 0)).getUTCDate()
  const endDate = `${params.year}-${String(params.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  const [attendance, permits, exceptions] = await Promise.all([
    params.providers.domainStore.listAttendances({
      userId: params.userId,
      startDate,
      endDate,
      limit: 100,
    }),
    params.providers.domainStore.getPermitHistory(params.userId),
    params.providers.domainStore.listCalendarExceptions({ startDate, endDate }),
  ])
  const monthAttendance = attendance.filter(
    (record) => record.date >= startDate && record.date <= endDate,
  )
  const approvedPermits = permits.filter((permit) => permit.approval_status === 'approved')

  const items: Array<{
    date: string
    status: string
    check_in_time?: string
    check_out_time?: string
    is_late?: boolean
    attachment_url?: string | null
    holiday_reason?: string
  }> = []
  const byDate = new Map<string, AttendanceRecord[]>()
  for (const record of monthAttendance) {
    const records = byDate.get(record.date) ?? []
    records.push(record)
    byDate.set(record.date, records)
  }

  for (const [date, records] of byDate) {
    const checkIn = records.find(
      (record) =>
        record.action_type === 'check_in' ||
        record.status === 'Hadir' ||
        record.status === 'Terlambat' ||
        // SAFETY: Legacy records may have unnormalized status 'Datang'
        (record.status as string) === 'Datang',
    )
    const checkOut = records.find(
      (record) => record.action_type === 'check_out' || record.status === 'Pulang',
    )
    const late = records.some((record) => record.status === 'Terlambat')
    const absent = records.some((record) => record.status === 'Alpha')
    items.push({
      date,
      status: absent ? 'absent' : late ? 'late' : 'present',
      check_in_time: checkIn?.created_at,
      check_out_time: checkOut?.created_at,
      is_late: late,
    })
  }

  for (const permit of approvedPermits) {
    const period = getLeavePeriodFields({ ...permit, date: permit.tanggal })
    const firstDate =
      period.requested_start_date < startDate ? startDate : period.requested_start_date
    const effectiveEnd = period.effective_end_date ?? period.requested_start_date
    const lastDate = effectiveEnd > endDate ? endDate : effectiveEnd
    if (firstDate > lastDate) continue
    const attachmentUrl = permit.link_foto
      ? await params.providers.objectStorage.getSignedPermitUrl(permit.link_foto)
      : null
    const end = Date.parse(`${lastDate}T00:00:00Z`)
    for (let day = Date.parse(`${firstDate}T00:00:00Z`); day <= end; day += 86_400_000) {
      items.push({
        date: new Date(day).toISOString().slice(0, 10),
        status: permit.kategori_izin === 'sakit' ? 'sick' : 'leave',
        attachment_url: attachmentUrl,
      })
    }
  }

  for (const exception of exceptions) {
    if (exception.is_holiday) {
      items.push({
        date: exception.date,
        status: 'holiday',
        holiday_reason: exception.reason,
      })
    }
  }

  return {
    year: params.year,
    month: params.month,
    start_date: startDate,
    end_date: endDate,
    stats: {
      hadir: items.filter((item) => item.status === 'present').length,
      terlambat: items.filter((item) => item.status === 'late').length,
      alpha: items.filter((item) => item.status === 'absent').length,
      sakit: items.filter((item) => item.status === 'sick').length,
      izin: items.filter((item) => item.status === 'leave').length,
    },
    items: items.sort((a, b) => a.date.localeCompare(b.date)),
  }
}
