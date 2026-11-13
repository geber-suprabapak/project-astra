import { AppError } from '../../lib/errors/app-error.js'
import type {
  AdiwiyataEligibility,
  AppProviders,
  ClassRoom,
  IdentityRole,
  StudentRosterRow,
  UserProfile,
} from '../../providers/types.js'
import { configurationError, requireAdiwiyataAdmin } from './service-shared.js'

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
