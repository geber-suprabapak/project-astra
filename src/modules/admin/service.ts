import { AppError } from '../../lib/errors/app-error.js'
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
} from '../../providers/types.js'
import { privilegedSessionSchema, type PrivilegedSession } from './schema.js'

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
  if (params.actorRole !== 'platform_admin') {
    throw AppError.forbidden()
  }

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
  if (params.actorRole !== 'platform_admin') {
    throw AppError.forbidden()
  }

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
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<RosterReport> {
  if (params.actorRole !== 'platform_admin' && params.actorRole !== 'school_admin') {
    throw AppError.forbidden()
  }

  const school = await params.providers.domainStore.getSchool()
  if (!school) {
    throw AppError.conflict('School must be bootstrapped before staging a roster.')
  }

  const existingClasses = await params.providers.domainStore.getClasses(school.id)
  const knownClasses = new Set(existingClasses.map((c) => c.name.trim().toLowerCase()))

  const rejectedItems: RejectedRosterRow[] = []
  const seenNisBatch = new Set<string>()
  const duplicateNisBatch = new Set<string>()

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
    const fullName = row.full_name ? row.full_name.trim() : ''
    const className = row.class_name ? row.class_name.trim() : ''

    const reasons: string[] = []

    if (!nis) {
      reasons.push('NIS cannot be empty.')
    } else if (duplicateNisBatch.has(nis)) {
      reasons.push(`Duplicate NIS "${nis}" in roster batch.`)
    } else {
      const existingProfile = await params.providers.domainStore.getProfileByNis(nis)
      if (existingProfile) {
        reasons.push(`NIS "${nis}" already exists in student profiles.`)
      }
    }

    if (!fullName) {
      reasons.push('Full name cannot be empty.')
    }

    if (!className) {
      reasons.push('Class name cannot be empty.')
    } else if (existingClasses.length > 0 && !knownClasses.has(className.toLowerCase())) {
      reasons.push(`Invalid class reference: "${row.class_name}" is not a recognized class.`)
    }

    if (reasons.length > 0) {
      rejectedItems.push({
        row_index: i,
        nis: row.nis || null,
        full_name: row.full_name || null,
        class_name: row.class_name || null,
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
    rows: params.rows,
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
  if (params.actorRole !== 'platform_admin' && params.actorRole !== 'school_admin') {
    throw AppError.forbidden()
  }

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
  if (params.actorRole !== 'school_admin') {
    throw AppError.forbidden()
  }

  const report = await params.providers.domainStore.getRosterReport(params.id)
  if (!report) {
    throw AppError.notFound('Roster report')
  }

  if (report.rejected_rows > 0 || (report.rejected_items && report.rejected_items.length > 0)) {
    throw AppError.validationError('Cannot accept a roster report with rejected rows.')
  }

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
  if (params.actorRole !== 'school_admin') {
    throw AppError.forbidden()
  }

  const status = await params.providers.domainStore.getBootstrapStatus()
  if (!status.roster_accepted) {
    throw AppError.validationError('Student signup cannot be opened before an accepted roster report exists.')
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
