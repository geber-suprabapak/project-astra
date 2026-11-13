import { hasScope, logtoScopes } from '../../authz/scopes.js'
import { AppError } from '../../lib/errors/app-error.js'
import type {
  AdiwiyataReport,
  AdiwiyataSiteCategory,
  AppProviders,
  IdentityRole,
} from '../../providers/types.js'
import { getTodayWIB } from '../dashboard/service.js'
import { getAdiwiyataReportUrl } from '../files/service.js'
import { listAdiwiyataAdminEligibility } from './admin-eligibility-service.js'
import {
  configurationError,
  getActiveSitePeriod,
  requireAdiwiyataAdmin,
  schoolDayForClass,
} from './service-shared.js'

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
