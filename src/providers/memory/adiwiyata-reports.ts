import { AppError } from '../../lib/errors/app-error.js'
import { ErrorCode } from '../../lib/errors/codes.js'
import { adiwiyataReportLockName } from '../adiwiyata-lock.js'
import type {
  AdiwiyataReport,
  AdiwiyataReportVerificationParams,
  AdiwiyataReportVerificationResult,
  SubmitAdiwiyataReportParams,
} from '../types.js'
import type { MemoryDomainState } from './domain-state.js'

async function lockAdiwiyataReportPair(
  locks: Map<string, Promise<void>>,
  classId: string,
  siteId: string,
  reportDate: string,
): Promise<() => void> {
  const lockName = adiwiyataReportLockName(classId, siteId, reportDate)
  const previous = locks.get(lockName) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  locks.set(lockName, current)
  await previous
  return () => {
    release()
    if (locks.get(lockName) === current) locks.delete(lockName)
  }
}

function adiwiyataReportsForPair(
  store: MemoryDomainState,
  report: AdiwiyataReport,
): AdiwiyataReport[] {
  return Array.from(store.adiwiyataReports.values()).filter(
    (item) =>
      item.class_id === report.class_id &&
      item.site_id === report.site_id &&
      item.report_date === report.report_date,
  )
}

export async function updateMemoryAdiwiyataReportVerification(
  store: MemoryDomainState,
  locks: Map<string, Promise<void>>,
  params: AdiwiyataReportVerificationParams,
): Promise<AdiwiyataReportVerificationResult | null> {
  const initial = store.adiwiyataReports.get(params.reportId)
  if (!initial) return null
  const release = await lockAdiwiyataReportPair(
    locks,
    initial.class_id,
    initial.site_id,
    initial.report_date,
  )
  try {
    const report = store.adiwiyataReports.get(params.reportId)
    const site = report ? store.adiwiyataSites.get(report.site_id) : null
    const classroom = report ? store.classes.find((item) => item.id === report.class_id) : null
    if (
      !report ||
      !site ||
      site.school_id !== params.schoolId ||
      !classroom ||
      classroom.school_id !== params.schoolId
    )
      return null

    const alreadySet = params.verified ? report.verified_at !== null : report.verified_at === null
    if (alreadySet) {
      return {
        report: { ...report },
        coverage_status: adiwiyataReportsForPair(store, report).some(
          (item) => item.verified_at !== null,
        )
          ? 'verified'
          : 'reported',
        changed: false,
      }
    }

    const previous = { ...report }
    const existingAuditIds = new Set(store.auditLogs.map((item) => item.id))
    report.verified_at = params.verified ? params.at : null
    report.verified_by = params.verified ? params.actorId : null
    const action = params.verified ? 'verify' : 'unverify'
    const details = {
      site_id: report.site_id,
      class_id: report.class_id,
      report_date: report.report_date,
      prior_verified_at: previous.verified_at,
      prior_verified_by: previous.verified_by,
      next_verified_at: report.verified_at,
      next_verified_by: report.verified_by,
    }
    try {
      await store.insertAuditLog({
        actor_id: params.actorId,
        action,
        entity_type: 'adiwiyata_report',
        entity_id: report.id,
        details,
      })
    } catch (error) {
      store.adiwiyataReports.set(report.id, previous)
      const failedAuditIndex = store.auditLogs.findIndex(
        (item) =>
          !existingAuditIds.has(item.id) &&
          item.actor_id === params.actorId &&
          item.action === action &&
          item.entity_type === 'adiwiyata_report' &&
          item.entity_id === report.id &&
          JSON.stringify(item.details) === JSON.stringify(details),
      )
      if (failedAuditIndex >= 0) store.auditLogs.splice(failedAuditIndex, 1)
      throw error
    }

    return {
      report: { ...report },
      coverage_status: adiwiyataReportsForPair(store, report).some(
        (item) => item.verified_at !== null,
      )
        ? 'verified'
        : 'reported',
      changed: true,
    }
  } finally {
    release()
  }
}

