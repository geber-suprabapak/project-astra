import { randomUUID } from 'node:crypto'
import { AppError } from '../../lib/errors/app-error.js'
import { ErrorCode } from '../../lib/errors/codes.js'
import { defaultProviders } from '../../providers/index.js'
import type { AdiwiyataReport, AdiwiyataSite, AppProviders } from '../../providers/types.js'
import { getTodayWIB } from '../dashboard/service.js'
import { getAdiwiyataReportUrl } from '../files/service.js'
import { createWatermarkedJpeg, decodeAdiwiyataImage, MAX_ADIWIYATA_OUTPUT_BYTES } from './image.js'
import {
  type AdiwiyataSchoolDay,
  configurationError,
  notEligible,
  schoolDayForClass,
} from './service-shared.js'

export interface AdiwiyataDashboard {
  date: string
  timezone: 'Asia/Jakarta'
  student: { full_name: string | null }
  academic_period: { id: string; name: string }
  class: { id: string; name: string }
  school_day: AdiwiyataSchoolDay
  sites: Array<
    Pick<AdiwiyataSite, 'id' | 'name' | 'category' | 'class_id' | 'sort_order'> & {
      coverage_status: 'not_scheduled' | 'missing' | 'reported' | 'verified'
      own_report: {
        id: string
        file_id: string
        report_date: string
        created_at: string
        file_created_at: string | null
        photo_url: string | null
      } | null
      can_report: boolean
    }
  >
}

export interface AdiwiyataStudentReportResponse {
  id: string
  site_id: string
  class_id: string
  file_id: string
  report_date: string
  created_at: string
  file_created_at: string | null
  photo_url: string | null
}

export async function getAdiwiyataDashboard(
  userId: string,
  providers: AppProviders = defaultProviders,
  now = new Date(),
): Promise<AdiwiyataDashboard> {
  const store = providers.domainStore
  const profile = await store.getUserProfile(userId)
  if (profile.role !== 'student' || profile.lifecycle_status !== 'approved') {
    throw notEligible(
      'Akun Adiwiyata hanya tersedia untuk profil Siswa Astra yang sudah disetujui. Hubungi admin sekolah bila status akun belum sesuai.',
    )
  }

  const eligibility = await store.getAdiwiyataEligibility(userId)
  if (!eligibility?.is_active) {
    throw notEligible(
      'Akses Adiwiyata belum diaktifkan untuk akun ini. Hubungi admin sekolah untuk meminta akses.',
    )
  }

  const periods = await store.listAcademicPeriods({ isActive: true })
  if (periods.length !== 1) {
    throw configurationError(
      'academic_period',
      'Astra harus memiliki tepat satu Periode Akademik aktif sebelum dashboard Adiwiyata dapat digunakan.',
      periods.length,
    )
  }
  const period = periods[0]!

  const enrollments = await store.listClassEnrollments({
    userId,
    academicPeriodId: period.id,
    status: 'active',
  })
  if (enrollments.length === 0) {
    throw notEligible(
      'Akun Siswa ini belum memiliki enrollment kelas aktif pada Periode Akademik saat ini. Hubungi admin sekolah.',
    )
  }
  if (enrollments.length !== 1) {
    throw configurationError(
      'class_enrollment',
      'Astra menemukan lebih dari satu enrollment kelas aktif untuk akun ini pada Periode Akademik saat ini. Admin sekolah perlu memperbaiki data enrollment.',
      enrollments.length,
    )
  }
  const enrollment = enrollments[0]!
  const currentClass = await store.getClassById(enrollment.class_id)
  if (
    !currentClass ||
    currentClass.school_id !== period.school_id ||
    currentClass.academic_period_id !== period.id
  ) {
    throw configurationError(
      'class',
      'Kelas pada enrollment aktif tidak cocok dengan sekolah atau Periode Akademik saat ini. Admin sekolah perlu memeriksa data kelas.',
    )
  }

  const date = getTodayWIB(now)
  const [exceptions, schedules] = await Promise.all([
    store.listCalendarExceptions({ startDate: date, endDate: date }),
    store.listSchedules({ academicPeriodId: period.id, isActive: true }),
  ])
  const schoolDay = schoolDayForClass(period, currentClass.id, schedules, exceptions, now)

  const sites = await store.listAdiwiyataSites({ schoolId: period.school_id, isActive: true })
  const visibleSites = sites
    .filter((site) => site.class_id === null || site.class_id === enrollment.class_id)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  const [classReports, ownReports] = await Promise.all([
    store.listAdiwiyataReports({ classId: currentClass.id, reportDate: date }),
    store.listAdiwiyataReports({
      reportedBy: userId,
      reportDate: date,
      siteIds: visibleSites.map((site) => site.id),
    }),
  ])
  const reportsBySite = new Map<string, AdiwiyataReport[]>()
  for (const report of classReports) {
    const reports = reportsBySite.get(report.site_id) ?? []
    reports.push(report)
    reportsBySite.set(report.site_id, reports)
  }
  const ownBySite = new Map(ownReports.map((report) => [report.site_id, report]))

  return {
    date,
    timezone: 'Asia/Jakarta',
    student: { full_name: profile.full_name },
    academic_period: { id: period.id, name: period.name },
    class: { id: currentClass.id, name: currentClass.name },
    school_day: schoolDay,
    sites: await Promise.all(
      visibleSites.map(async ({ id, name, category, class_id, sort_order }) => {
        const reports = reportsBySite.get(id) ?? []
        const own = ownBySite.get(id) ?? null
        const file = own ? await store.getFileRecord(own.file_id) : null
        return {
          id,
          name,
          category,
          class_id,
          sort_order,
          coverage_status: !schoolDay.is_school_day
            ? ('not_scheduled' as const)
            : reports.some((report) => report.verified_at !== null)
              ? ('verified' as const)
              : reports.length > 0
                ? ('reported' as const)
                : ('missing' as const),
          own_report: own
            ? {
                id: own.id,
                file_id: own.file_id,
                report_date: own.report_date,
                created_at: own.created_at,
                file_created_at: file?.created_at ?? null,
                photo_url: file
                  ? await getAdiwiyataReportUrl(file, providers, now.getTime())
                  : null,
              }
            : null,
          can_report:
            schoolDay.is_school_day &&
            own === null &&
            !reports.some((report) => report.verified_at !== null),
        }
      }),
    ),
  }
}

