import { randomUUID } from 'node:crypto'
import { AppError } from '../../lib/errors/app-error.js'
import { ErrorCode } from '../../lib/errors/codes.js'
import { defaultProviders } from '../../providers/index.js'
import type {
  AppProviders,
  AdiwiyataReport,
  AdiwiyataEligibility,
  ClassRoom,
  AdiwiyataSite,
  AdiwiyataSiteCategory,
  IdentityRole,
  StudentRosterRow,
  UserProfile,
  AcademicPeriod,
  CalendarException,
  Schedule,
} from '../../providers/types.js'
import { getAdiwiyataReportUrl } from '../files/service.js'
import { getDayKeyWIB, getTodayWIB } from '../dashboard/service.js'
import { hasScope, logtoScopes } from '../../authz/scopes.js'
import { createWatermarkedJpeg, decodeAdiwiyataImage, MAX_ADIWIYATA_OUTPUT_BYTES } from './image.js'

export interface AdiwiyataDashboard {
  date: string
  timezone: 'Asia/Jakarta'
  student: { full_name: string | null }
  academic_period: { id: string; name: string }
  class: { id: string; name: string }
  school_day: {
    is_school_day: boolean
    status: 'scheduled' | 'not_scheduled' | 'holiday'
    reason: string | null
  }
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

function notEligible(message: string): AppError {
  return new AppError(ErrorCode.ADIWIYATA_NOT_ELIGIBLE, 403, message)
}

function configurationError(item: string, message: string, count?: number): AppError {
  const details =
    count === undefined
      ? { configuration_item: item }
      : { configuration_item: item, matching_rows: count }
  return new AppError(ErrorCode.ADIWIYATA_CONFIGURATION_ERROR, 503, message, details)
}

function schoolDayForClass(
  period: AcademicPeriod,
  classId: string,
  schedules: Schedule[],
  exceptions: CalendarException[],
  now: Date,
): AdiwiyataDashboard['school_day'] {
  const date = getTodayWIB(now)
  const periodSchedules = schedules.filter(
    (schedule) =>
      schedule.school_id === period.school_id &&
      schedule.academic_period_id === period.id &&
      schedule.is_active,
  )
  if (periodSchedules.length === 0) {
    throw configurationError(
      'schedule',
      'Belum ada jadwal aktif Astra untuk sekolah dan Periode Akademik ini. Admin sekolah perlu memeriksa konfigurasi jadwal.',
      0,
    )
  }
  const holiday = exceptions.find(
    (exception) =>
      exception.date === date &&
      exception.is_holiday &&
      (exception.academic_period_id == null || exception.academic_period_id === period.id) &&
      (exception.school_id == null || exception.school_id === period.school_id),
  )
  if (holiday) return { is_school_day: false, status: 'holiday', reason: holiday.reason }
  const daySchedules = periodSchedules.filter(
    (schedule) => (schedule.day_of_week ?? schedule.hari)?.toLowerCase() === getDayKeyWIB(now),
  )
  const classSchedules = daySchedules.filter((schedule) => schedule.class_id === classId)
  const matching = classSchedules.length
    ? classSchedules
    : daySchedules.filter((schedule) => schedule.class_id === null)
  if (matching.length > 1) {
    throw configurationError(
      'schedule',
      'Astra memiliki beberapa jadwal aktif pada tingkat kelas yang berlaku untuk hari ini. Admin sekolah perlu memeriksa konfigurasi jadwal.',
      matching.length,
    )
  }
  return {
    is_school_day: matching.length === 1,
    status: matching.length === 1 ? 'scheduled' : 'not_scheduled',
    reason: null,
  }
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

export interface AdiwiyataAdminSites {
  academic_period: { id: string; name: string; school_id: string }
  sites: AdiwiyataSite[]
}

function requireAdiwiyataAdmin(role: IdentityRole | null): void {
  if (role !== 'school_admin' && role !== 'platform_admin') throw AppError.forbidden()
}

async function getActiveSitePeriod(providers: AppProviders) {
  const periods = await providers.domainStore.listAcademicPeriods({ isActive: true })
  if (periods.length !== 1) {
    throw configurationError(
      'academic_period',
      'Astra harus memiliki tepat satu Periode Akademik aktif sebelum Site dapat dikelola.',
      periods.length,
    )
  }
  return periods[0]!
}

async function validateSiteClass(
  providers: AppProviders,
  period: Awaited<ReturnType<typeof getActiveSitePeriod>>,
  classId: string | null | undefined,
): Promise<void> {
  if (classId == null) return
  const classroom = await providers.domainStore.getClassById(classId)
  if (
    !classroom ||
    classroom.school_id !== period.school_id ||
    classroom.academic_period_id !== period.id
  ) {
    throw AppError.validationError({
      fieldErrors: {
        class_id: ['Kelas harus berasal dari Periode Akademik aktif dan sekolah yang sama.'],
      },
    })
  }
}

export async function listAdiwiyataAdminSites(params: {
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<AdiwiyataAdminSites> {
  requireAdiwiyataAdmin(params.actorRole)
  const period = await getActiveSitePeriod(params.providers)
  const sites = await params.providers.domainStore.listAdiwiyataSites({
    schoolId: period.school_id,
  })
  return {
    academic_period: { id: period.id, name: period.name, school_id: period.school_id },
    sites: sites.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
  }
}

export async function createAdiwiyataAdminSite(params: {
  name: string
  category: AdiwiyataSiteCategory
  classId?: string | null
  sortOrder: number
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<AdiwiyataSite> {
  requireAdiwiyataAdmin(params.actorRole)
  const period = await getActiveSitePeriod(params.providers)
  await validateSiteClass(params.providers, period, params.classId)
  return params.providers.domainStore.createAdiwiyataSite({
    schoolId: period.school_id,
    name: params.name,
    category: params.category,
    classId: params.classId,
    sortOrder: params.sortOrder,
    createdBy: params.actorId,
  })
}

export async function updateAdiwiyataAdminSite(params: {
  id: string
  name?: string
  category?: AdiwiyataSiteCategory
  classId?: string | null
  sortOrder?: number
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<AdiwiyataSite> {
  requireAdiwiyataAdmin(params.actorRole)
  const period = await getActiveSitePeriod(params.providers)
  await validateSiteClass(params.providers, period, params.classId)
  const site = await params.providers.domainStore.updateAdiwiyataSite(params.id, period.school_id, {
    name: params.name,
    category: params.category,
    classId: params.classId,
    sortOrder: params.sortOrder,
  })
  if (!site) throw AppError.notFound('Adiwiyata Site')
  return site
}

export async function deactivateAdiwiyataAdminSite(params: {
  id: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<AdiwiyataSite> {
  requireAdiwiyataAdmin(params.actorRole)
  const period = await getActiveSitePeriod(params.providers)
  const site = await params.providers.domainStore.updateAdiwiyataSite(params.id, period.school_id, {
    isActive: false,
  })
  if (!site) throw AppError.notFound('Adiwiyata Site')
  return site
}

export type AdiwiyataEligibilityReason =
  | 'profile_missing'
  | 'not_student'
  | 'not_approved'
  | 'active_period_unavailable'
  | 'no_active_enrollment'
  | 'ambiguous_active_enrollment'
  | 'class_not_in_current_period'

export interface AdiwiyataStudentAccessView {
  user_id: string
  full_name: string | null
  email: string | null
  nis: string | null
  role: IdentityRole | null
  lifecycle_status: UserProfile['lifecycle_status'] | null
  current_class: { id: string; name: string } | null
  can_grant: boolean
  reason: AdiwiyataEligibilityReason | null
  eligibility: AdiwiyataEligibility | null
}

export interface AdiwiyataAdminEligibility {
  academic_period: { id: string; name: string; school_id: string } | null
  period_warning: string | null
  students: AdiwiyataStudentAccessView[]
  eligibility: Array<Omit<AdiwiyataStudentAccessView, 'eligibility'> & AdiwiyataEligibility>
}

function eligibilityPeriodWarning(count: number): string {
  return count === 1
    ? ''
    : 'Astra harus memiliki tepat satu Periode Akademik aktif sebelum akses siswa dapat diberikan.'
}

export async function listAdiwiyataAdminEligibility(params: {
  actorRole: IdentityRole | null
  query?: string
  providers: AppProviders
}): Promise<AdiwiyataAdminEligibility> {
  requireAdiwiyataAdmin(params.actorRole)

  const store = params.providers.domainStore
  const [periods, roster, grants] = await Promise.all([
    store.listAcademicPeriods({ isActive: true }),
    store.listStudentProfiles(),
    store.listAdiwiyataEligibility(),
  ])
  const period = periods.length === 1 ? periods[0]! : null
  const grouped = new Map<string, StudentRosterRow[]>()
  for (const row of roster) {
    if (!row.user_id) continue
    const entries = grouped.get(row.user_id) ?? []
    entries.push(row)
    grouped.set(row.user_id, entries)
  }
  const grantByUser = new Map(grants.map((grant) => [grant.user_id, grant]))
  const classCache = new Map<string, Promise<ClassRoom | null>>()

  const buildView = async (
    userId: string,
    rows: StudentRosterRow[],
    grant: AdiwiyataEligibility | null,
  ): Promise<AdiwiyataStudentAccessView> => {
    const row = rows[0]
    let profile: UserProfile | null = null
    if (!row || row.role == null || row.lifecycle_status == null) {
      try {
        profile = await store.getUserProfile(userId)
      } catch (error) {
        if (!(error instanceof AppError) || error.httpStatus !== 404) throw error
      }
    }
    const role = profile?.role ?? row?.role ?? null
    const lifecycleStatus = profile?.lifecycle_status ?? row?.lifecycle_status ?? null
    let reason: AdiwiyataEligibilityReason | null = null
    let currentClass: AdiwiyataStudentAccessView['current_class'] = null

    if (!row && !profile) reason = 'profile_missing'
    else if (role !== 'student') reason = 'not_student'
    else if (lifecycleStatus !== 'approved') reason = 'not_approved'
    else if (!period) reason = 'active_period_unavailable'
    else {
      const activeRows = rows.filter((entry) => entry.academic_period_id === period.id)
      if (activeRows.length === 0) reason = 'no_active_enrollment'
      else if (activeRows.length !== 1) reason = 'ambiguous_active_enrollment'
      else {
        const classId = activeRows[0]!.class_id
        if (!classId) reason = 'class_not_in_current_period'
        else {
          let pendingClass = classCache.get(classId)
          if (!pendingClass) {
            pendingClass = store.getClassById(classId)
            classCache.set(classId, pendingClass)
          }
          const classroom = await pendingClass
          if (
            !classroom ||
            classroom.school_id !== period.school_id ||
            classroom.academic_period_id !== period.id
          ) {
            reason = 'class_not_in_current_period'
          } else currentClass = { id: classroom.id, name: classroom.name }
        }
      }
    }

    return {
      user_id: userId,
      full_name: profile?.full_name ?? row?.full_name ?? null,
      email: profile?.email ?? row?.email ?? null,
      nis: profile?.nis ?? row?.nis ?? null,
      role,
      lifecycle_status: lifecycleStatus,
      current_class: currentClass,
      can_grant: reason === null,
      reason,
      eligibility: grant,
    }
  }

  const grantViews = await Promise.all(
    grants.map(async (grant) => {
      const view = await buildView(grant.user_id, grouped.get(grant.user_id) ?? [], grant)
      return {
        full_name: view.full_name,
        email: view.email,
        nis: view.nis,
        role: view.role,
        lifecycle_status: view.lifecycle_status,
        current_class: view.current_class,
        can_grant: view.can_grant,
        reason: view.reason,
        ...grant,
      }
    }),
  )
  const query = params.query?.trim().toLocaleLowerCase() ?? ''
  const students = query
    ? await Promise.all(
        [...grouped.entries()]
          .filter(([, rows]) =>
            rows.some((row) =>
              [row.full_name, row.email, row.nis, row.user_id].some((value) =>
                value?.toLocaleLowerCase().includes(query),
              ),
            ),
          )
          .map(([userId, rows]) => buildView(userId, rows, grantByUser.get(userId) ?? null)),
      )
    : []

  return {
    academic_period: period
      ? { id: period.id, name: period.name, school_id: period.school_id }
      : null,
    period_warning: period ? null : eligibilityPeriodWarning(periods.length),
    students: students.sort(
      (a, b) =>
        (a.full_name ?? '').localeCompare(b.full_name ?? '') || a.user_id.localeCompare(b.user_id),
    ),
    eligibility: grantViews,
  }
}

export async function grantAdiwiyataEligibility(params: {
  userId: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<AdiwiyataEligibility> {
  requireAdiwiyataAdmin(params.actorRole)
  const store = params.providers.domainStore
  const profile = await store.getUserProfile(params.userId)
  if (profile.role !== 'student') {
    throw AppError.validationError({
      fieldErrors: { user_id: ['Akses hanya dapat diberikan kepada profil Siswa Astra.'] },
    })
  }
  if (profile.lifecycle_status !== 'approved') {
    throw AppError.validationError({
      fieldErrors: {
        user_id: ['Profil Siswa Astra harus berstatus approved sebelum diberi akses.'],
      },
    })
  }

  const periods = await store.listAcademicPeriods({ isActive: true })
  if (periods.length !== 1) {
    throw configurationError(
      'academic_period',
      eligibilityPeriodWarning(periods.length),
      periods.length,
    )
  }
  const period = periods[0]!
  const enrollments = await store.listClassEnrollments({
    userId: params.userId,
    academicPeriodId: period.id,
    status: 'active',
  })
  if (enrollments.length === 0) {
    throw AppError.validationError({
      fieldErrors: {
        user_id: ['Siswa belum memiliki enrollment aktif pada Periode Akademik saat ini.'],
      },
    })
  }
  if (enrollments.length !== 1) {
    throw configurationError(
      'class_enrollment',
      'Astra menemukan lebih dari satu enrollment kelas aktif untuk siswa ini pada Periode Akademik saat ini.',
      enrollments.length,
    )
  }
  const enrollment = enrollments[0]!
  const classroom = await store.getClassById(enrollment.class_id)
  if (
    !classroom ||
    classroom.school_id !== period.school_id ||
    classroom.academic_period_id !== period.id
  ) {
    throw configurationError(
      'class',
      'Kelas pada enrollment aktif tidak cocok dengan sekolah atau Periode Akademik saat ini.',
    )
  }
  return store.upsertAdiwiyataEligibility(params.userId, params.actorId)
}

export async function revokeAdiwiyataEligibility(params: {
  id: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<AdiwiyataEligibility> {
  requireAdiwiyataAdmin(params.actorRole)
  const eligibility = await params.providers.domainStore.setAdiwiyataEligibilityActive(
    params.id,
    false,
  )
  if (!eligibility) throw AppError.notFound('Adiwiyata eligibility')
  return eligibility
}

export interface AdiwiyataAdminReportView {
  id: string
  site_id: string
  site_name: string
  category: AdiwiyataSiteCategory
  class_id: string
  class_name: string
  reported_by: string
  uploader_name: string | null
  file_id: string
  file_created_at: string | null
  report_date: string
  created_at: string
  verified_at: string | null
  verified_by: string | null
  photo_url: string | null
}

export interface AdiwiyataAdminReportList {
  date: string
  today: string
  timezone: 'Asia/Jakarta'
  can_view_photos: boolean
  reports: AdiwiyataAdminReportView[]
  coverage: AdiwiyataAdminCoverage[]
  filter_options: {
    classes: Array<{ id: string; name: string }>
    sites: Array<{ id: string; name: string }>
  }
}

export interface AdiwiyataAdminCoverage {
  class_id: string
  class_name: string
  site_id: string
  site_name: string
  category: AdiwiyataSiteCategory
  coverage_status: 'not_scheduled' | 'missing' | 'reported' | 'verified'
  photo_count: number
  reason: string | null
}

export async function listAdiwiyataAdminReports(params: {
  actorRole: IdentityRole | null
  userScopes?: readonly string[]
  date?: string
  classId?: string
  siteId?: string
  providers: AppProviders
  now?: Date
}): Promise<AdiwiyataAdminReportList> {
  requireAdiwiyataAdmin(params.actorRole)
  const period = await getActiveSitePeriod(params.providers)
  const today = getTodayWIB(params.now)
  const date = params.date ?? today
  const canViewPhotos = hasScope(params.userScopes, logtoScopes.filesReadAny)
  const store = params.providers.domainStore
  const allReports = await store.listAdiwiyataAdminReports({
    schoolId: period.school_id,
    reportDate: date,
  })
  const pairs = new Map<string, AdiwiyataAdminCoverage>()
  for (const report of allReports) {
    const key = `${report.class_id}:${report.site_id}`
    const pair = pairs.get(key) ?? {
      class_id: report.class_id,
      class_name: report.class_name,
      site_id: report.site_id,
      site_name: report.site_name,
      category: report.category,
      coverage_status: 'reported',
      photo_count: 0,
      reason: null,
    }
    pair.photo_count++
    if (report.verified_at !== null) pair.coverage_status = 'verified'
    pairs.set(key, pair)
  }
  if (date === today) {
    const [access, sites, schedules, exceptions] = await Promise.all([
      listAdiwiyataAdminEligibility({ actorRole: params.actorRole, providers: params.providers }),
      store.listAdiwiyataSites({ schoolId: period.school_id, isActive: true }),
      store.listSchedules({ academicPeriodId: period.id, isActive: true }),
      store.listCalendarExceptions({ startDate: date, endDate: date }),
    ])
    const classes = new Map<string, { id: string; name: string }>()
    for (const student of access.eligibility) {
      if (!student.is_active) continue
      if (
        student.reason === 'ambiguous_active_enrollment' ||
        student.reason === 'class_not_in_current_period'
      ) {
        throw configurationError(
          'class_enrollment',
          'Enrollment siswa dengan akses Adiwiyata perlu diperbaiki sebelum cakupan harian dapat dihitung.',
        )
      }
      if (student.can_grant && student.current_class)
        classes.set(student.current_class.id, student.current_class)
    }
    for (const classroom of classes.values()) {
      const schoolDay = schoolDayForClass(
        period,
        classroom.id,
        schedules,
        exceptions,
        params.now ?? new Date(),
      )
      for (const site of sites) {
        if (site.class_id !== null && site.class_id !== classroom.id) continue
        const key = `${classroom.id}:${site.id}`
        const existing = pairs.get(key)
        pairs.set(key, {
          class_id: classroom.id,
          class_name: classroom.name,
          site_id: site.id,
          site_name: site.name,
          category: site.category,
          coverage_status: !schoolDay.is_school_day
            ? 'not_scheduled'
            : (existing?.coverage_status ?? 'missing'),
          photo_count: existing?.photo_count ?? 0,
          reason: schoolDay.reason,
        })
      }
    }
  }
  const allCoverage = [...pairs.values()].sort(
    (a, b) =>
      a.class_name.localeCompare(b.class_name, 'id') ||
      a.site_name.localeCompare(b.site_name, 'id'),
  )
  const filter = (row: { class_id: string; site_id: string }) =>
    (!params.classId || row.class_id === params.classId) &&
    (!params.siteId || row.site_id === params.siteId)
  const reports = allReports.filter(filter)
  const classes = new Map(allCoverage.map((pair) => [pair.class_id, pair.class_name]))
  const sites = new Map(allCoverage.map((pair) => [pair.site_id, pair.site_name]))
  const choices = (names: Map<string, string>) =>
    [...names]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'id'))

  return {
    date,
    today,
    timezone: 'Asia/Jakarta',
    can_view_photos: canViewPhotos,
    coverage: allCoverage.filter(filter),
    filter_options: { classes: choices(classes), sites: choices(sites) },
    reports: await Promise.all(
      reports.map(async (report) => ({
        id: report.id,
        site_id: report.site_id,
        site_name: report.site_name,
        category: report.category,
        class_id: report.class_id,
        class_name: report.class_name,
        reported_by: report.reported_by,
        uploader_name: report.uploader_name,
        file_id: report.file_id,
        file_created_at: report.photo_file?.created_at ?? null,
        report_date: report.report_date,
        created_at: report.created_at,
        verified_at: report.verified_at,
        verified_by: report.verified_by,
        photo_url:
          canViewPhotos && report.photo_file
            ? await getAdiwiyataReportUrl(
                report.photo_file,
                params.providers,
                params.now?.getTime(),
              )
            : null,
      })),
    ),
  }
}

export interface AdiwiyataAdminReportMutation {
  report: Pick<
    AdiwiyataReport,
    | 'id'
    | 'site_id'
    | 'class_id'
    | 'file_id'
    | 'report_date'
    | 'created_at'
    | 'verified_at'
    | 'verified_by'
  >
  coverage_status: 'reported' | 'verified'
}

export async function setAdiwiyataAdminReportVerification(params: {
  reportId: string
  verified: boolean
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
  now?: () => Date
}): Promise<AdiwiyataAdminReportMutation> {
  requireAdiwiyataAdmin(params.actorRole)
  const period = await getActiveSitePeriod(params.providers)
  const result = await params.providers.domainStore.updateAdiwiyataReportVerification({
    reportId: params.reportId,
    schoolId: period.school_id,
    actorId: params.actorId,
    verified: params.verified,
    at: (params.now?.() ?? new Date()).toISOString(),
  })
  if (!result) throw AppError.notFound('Adiwiyata report')
  return {
    report: {
      id: result.report.id,
      site_id: result.report.site_id,
      class_id: result.report.class_id,
      file_id: result.report.file_id,
      report_date: result.report.report_date,
      created_at: result.report.created_at,
      verified_at: result.report.verified_at,
      verified_by: result.report.verified_by,
    },
    coverage_status: result.coverage_status,
  }
}