export async function submitMemoryAdiwiyataReport(
  store: MemoryDomainState,
  locks: Map<string, Promise<void>>,
  params: SubmitAdiwiyataReportParams,
): Promise<AdiwiyataReport> {
  const release = await lockAdiwiyataReportPair(
    locks,
    params.classId,
    params.siteId,
    params.reportDate,
  )

  try {
    const profile = store.profiles.get(params.userId)
    if (profile?.role !== 'student' || profile.lifecycle_status !== 'approved') {
      throw new AppError(
        ErrorCode.ADIWIYATA_NOT_ELIGIBLE,
        403,
        'Akun Siswa tidak lagi memenuhi syarat Adiwiyata.',
      )
    }
    if (!store.adiwiyataEligibility.get(params.userId)?.is_active) {
      throw new AppError(ErrorCode.ADIWIYATA_NOT_ELIGIBLE, 403, 'Akses Adiwiyata tidak lagi aktif.')
    }
    const periods = store.academicPeriods.filter((period) => period.is_active)
    if (periods.length !== 1) {
      throw new AppError(
        ErrorCode.ADIWIYATA_CONFIGURATION_ERROR,
        503,
        'Astra harus memiliki tepat satu Periode Akademik aktif.',
      )
    }
    const period = periods[0]!
    const enrollments = store.classEnrollments.filter(
      (enrollment) =>
        enrollment.user_id === params.userId &&
        enrollment.academic_period_id === period.id &&
        enrollment.status === 'active',
    )
    if (enrollments.length !== 1 || enrollments[0]!.class_id !== params.classId) {
      throw AppError.conflict(
        'Enrollment Siswa berubah. Muat ulang dashboard sebelum mengirim foto.',
      )
    }
    const classroom = store.classes.find((item) => item.id === params.classId)
    if (
      !classroom ||
      classroom.school_id !== period.school_id ||
      classroom.academic_period_id !== period.id ||
      classroom.name !== params.className ||
      profile.full_name?.trim() !== params.profileName
    ) {
      throw AppError.conflict(
        'Profil atau kelas berubah. Muat ulang dashboard sebelum mengirim foto.',
      )
    }
    const site = store.adiwiyataSites.get(params.siteId)
    if (
      !site ||
      !site.is_active ||
      site.school_id !== period.school_id ||
      (site.class_id !== null && site.class_id !== params.classId)
    ) {
      throw AppError.validationError('Site tidak aktif atau tidak terlihat untuk kelas ini.')
    }
    const dayKey = new Intl.DateTimeFormat('id-ID', { weekday: 'long', timeZone: 'Asia/Jakarta' })
      .format(new Date(`${params.reportDate}T12:00:00+07:00`))
      .toLowerCase()
    const schedules = Array.from(store.schedules.values()).filter(
      (schedule) =>
        schedule.school_id === period.school_id &&
        schedule.academic_period_id === period.id &&
        schedule.is_active,
    )
    if (schedules.length === 0) {
      throw new AppError(
        ErrorCode.ADIWIYATA_CONFIGURATION_ERROR,
        503,
        'Belum ada jadwal aktif untuk sekolah dan Periode Akademik ini.',
      )
    }
    const exceptions = Array.from(store.calendarExceptions.values()).some(
      (exception) =>
        exception.date === params.reportDate &&
        exception.is_holiday &&
        (exception.school_id === null || exception.school_id === period.school_id) &&
        (exception.academic_period_id === null || exception.academic_period_id === period.id),
    )
    const matching = schedules.filter(
      (schedule) => (schedule.day_of_week ?? schedule.hari).toLowerCase() === dayKey,
    )
    const classSchedules = matching.filter((schedule) => schedule.class_id === params.classId)
    const applicable =
      classSchedules.length > 0
        ? classSchedules
        : matching.filter((schedule) => schedule.class_id === null)
    if (applicable.length > 1) {
      throw new AppError(
        ErrorCode.ADIWIYATA_CONFIGURATION_ERROR,
        503,
        'Ada beberapa jadwal aktif pada tingkat kelas yang berlaku untuk hari ini.',
      )
    }
    if (exceptions || applicable.length !== 1) {
      throw AppError.conflict('Laporan hanya dapat dikirim pada hari sekolah yang dijadwalkan.')
    }
    if (
      Array.from(store.adiwiyataReports.values()).some(
        (report) =>
          report.reported_by === params.userId &&
          report.site_id === params.siteId &&
          report.report_date === params.reportDate,
      )
    ) {
      throw AppError.conflict(
        'Siswa sudah mengirim laporan untuk Site ini pada tanggal WIB tersebut.',
      )
    }
    if (
      Array.from(store.adiwiyataReports.values()).some(
        (report) =>
          report.class_id === params.classId &&
          report.site_id === params.siteId &&
          report.report_date === params.reportDate &&
          report.verified_at !== null,
      )
    ) {
      throw AppError.conflict('Laporan kelas untuk Site ini sudah diverifikasi dan ditutup.')
    }
    const file = store.files.get(params.fileId)
    if (
      !file ||
      file.user_id !== params.userId ||
      file.purpose !== 'adiwiyata_report' ||
      file.lifecycle !== 'pending_upload'
    ) {
      throw AppError.internal('Metadata foto laporan tidak tersedia.')
    }
    if (
      Array.from(store.adiwiyataReports.values()).some((report) => report.file_id === params.fileId)
    ) {
      throw AppError.conflict('Metadata foto ini sudah digunakan oleh laporan lain.')
    }

    const report: AdiwiyataReport = {
      id: params.reportId,
      site_id: params.siteId,
      class_id: params.classId,
      reported_by: params.userId,
      file_id: params.fileId,
      report_date: params.reportDate,
      created_at: new Date(params.createdAt).toISOString(),
      verified_at: null,
      verified_by: null,
    }
    store.adiwiyataReports.set(report.id, report)
    store.files.set(file.id, {
      ...file,
      size_bytes: params.fileSizeBytes,
      lifecycle: 'available',
      updated_at: report.created_at,
    })
    return { ...report }
  } finally {
    release()
  }
}