export async function submitAdiwiyataStudentReport(params: {
  userId: string
  siteId: string
  inputImage: Buffer
  declaredType: string
  providers: AppProviders
  now?: () => Date
}): Promise<AdiwiyataStudentReportResponse> {
  const decodedImage = await decodeAdiwiyataImage(params.inputImage, params.declaredType)
  const submittedAt = params.now?.() ?? new Date()
  const dashboard = await getAdiwiyataDashboard(params.userId, params.providers, submittedAt)
  const site = dashboard.sites.find((item) => item.id === params.siteId)
  if (!site) throw AppError.validationError('Site tidak aktif atau tidak terlihat untuk kelas ini.')
  if (!dashboard.school_day.is_school_day) {
    throw AppError.conflict('Laporan hanya dapat dikirim pada hari sekolah yang dijadwalkan.')
  }
  if (!site.can_report) {
    throw AppError.conflict('Laporan untuk Site ini sudah dikirim atau kelas sudah diverifikasi.')
  }
  const fullName = dashboard.student.full_name?.trim()
  if (!fullName) {
    throw configurationError(
      'profile_name',
      'Profil Siswa yang disetujui harus memiliki nama sebelum mengirim laporan.',
    )
  }

  const jpeg = await createWatermarkedJpeg({
    decodedImage,
    fullName,
    className: dashboard.class.name,
    submittedAt,
  })
  if (jpeg.length > MAX_ADIWIYATA_OUTPUT_BYTES) {
    throw AppError.validationError('Foto tetap melebihi batas 2 MB setelah diproses.')
  }

  const reportId = randomUUID()
  const objectPath = `reports/${reportId}.jpg`
  const file = await params.providers.domainStore.createFileRecord({
    userId: params.userId,
    purpose: 'adiwiyata_report',
    objectPath,
    contentType: 'image/jpeg',
    sizeBytes: jpeg.length,
    lifecycle: 'pending_upload',
  })

  let report: AdiwiyataReport | null = null
  let commitStarted = false
  try {
    await params.providers.objectStorage.uploadAdiwiyataReport(objectPath, jpeg)
    commitStarted = true
    report = await params.providers.domainStore.submitAdiwiyataReport({
      reportId,
      userId: params.userId,
      siteId: params.siteId,
      classId: dashboard.class.id,
      profileName: fullName,
      className: dashboard.class.name,
      reportDate: dashboard.date,
      createdAt: submittedAt.toISOString(),
      fileId: file.id,
      fileSizeBytes: jpeg.length,
    })
  } catch (error) {
    if (commitStarted) {
      try {
        report =
          (
            await params.providers.domainStore.listAdiwiyataReports({
              siteId: params.siteId,
              reportedBy: params.userId,
              reportDate: dashboard.date,
            })
          ).find((candidate) => candidate.file_id === file.id) ?? null
      } catch {
        throw AppError.internal(
          'Laporan mungkin sudah tersimpan. Muat ulang dashboard sebelum mencoba kembali.',
        )
      }
      const knownRejection =
        error instanceof AppError &&
        (error.httpStatus < 500 || error.code === ErrorCode.ADIWIYATA_CONFIGURATION_ERROR)
      if (!report && !knownRejection) {
        throw AppError.internal(
          'Status laporan belum dapat dipastikan. Muat ulang dashboard sebelum mencoba kembali.',
        )
      }
    }
    if (report) {
      // A commit acknowledgment can be lost; return the persisted report.
    } else {
      try {
        await params.providers.objectStorage.deleteObject('adiwiyata_report', objectPath)
        await params.providers.domainStore.updateFileLifecycle(file.id, 'deleted')
      } catch {
        throw AppError.storageUploadFailed()
      }
      throw error
    }
  }

  if (!report) throw AppError.internal('Failed to create Adiwiyata report.')

  const photoUrl = await getAdiwiyataReportUrl(
    { ...file, lifecycle: 'available' },
    params.providers,
    submittedAt.getTime(),
  )
  return {
    id: report.id,
    site_id: report.site_id,
    class_id: report.class_id,
    file_id: report.file_id,
    report_date: report.report_date,
    created_at: report.created_at,
    file_created_at: file.created_at ?? null,
    photo_url: photoUrl,
  }
}
