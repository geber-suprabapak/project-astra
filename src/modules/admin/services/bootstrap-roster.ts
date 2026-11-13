import { AppError } from '../../../lib/errors/app-error.js'
import type {
  AppProviders,
  BootstrapStatus,
  IdentityRole,
  IdentityUser,
  ProfileLifecycleStatus,
  RejectedRosterRow,
  RosterReport,
  RosterRowInput,
  School,
  UserProfile,
} from '../../../providers/types.js'
import { privilegedSessionSchema, type PrivilegedSession } from '../schema.js'
import { assertAdminAccess, assertPlatformAdmin } from './shared.js'

export function getPrivilegedSession(params: {
  userId: string
  profileRole: IdentityRole | null
  profileStatus: ProfileLifecycleStatus
  identityUser: IdentityUser
}): PrivilegedSession {
  return privilegedSessionSchema.parse({
    user_id: params.userId,
    role: params.profileRole,
    profile_status: params.profileStatus,
    mfa_verified: params.identityUser.mfaVerified === true,
    must_change_password: params.identityUser.mustChangePassword === true,
  })
}

export async function getBootstrapStatus(providers: AppProviders): Promise<BootstrapStatus> {
  return providers.domainStore.getBootstrapStatus()
}

export async function bootstrapSchool(params: {
  name: string
  slug: string
  timezone?: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<School> {
  assertPlatformAdmin(params.actorRole)

  const existing = await params.providers.domainStore.getSchool()
  if (existing) {
    throw AppError.conflict('A school has already been configured for this deployment.')
  }

  const school = await params.providers.domainStore.createSchool({
    name: params.name,
    slug: params.slug,
    timezone: params.timezone ?? 'Asia/Jakarta',
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'bootstrap_school',
    entity_type: 'school',
    entity_id: school.id,
    details: { name: school.name, slug: school.slug, timezone: school.timezone },
  })

  return school
}

export async function createSchoolAdmin(params: {
  userId: string
  fullName?: string | null
  email?: string | null
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<UserProfile> {
  assertPlatformAdmin(params.actorRole)

  const profile = await params.providers.domainStore.createInitialSchoolAdmin({
    userId: params.userId,
    fullName: params.fullName,
    email: params.email,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'create_school_admin',
    entity_type: 'profile',
    entity_id: profile.user_id,
    details: {
      user_id: profile.user_id,
      email: profile.email,
      full_name: profile.full_name,
      role: 'school_admin',
    },
  })

  return profile
}

export async function validateAndStageRoster(params: {
  rows: RosterRowInput[]
  academicPeriodId?: string | null
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<RosterReport> {
  assertAdminAccess(params.actorRole)

  if (!params.academicPeriodId) {
    throw AppError.validationError('Academic period is required.')
  }

  const school = await params.providers.domainStore.getSchool()
  if (!school) {
    throw AppError.conflict('School must be bootstrapped before staging a roster.')
  }

  const period = await params.providers.domainStore.getAcademicPeriod(params.academicPeriodId)
  if (!period || period.school_id !== school.id) {
    throw AppError.validationError('Academic period does not belong to the configured school.')
  }

  const existingClasses = await params.providers.domainStore.getClasses(
    school.id,
    params.academicPeriodId,
  )
  const normalizeText = (value: string) => value.trim().replace(/\s+/g, ' ')
  const knownClasses = new Map(existingClasses.map((c) => [normalizeText(c.name).toLowerCase(), c]))
  const activeEnrollments = await params.providers.domainStore.listClassEnrollments({
    academicPeriodId: params.academicPeriodId,
    status: 'active',
  })

  const rejectedItems: RejectedRosterRow[] = []
  const normalizedRows: RosterRowInput[] = []
  const seenNisBatch = new Set<string>()
  const duplicateNisBatch = new Set<string>()
  const seenAbsenceBatch = new Set<string>()

  for (const row of params.rows) {
    const rawNis = row.nis ? row.nis.trim() : ''
    if (rawNis.length > 0) {
      if (seenNisBatch.has(rawNis)) {
        duplicateNisBatch.add(rawNis)
      } else {
        seenNisBatch.add(rawNis)
      }
    }
  }

  for (let i = 0; i < params.rows.length; i++) {
    const row = params.rows[i]
    const nis = row.nis ? row.nis.trim() : ''
    const fullName = row.full_name ? normalizeText(row.full_name) : ''
    const className = row.class_name ? normalizeText(row.class_name) : ''
    const gender = row.gender ? row.gender.trim().toUpperCase() : ''
    const absenceRaw = row.absence_number
    const absenceText =
      absenceRaw === null || absenceRaw === undefined ? '' : String(absenceRaw).trim()
    const absenceNumber = /^\d+$/.test(absenceText) ? Number(absenceText) : NaN

    const reasons: string[] = []

    if (!nis) {
      reasons.push('NIS cannot be empty.')
    } else if (!/^\d+$/.test(nis)) {
      reasons.push('NIS must contain only digits.')
    } else if (duplicateNisBatch.has(nis)) {
      reasons.push(`Duplicate NIS "${nis}" in roster batch.`)
    } else {
      const existingProfile = await params.providers.domainStore.getProfileByNis(nis)
      const existingStudent = await params.providers.domainStore.getStudentByNis(nis)
      if (existingProfile || existingStudent) {
        reasons.push(`NIS "${nis}" already exists in the student roster.`)
      }
    }

    if (!fullName) {
      reasons.push('Full name cannot be empty.')
    }

    const cls = row.class_id
      ? existingClasses.find((candidate) => candidate.id === row.class_id)
      : knownClasses.get(className.toLowerCase())
    if (!className && !row.class_id) {
      reasons.push('Class name cannot be empty.')
    } else if (!cls) {
      reasons.push(`Invalid class reference: "${row.class_name}" is not a recognized class.`)
    }

    if (!gender || (gender !== 'L' && gender !== 'P')) {
      reasons.push('Gender must be L or P.')
    }

    if (!absenceText || !Number.isInteger(absenceNumber) || absenceNumber <= 0) {
      reasons.push('Absence number must be a positive integer.')
    } else if (cls) {
      const absenceKey = `${cls.id}:${absenceNumber}`
      if (seenAbsenceBatch.has(absenceKey)) {
        reasons.push(`Duplicate absence number "${absenceText}" in class and academic period.`)
      }
      if (
        activeEnrollments.some(
          (enrollment) =>
            enrollment.class_id === cls.id &&
            enrollment.absence_number !== null &&
            enrollment.absence_number !== undefined &&
            Number(enrollment.absence_number) === absenceNumber,
        )
      ) {
        reasons.push(
          `Absence number "${absenceText}" is already used in this class and academic period.`,
        )
      }
      seenAbsenceBatch.add(absenceKey)
    }

    normalizedRows.push({
      ...row,
      nis,
      full_name: fullName,
      class_name: cls?.name ?? className,
      class_id: cls?.id ?? row.class_id ?? null,
      academic_period_id: params.academicPeriodId,
      gender,
      absence_number: absenceText || null,
    })

    if (reasons.length > 0) {
      rejectedItems.push({
        row_index: i,
        nis: row.nis || null,
        full_name: row.full_name || null,
        class_name: row.class_name || null,
        class_id: row.class_id ?? null,
        academic_period_id: params.academicPeriodId,
        gender: row.gender ?? null,
        absence_number: row.absence_number ?? null,
        grade: row.grade ?? null,
        reason: reasons.join(' '),
      })
    }
  }

  const totalRows = params.rows.length
  const rejectedRows = rejectedItems.length
  const validRows = totalRows - rejectedRows
  const status = rejectedRows > 0 ? 'rejected' : 'staged'
  const reviewState = rejectedRows > 0 ? 'rejected' : 'pending'

  const report = await params.providers.domainStore.stageRosterReport({
    schoolId: school.id,
    totalRows,
    validRows,
    rejectedRows,
    status,
    reviewState,
    academicPeriodId: params.academicPeriodId,
    rows: normalizedRows,
    rejectedItems,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'stage_roster',
    entity_type: 'roster_report',
    entity_id: report.id,
    details: {
      total_rows: totalRows,
      valid_rows: validRows,
      rejected_rows: rejectedRows,
      status,
    },
  })

  return report
}

export async function getRosterReport(params: {
  id: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<RosterReport> {
  assertAdminAccess(params.actorRole)

  const report = await params.providers.domainStore.getRosterReport(params.id)
  if (!report) {
    throw AppError.notFound('Roster report')
  }

  return report
}

export async function acceptRosterReport(params: {
  id: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<RosterReport> {
  assertAdminAccess(params.actorRole)

  const report = await params.providers.domainStore.getRosterReport(params.id)
  if (!report) {
    throw AppError.notFound('Roster report')
  }

  if (report.rejected_rows > 0 || (report.rejected_items && report.rejected_items.length > 0)) {
    throw AppError.validationError('Cannot accept a roster report with rejected rows.')
  }
  if (report.status === 'accepted') return report

  const accepted = await params.providers.domainStore.acceptRosterReport(params.id, params.actorId)

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'accept_roster',
    entity_type: 'roster_report',
    entity_id: report.id,
    details: {
      valid_rows: accepted.valid_rows,
      accepted_by: params.actorId,
    },
  })

  return accepted
}

export async function openStudentSignup(params: {
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<{ signup_open: boolean }> {
  assertAdminAccess(params.actorRole)

  const status = await params.providers.domainStore.getBootstrapStatus()
  if (!status.roster_accepted) {
    throw AppError.validationError(
      'Student signup cannot be opened before an accepted roster report exists.',
    )
  }

  await params.providers.domainStore.openSignup()

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'open_signup',
    entity_type: 'school',
    entity_id: status.school?.id ?? null,
    details: { signup_open: true, opened_by: params.actorId },
  })

  return { signup_open: true }
}
