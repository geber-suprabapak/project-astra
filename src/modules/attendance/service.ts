import { AppError } from '../../lib/errors/app-error.js'
import { ErrorCode } from '../../lib/errors/codes.js'
import { defaultProviders } from '../../providers/index.js'
import type {
  AppProviders,
  AttendanceRecord,
  Schedule,
} from '../../providers/types.js'
import {
  getDayKeyWIB,
  getTodayWIB,
  getWIBDayBounds,
  computeAttendanceStatus,
  getScheduleWindowForAction,
  type ScheduleWindow,
} from '../dashboard/service.js'
import { computeActionType, computeInsertStatus } from './mapper.js'

// ---------------------------------------------------------------------------
// Shared gating logic (used by both precheck and submit)
// ---------------------------------------------------------------------------

interface CheckResult {
  schedule: 'pass' | 'fail'
  permit: 'pass' | 'fail'
  enrollment: 'pass' | 'fail'
  robin: 'pass' | 'fail'
}

interface GateResult {
  allowed: boolean
  actionType: 'check_in' | 'check_out' | null
  reason: string | null
  reasonCode: string | null
  locationName: string | null
  schedule: Schedule | null
  isLate: boolean
  window: ScheduleWindow | null
  todayWIB: string
  checks: CheckResult
}

export async function runGateChecks(
  params: {
    userId: string
    latitude: number
    longitude: number
    token: string
    requestId: string
    providers?: AppProviders
  },
  providers?: AppProviders,
): Promise<GateResult> {
  const actualProviders = params.providers ?? providers ?? defaultProviders
  const now = new Date()
  const todayWIB = getTodayWIB(now)
  const dayKey = getDayKeyWIB(now)
  const { startISO, endISO } = getWIBDayBounds(todayWIB)

  const defaults: CheckResult = {
    schedule: 'pass',
    permit: 'pass',
    enrollment: 'pass',
    robin: 'pass',
  }

  const [absences, activePermits, robinReady, enrollStatus, activePeriod] = await Promise.all([
    actualProviders.domainStore.getTodayAbsences(params.userId, todayWIB),
    actualProviders.domainStore.getActivePermitsToday(params.userId, startISO, endISO),
    actualProviders.robinClient.checkReadiness(),
    actualProviders.robinClient.getEnrollmentStatus(params.token, params.requestId).catch(() => ({
      status: 'not_enrolled' as const,
      embeddingCount: 0,
      message: 'Unavailable.',
    })),
    actualProviders.domainStore.getActiveAcademicPeriod(),
  ])

  const checks: CheckResult = { ...defaults }

  if (!robinReady.healthy) {
    checks.robin = 'fail'
    return {
      allowed: false,
      actionType: null,
      reason: 'Face recognition service unavailable.',
      reasonCode: 'DEPENDENCY_UNAVAILABLE',
      locationName: null,
      schedule: null,
      isLate: false,
      window: null,
      todayWIB,
      checks,
    }
  }

  if (enrollStatus.status !== 'enrolled') {
    checks.enrollment = 'fail'
    return {
      allowed: false,
      actionType: null,
      reason: 'Face enrollment is required.',
      reasonCode: 'ENROLLMENT_REQUIRED',
      locationName: null,
      schedule: null,
      isLate: false,
      window: null,
      todayWIB,
      checks,
    }
  }

  if (activePermits.length > 0) {
    checks.permit = 'fail'
    return {
      allowed: false,
      actionType: null,
      reason: 'You have an active permit for today.',
      reasonCode: 'ATTENDANCE_BLOCKED',
      locationName: null,
      schedule: null,
      isLate: false,
      window: null,
      todayWIB,
      checks,
    }
  }

  if (!activePeriod) {
    checks.schedule = 'fail'
    return {
      allowed: false,
      actionType: null,
      reason: 'No active academic period configured.',
      reasonCode: 'ATTENDANCE_BLOCKED',
      locationName: null,
      schedule: null,
      isLate: false,
      window: null,
      todayWIB,
      checks,
    }
  }

  const activeEnrollment = await actualProviders.domainStore.getActiveClassEnrollment(params.userId, activePeriod.id)
  if (!activeEnrollment) {
    checks.schedule = 'fail'
    return {
      allowed: false,
      actionType: null,
      reason: 'Student has no active class enrollment for the current academic period.',
      reasonCode: 'ATTENDANCE_BLOCKED',
      locationName: null,
      schedule: null,
      isLate: false,
      window: null,
      todayWIB,
      checks,
    }
  }

  const calendarException = await actualProviders.domainStore.getCalendarExceptionByDate(todayWIB, activePeriod.id)
  if (calendarException && calendarException.is_holiday) {
    checks.schedule = 'fail'
    return {
      allowed: false,
      actionType: null,
      reason: `Today is a scheduled calendar exception/holiday: ${calendarException.reason}`,
      reasonCode: 'ATTENDANCE_BLOCKED',
      locationName: null,
      schedule: null,
      isLate: false,
      window: null,
      todayWIB,
      checks,
    }
  }

  const schedule = await actualProviders.domainStore.getActiveSchedule(dayKey, {
    classId: activeEnrollment.class_id,
    academicPeriodId: activePeriod.id,
  })

  if (!schedule) {
    checks.schedule = 'fail'
    return {
      allowed: false,
      actionType: null,
      reason: 'No active schedule for today.',
      reasonCode: 'ATTENDANCE_BLOCKED',
      locationName: null,
      schedule: null,
      isLate: false,
      window: null,
      todayWIB,
      checks,
    }
  }

  const attendanceStatus = computeAttendanceStatus(absences)
  const actionTypeResult = computeActionType(attendanceStatus)

  if (actionTypeResult === 'done') {
    return {
      allowed: false,
      actionType: null,
      reason: 'Attendance for today is already complete.',
      reasonCode: 'ATTENDANCE_BLOCKED',
      locationName: null,
      schedule,
      isLate: false,
      window: null,
      todayWIB,
      checks,
    }
  }

  const { inWindow, isLate, window } = getScheduleWindowForAction(
    schedule,
    todayWIB,
    actionTypeResult,
  )

  if (!inWindow) {
    checks.schedule = 'fail'
    return {
      allowed: false,
      actionType: null,
      reason: 'Outside of attendance window.',
      reasonCode: 'ATTENDANCE_BLOCKED',
      locationName: null,
      schedule,
      isLate: false,
      window,
      todayWIB,
      checks,
    }
  }

  const rpcResult = await actualProviders.domainStore.validateAttendanceAction({
    userId: params.userId,
    latitude: params.latitude,
    longitude: params.longitude,
  })

  if (!rpcResult.actionable || rpcResult.action_type === 'none') {
    return {
      allowed: false,
      actionType: null,
      reason: rpcResult.message,
      reasonCode: 'ATTENDANCE_BLOCKED',
      locationName: rpcResult.details?.location_name ?? null,
      schedule,
      isLate: false,
      window,
      todayWIB,
      checks,
    }
  }

  if (rpcResult.action_type !== actionTypeResult) {
    return {
      allowed: false,
      actionType: null,
      reason: `Expected action type '${actionTypeResult}', got '${rpcResult.action_type}'.`,
      reasonCode: 'ATTENDANCE_BLOCKED',
      locationName: rpcResult.details?.location_name ?? null,
      schedule,
      isLate: false,
      window,
      todayWIB,
      checks,
    }
  }

  return {
    allowed: true,
    actionType: actionTypeResult,
    reason: null,
    reasonCode: null,
    locationName: rpcResult.details?.location_name ?? null,
    schedule,
    isLate: rpcResult.details?.status === 'Terlambat' ? true : isLate,
    window,
    todayWIB,
    checks,
  }
}

// ---------------------------------------------------------------------------
// Precheck
// ---------------------------------------------------------------------------

export interface PrecheckResult {
  allowed: boolean
  action_type: 'check_in' | 'check_out' | null
  location_name: string | null
  schedule_window: ScheduleWindow | null
  checks: CheckResult
  blocking_reason: string | null
}

export async function precheck(
  params: {
    userId: string
    latitude: number
    longitude: number
    token: string
    requestId: string
    providers?: AppProviders
  },
  providers?: AppProviders,
): Promise<PrecheckResult> {
  const actualProviders = params.providers ?? providers ?? defaultProviders
  const gate = await runGateChecks(params, actualProviders)
  return {
    allowed: gate.allowed,
    action_type: gate.actionType,
    location_name: gate.locationName,
    schedule_window: gate.window,
    checks: gate.checks,
    blocking_reason: gate.reason,
  }
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

export interface SubmitResult {
  attendance_type: string
  status_label: string
  processed_ms: number
}

export async function submit(
  params: {
    userId: string
    actionType: 'check_in' | 'check_out'
    imageBase64: string
    latitude: number
    longitude: number
    token: string
    requestId: string
    providers?: AppProviders
  },
  providers?: AppProviders,
): Promise<SubmitResult> {
  const actualProviders = params.providers ?? providers ?? defaultProviders

  // Re-run gate checks (do not skip)
  const gate = await runGateChecks(
    {
      userId: params.userId,
      latitude: params.latitude,
      longitude: params.longitude,
      token: params.token,
      requestId: params.requestId,
    },
    actualProviders,
  )

  if (!gate.allowed) {
    throw AppError.attendanceBlocked(gate.reason ?? 'Attendance not allowed.')
  }

  if (gate.actionType !== params.actionType) {
    throw AppError.attendanceBlocked(
      `Expected action type '${gate.actionType}', got '${params.actionType}'.`,
    )
  }

  // Verify enrollment before calling identify
  const enrollment = await actualProviders.robinClient.getEnrollmentStatus(
    params.token,
    params.requestId,
  )
  if (enrollment.status !== 'enrolled') {
    throw AppError.enrollmentRequired()
  }

  // Identify face — throws on network/timeout/503/400 or returns non-match / match
  const startMs = Date.now()
  let identifyResult: {
    status?: string
    confidence?: number
    qualityScore?: number
    processTimeMs?: number
    message?: string
  }

  try {
    identifyResult = await actualProviders.robinClient.identify(
      params.imageBase64,
      params.token,
      params.requestId,
    )
  } catch (err) {
    const elapsedMs = Date.now() - startMs
    if (err instanceof AppError && err.code === 'UPSTREAM_TIMEOUT') {
      await actualProviders.domainStore.recordAttendanceAttempt({
        userId: params.userId,
        actionType: params.actionType,
        status: 'error',
        reason: 'Face verification service timeout.',
        latitude: params.latitude,
        longitude: params.longitude,
        processTimeMs: elapsedMs,
      })
      throw err
    }

    if (err instanceof AppError && err.code === 'DEPENDENCY_UNAVAILABLE') {
      await actualProviders.domainStore.recordAttendanceAttempt({
        userId: params.userId,
        actionType: params.actionType,
        status: 'error',
        reason: 'Face verification service unavailable.',
        latitude: params.latitude,
        longitude: params.longitude,
        processTimeMs: elapsedMs,
      })
      throw err
    }

    const reason = err instanceof AppError ? err.message : 'Face verification error.'
    await actualProviders.domainStore.recordAttendanceAttempt({
      userId: params.userId,
      actionType: params.actionType,
      status: 'failed',
      reason,
      latitude: params.latitude,
      longitude: params.longitude,
      processTimeMs: elapsedMs,
    })
    throw err
  }

  const isMatch =
    !identifyResult.status ||
    identifyResult.status === 'ok' ||
    identifyResult.status === 'match' ||
    identifyResult.status === 'success'

  const processTimeMs = identifyResult.processTimeMs ?? (Date.now() - startMs)

  if (!isMatch) {
    const reason = identifyResult.message || 'Face does not match enrolled face.'
    await actualProviders.domainStore.recordAttendanceAttempt({
      userId: params.userId,
      actionType: params.actionType,
      status: 'failed',
      reason,
      confidence: identifyResult.confidence,
      qualityScore: identifyResult.qualityScore,
      latitude: params.latitude,
      longitude: params.longitude,
      processTimeMs,
    })
    throw AppError.attendanceBlocked(reason)
  }

  // Record successful attempt
  await actualProviders.domainStore.recordAttendanceAttempt({
    userId: params.userId,
    actionType: params.actionType,
    status: 'success',
    reason: identifyResult.message || 'Face verified successfully',
    confidence: identifyResult.confidence,
    qualityScore: identifyResult.qualityScore,
    latitude: params.latitude,
    longitude: params.longitude,
    processTimeMs,
  })

  // Persist attendance through DomainStore
  const saveResult = await actualProviders.domainStore.saveAttendanceRecord({
    userId: params.userId,
    actionType: params.actionType,
    latitude: params.latitude,
    longitude: params.longitude,
  })

  if (!saveResult.success) {
    throw AppError.internal(
      `Failed to save attendance record: ${saveResult.message ?? 'Unknown error.'}`,
    )
  }

  const insertStatus = computeInsertStatus(params.actionType, gate.isLate)

  return {
    attendance_type: params.actionType,
    status_label: insertStatus,
    processed_ms: processTimeMs,
  }
}
async function requireApprovedStudent(
  userId: string,
  providers: AppProviders,
): Promise<void> {
  const profile = await providers.domainStore.getUserProfile(userId)
  if (profile.role !== 'student' || profile.lifecycle_status !== 'approved') {
    throw new AppError(ErrorCode.FORBIDDEN, 403, 'Only approved students can access attendance history.')
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
    limit: 100,
  })
  const filtered = all.filter((record) => {
    if (params.startDate && record.date < params.startDate) return false
    if (params.endDate && record.date > params.endDate) return false
    return true
  })
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 100)

  return {
    items: filtered.slice(0, limit),
    total: filtered.length,
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
    params.providers.domainStore.listAttendances({ userId: params.userId, limit: 100 }),
    params.providers.domainStore.getPermitHistory(params.userId),
    params.providers.domainStore.listCalendarExceptions({ startDate, endDate }),
  ])
  const monthAttendance = attendance.filter((record) => record.date >= startDate && record.date <= endDate)
  const approvedPermits = permits.filter(
    (permit) =>
      permit.approval_status === 'approved' &&
      permit.tanggal.slice(0, 10) >= startDate &&
      permit.tanggal.slice(0, 10) <= endDate,
  )

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
    const checkIn = records.find((record) => record.action_type === 'check_in')
    const checkOut = records.find((record) => record.action_type === 'check_out')
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
    const date = permit.tanggal.slice(0, 10)
    const attachmentUrl = permit.link_foto
      ? await params.providers.objectStorage.getSignedPermitUrl(permit.link_foto)
      : null
    items.push({
      date,
      status: permit.kategori_izin === 'sakit' ? 'sick' : 'leave',
      attachment_url: attachmentUrl,
    })
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
      hadir: monthAttendance.filter((record) => record.status === 'Hadir').length > 0 ? 1 : 0,
      terlambat: monthAttendance.filter((record) => record.status === 'Terlambat').length > 0 ? 1 : 0,
      alpha: monthAttendance.filter((record) => record.status === 'Alpha').length > 0 ? 1 : 0,
      sakit: approvedPermits.filter((permit) => permit.kategori_izin === 'sakit').length,
      izin: approvedPermits.filter((permit) => permit.kategori_izin !== 'sakit').length,
    },
    items: items.sort((a, b) => a.date.localeCompare(b.date)),
  }
}
