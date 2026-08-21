import { AppError } from '../../lib/errors/app-error.js'
import type {
  AcademicPeriod,
  AppProviders,
  BootstrapStatus,
  CalendarException,
  ClassEnrollment,
  ClassEnrollmentStatus,
  ClassRoom,
  IdentityRole,
  IdentityUser,
  Location,
  Permission,
  ProfileLifecycleStatus,
  RejectedRosterRow,
  Role,
  RosterReport,
  RosterRowInput,
  Schedule,
  School,
  UserProfile,
} from '../../providers/types.js'
import {
  privilegedSessionSchema,
  type EffectivePermissionsResponse,
  type PrivilegedSession,
  type StaffResponse,
} from './schema.js'

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

export async function listRoles(params: {
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Role[]> {
  if (params.actorRole !== 'platform_admin' && params.actorRole !== 'school_admin') {
    throw AppError.forbidden()
  }

  return params.providers.domainStore.getRoles()
}

export async function getRole(params: {
  id: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Role> {
  if (params.actorRole !== 'platform_admin' && params.actorRole !== 'school_admin') {
    throw AppError.forbidden()
  }

  const role = await params.providers.domainStore.getRoleById(params.id)
  if (!role) {
    throw AppError.notFound('Role')
  }

  return role
}

export async function createRole(params: {
  name: string
  description?: string | null
  permissions?: string[]
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Role> {
  if (params.actorRole !== 'platform_admin') {
    throw AppError.forbidden()
  }

  const role = await params.providers.domainStore.createRole({
    name: params.name,
    description: params.description,
    permissions: params.permissions,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'create_role',
    entity_type: 'role',
    entity_id: role.id,
    details: {
      name: role.name,
      permissions: role.permissions,
    },
  })

  return role
}

export async function updateRole(params: {
  id: string
  name?: string
  description?: string | null
  permissions?: string[]
  isActive?: boolean
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Role> {
  if (params.actorRole !== 'platform_admin') {
    throw AppError.forbidden()
  }

  const updated = await params.providers.domainStore.updateRole(params.id, {
    name: params.name,
    description: params.description,
    permissions: params.permissions,
    isActive: params.isActive,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'update_role',
    entity_type: 'role',
    entity_id: updated.id,
    details: {
      name: updated.name,
      is_active: updated.is_active,
      permissions: updated.permissions,
    },
  })

  return updated
}

export async function listPermissions(params: {
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Permission[]> {
  if (params.actorRole !== 'platform_admin' && params.actorRole !== 'school_admin') {
    throw AppError.forbidden()
  }

  return params.providers.domainStore.getPermissions()
}

export async function createPermission(params: {
  name: string
  description?: string | null
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Permission> {
  if (params.actorRole !== 'platform_admin') {
    throw AppError.forbidden()
  }

  const perm = await params.providers.domainStore.createPermission({
    name: params.name,
    description: params.description,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'create_permission',
    entity_type: 'permission',
    entity_id: perm.id,
    details: {
      name: perm.name,
    },
  })

  return perm
}

export async function listStaff(params: {
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<StaffResponse[]> {
  if (params.actorRole !== 'platform_admin' && params.actorRole !== 'school_admin') {
    throw AppError.forbidden()
  }

  const profiles = await params.providers.domainStore.getStaffProfiles()
  const results: StaffResponse[] = []

  for (const p of profiles) {
    const roles = await params.providers.domainStore.getUserRoles(p.user_id)
    const effectivePermissions = await params.providers.domainStore.getUserEffectivePermissions(
      p.user_id,
    )
    results.push({
      ...p,
      roles,
      effective_permissions: effectivePermissions,
    })
  }

  return results
}

export async function getStaff(params: {
  userId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<StaffResponse> {
  if (params.actorRole !== 'platform_admin' && params.actorRole !== 'school_admin') {
    throw AppError.forbidden()
  }

  const profile = await params.providers.domainStore.getStaffProfile(params.userId)
  if (!profile) {
    throw AppError.notFound('Staff profile')
  }

  const roles = await params.providers.domainStore.getUserRoles(params.userId)
  const effectivePermissions = await params.providers.domainStore.getUserEffectivePermissions(
    params.userId,
  )

  return {
    ...profile,
    roles,
    effective_permissions: effectivePermissions,
  }
}

export async function createStaff(params: {
  userId?: string
  email: string
  fullName: string
  role: string
  roles?: string[]
  gender?: string | null
  password?: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<StaffResponse> {
  if (params.actorRole !== 'platform_admin' && params.actorRole !== 'school_admin') {
    throw AppError.forbidden()
  }

  if (params.actorRole === 'school_admin') {
    if (params.role === 'platform_admin' || params.roles?.includes('platform_admin')) {
      throw AppError.forbidden()
    }
  }

  const targetRole = await params.providers.domainStore.getRoleByName(params.role)
  if (!targetRole || !targetRole.is_active) {
    throw AppError.validationError(`Role "${params.role}" does not exist or is inactive.`)
  }

  if (params.roles) {
    for (const r of params.roles) {
      const extra = await params.providers.domainStore.getRoleByName(r)
      if (!extra || !extra.is_active) {
        throw AppError.validationError(`Role "${r}" does not exist or is inactive.`)
      }
    }
  }

  let identityUserId = params.userId
  if (params.providers.identityProvider.createStaffIdentity) {
    const identity = await params.providers.identityProvider.createStaffIdentity({
      email: params.email,
      fullName: params.fullName,
      role: params.role,
      password: params.password,
    })
    identityUserId = identityUserId ?? identity.userId
  }

  const profile = await params.providers.domainStore.createStaffProfile({
    userId: identityUserId,
    fullName: params.fullName,
    email: params.email,
    role: params.role,
    roles: params.roles,
    gender: params.gender,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'create_staff',
    entity_type: 'profile',
    entity_id: profile.user_id,
    details: {
      user_id: profile.user_id,
      email: profile.email,
      full_name: profile.full_name,
      role: profile.role,
      roles: params.roles,
    },
  })

  const roles = await params.providers.domainStore.getUserRoles(profile.user_id)
  const effectivePermissions = await params.providers.domainStore.getUserEffectivePermissions(
    profile.user_id,
  )

  return {
    ...profile,
    roles,
    effective_permissions: effectivePermissions,
  }
}

export async function updateStaff(params: {
  userId: string
  fullName?: string | null
  role?: string
  roles?: string[]
  lifecycleStatus?: ProfileLifecycleStatus
  gender?: string | null
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<StaffResponse> {
  if (params.actorRole !== 'platform_admin' && params.actorRole !== 'school_admin') {
    throw AppError.forbidden()
  }

  if (params.actorRole === 'school_admin') {
    if (params.role === 'platform_admin' || params.roles?.includes('platform_admin')) {
      throw AppError.forbidden()
    }
  }

  if (params.role) {
    const targetRole = await params.providers.domainStore.getRoleByName(params.role)
    if (!targetRole || !targetRole.is_active) {
      throw AppError.validationError(`Role "${params.role}" does not exist or is inactive.`)
    }
  }

  if (params.roles) {
    for (const r of params.roles) {
      const extra = await params.providers.domainStore.getRoleByName(r)
      if (!extra || !extra.is_active) {
        throw AppError.validationError(`Role "${r}" does not exist or is inactive.`)
      }
    }
  }

  const updated = await params.providers.domainStore.updateStaffProfile(params.userId, {
    fullName: params.fullName,
    role: params.role,
    roles: params.roles,
    lifecycleStatus: params.lifecycleStatus,
    gender: params.gender,
  })

  if (
    params.lifecycleStatus === 'disabled' ||
    params.lifecycleStatus === 'rejected' ||
    params.role ||
    params.roles
  ) {
    await params.providers.identityProvider.revokeUserSessions?.(params.userId)
  }

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'update_staff',
    entity_type: 'profile',
    entity_id: params.userId,
    details: {
      user_id: params.userId,
      role: updated.role,
      lifecycle_status: updated.lifecycle_status,
      full_name: updated.full_name,
    },
  })

  const roles = await params.providers.domainStore.getUserRoles(params.userId)
  const effectivePermissions = await params.providers.domainStore.getUserEffectivePermissions(
    params.userId,
  )

  return {
    ...updated,
    roles,
    effective_permissions: effectivePermissions,
  }
}

export async function requestStaffPasswordReset(params: {
  userId: string
  email?: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<{ success: boolean; message: string }> {
  if (params.actorRole !== 'platform_admin' && params.actorRole !== 'school_admin') {
    throw AppError.forbidden()
  }

  const staff = await params.providers.domainStore.getUserProfile(params.userId)
  const targetEmail = params.email ?? staff.email
  if (!targetEmail) {
    throw AppError.validationError('Staff profile has no associated email.')
  }

  await params.providers.identityProvider.requestPasswordResetEmail?.(targetEmail)

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'request_staff_password_reset',
    entity_type: 'profile',
    entity_id: params.userId,
    details: {
      user_id: params.userId,
      email: targetEmail,
      requested_by: params.actorId,
    },
  })

  return {
    success: true,
    message: 'Password recovery email initiated.',
  }
}

export async function getStaffEffectivePermissions(params: {
  userId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<EffectivePermissionsResponse> {
  if (params.actorRole !== 'platform_admin' && params.actorRole !== 'school_admin') {
    throw AppError.forbidden()
  }

  const roles = await params.providers.domainStore.getUserRoles(params.userId)
  const permissions = await params.providers.domainStore.getUserEffectivePermissions(params.userId)

  return {
    user_id: params.userId,
    roles,
    permissions,
  }
}
export async function listStudents(params: {
  status?: ProfileLifecycleStatus
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<UserProfile[]> {
  if (params.actorRole !== 'platform_admin' && params.actorRole !== 'school_admin') {
    throw AppError.forbidden()
  }

  return params.providers.domainStore.listStudentProfiles(
    params.status ? { lifecycle_status: params.status } : undefined,
  )
}

export async function getStudent(params: {
  userId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<UserProfile> {
  if (params.actorRole !== 'platform_admin' && params.actorRole !== 'school_admin') {
    throw AppError.forbidden()
  }

  const profile = await params.providers.domainStore.getUserProfile(params.userId)
  if (profile.role !== 'student') {
    throw AppError.notFound('Student profile')
  }

  return profile
}

export async function approveStudent(params: {
  userId: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<UserProfile> {
  if (params.actorRole !== 'school_admin' && params.actorRole !== 'platform_admin') {
    throw AppError.forbidden()
  }

  const profile = await params.providers.domainStore.getUserProfile(params.userId)
  if (profile.role !== 'student') {
    throw AppError.notFound('Student profile')
  }

  const updated = await params.providers.domainStore.updateProfileLifecycle(
    params.userId,
    'approved',
  )

  if (params.providers.identityProvider.setUserSuspended) {
    await params.providers.identityProvider.setUserSuspended(params.userId, false)
  }
  if (params.providers.identityProvider.assignUserRole) {
    await params.providers.identityProvider.assignUserRole(params.userId, 'student')
  }

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'approve_student',
    entity_type: 'profile',
    entity_id: params.userId,
    details: {
      nis: profile.nis,
      full_name: profile.full_name,
      previous_status: profile.lifecycle_status,
      new_status: 'approved',
    },
  })

  return updated
}

export async function rejectStudent(params: {
  userId: string
  reason?: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<UserProfile> {
  if (params.actorRole !== 'school_admin' && params.actorRole !== 'platform_admin') {
    throw AppError.forbidden()
  }

  const profile = await params.providers.domainStore.getUserProfile(params.userId)
  if (profile.role !== 'student') {
    throw AppError.notFound('Student profile')
  }

  const updated = await params.providers.domainStore.updateProfileLifecycle(
    params.userId,
    'rejected',
  )

  if (params.providers.identityProvider.setUserSuspended) {
    await params.providers.identityProvider.setUserSuspended(params.userId, true)
  }
  if (params.providers.identityProvider.revokeUserSessions) {
    await params.providers.identityProvider.revokeUserSessions(params.userId)
  }

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'reject_student',
    entity_type: 'profile',
    entity_id: params.userId,
    details: {
      nis: profile.nis,
      reason: params.reason ?? null,
      previous_status: profile.lifecycle_status,
      new_status: 'rejected',
    },
  })

  return updated
}

export async function disableStudent(params: {
  userId: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<UserProfile> {
  if (params.actorRole !== 'school_admin' && params.actorRole !== 'platform_admin') {
    throw AppError.forbidden()
  }

  const profile = await params.providers.domainStore.getUserProfile(params.userId)
  if (profile.role !== 'student') {
    throw AppError.notFound('Student profile')
  }

  const updated = await params.providers.domainStore.updateProfileLifecycle(
    params.userId,
    'disabled',
  )

  if (params.providers.identityProvider.setUserSuspended) {
    await params.providers.identityProvider.setUserSuspended(params.userId, true)
  }
  if (params.providers.identityProvider.revokeUserSessions) {
    await params.providers.identityProvider.revokeUserSessions(params.userId)
  }

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'disable_student',
    entity_type: 'profile',
    entity_id: params.userId,
    details: {
      nis: profile.nis,
      previous_status: profile.lifecycle_status,
      new_status: 'disabled',
    },
  })

  return updated
}

export async function generateStudentResetCode(params: {
  userId: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<{
  code: string
  expires_at: string
  user_id: string
  nis: string | null
}> {
  if (params.actorRole !== 'school_admin' && params.actorRole !== 'platform_admin') {
    throw AppError.forbidden()
  }

  const profile = await params.providers.domainStore.getUserProfile(params.userId)
  if (profile.role !== 'student') {
    throw AppError.notFound('Student profile')
  }

  if (profile.lifecycle_status !== 'approved') {
    throw AppError.validationError(
      'Cannot generate password reset code for non-approved student profile.',
    )
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString()
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()

  await params.providers.domainStore.createPasswordResetCode({
    userId: params.userId,
    code,
    expiresAt,
    createdBy: params.actorId,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'generate_reset_code',
    entity_type: 'password_reset_code',
    entity_id: params.userId,
    details: {
      nis: profile.nis,
      expires_at: expiresAt,
    },
  })

  return {
    code,
    expires_at: expiresAt,
    user_id: params.userId,
    nis: profile.nis ?? null,
  }
}

export async function correctStudentEmail(params: {
  userId: string
  email: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<UserProfile> {
  if (params.actorRole !== 'school_admin' && params.actorRole !== 'platform_admin') {
    throw AppError.forbidden()
  }

  const profile = await params.providers.domainStore.getUserProfile(params.userId)
  if (profile.role !== 'student') {
    throw AppError.notFound('Student profile')
  }

  const oldEmail = profile.email
  const updated = await params.providers.domainStore.updateProfileEmail(params.userId, params.email)

  if (params.providers.identityProvider.updateUserEmail) {
    await params.providers.identityProvider.updateUserEmail(params.userId, params.email)
  }

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'correct_student_email',
    entity_type: 'profile',
    entity_id: params.userId,
    details: {
      nis: profile.nis,
      old_email: oldEmail,
      new_email: params.email,
    },
  })

  return updated
}

// ---------------------------------------------------------------------------
// Academic Attendance Policy Service Operations
// ---------------------------------------------------------------------------

function checkPolicyAdminAccess(actorRole: IdentityRole | null): void {
  if (actorRole !== 'school_admin' && actorRole !== 'platform_admin') {
    throw AppError.forbidden()
  }
}

// --- Academic Periods ---

export async function listAcademicPeriods(params: {
  actorRole: IdentityRole | null
  filter?: { isActive?: boolean }
  providers: AppProviders
}): Promise<AcademicPeriod[]> {
  checkPolicyAdminAccess(params.actorRole)
  return params.providers.domainStore.listAcademicPeriods(params.filter)
}

export async function createAcademicPeriod(params: {
  name: string
  startDate: string
  endDate: string
  isActive?: boolean
  schoolId?: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<AcademicPeriod> {
  checkPolicyAdminAccess(params.actorRole)
  const period = await params.providers.domainStore.createAcademicPeriod({
    name: params.name,
    startDate: params.startDate,
    endDate: params.endDate,
    isActive: params.isActive,
    schoolId: params.schoolId,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'create_academic_period',
    entity_type: 'academic_period',
    entity_id: period.id,
    details: {
      name: period.name,
      start_date: period.start_date,
      end_date: period.end_date,
      is_active: period.is_active,
    },
  })

  return period
}

export async function updateAcademicPeriod(params: {
  id: string
  name?: string
  startDate?: string
  endDate?: string
  isActive?: boolean
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<AcademicPeriod> {
  checkPolicyAdminAccess(params.actorRole)
  const period = await params.providers.domainStore.updateAcademicPeriod(params.id, {
    name: params.name,
    startDate: params.startDate,
    endDate: params.endDate,
    isActive: params.isActive,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'update_academic_period',
    entity_type: 'academic_period',
    entity_id: period.id,
    details: {
      name: period.name,
      start_date: period.start_date,
      end_date: period.end_date,
      is_active: period.is_active,
    },
  })

  return period
}

export async function setActiveAcademicPeriod(params: {
  id: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<AcademicPeriod> {
  checkPolicyAdminAccess(params.actorRole)
  const period = await params.providers.domainStore.setActiveAcademicPeriod(params.id)

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'set_active_academic_period',
    entity_type: 'academic_period',
    entity_id: period.id,
    details: {
      name: period.name,
      is_active: true,
    },
  })

  return period
}

// --- Classes ---

export async function listClasses(params: {
  schoolId?: string
  academicPeriodId?: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<ClassRoom[]> {
  checkPolicyAdminAccess(params.actorRole)
  return params.providers.domainStore.getClasses(params.schoolId, params.academicPeriodId)
}

export async function createClass(params: {
  name: string
  grade?: number | null
  academicPeriodId?: string | null
  schoolId?: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<ClassRoom> {
  checkPolicyAdminAccess(params.actorRole)
  const cls = await params.providers.domainStore.createClass({
    name: params.name,
    grade: params.grade,
    academicPeriodId: params.academicPeriodId,
    schoolId: params.schoolId,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'create_class',
    entity_type: 'class',
    entity_id: cls.id,
    details: {
      name: cls.name,
      grade: cls.grade,
      academic_period_id: cls.academic_period_id,
    },
  })

  return cls
}

export async function updateClass(params: {
  id: string
  name?: string
  grade?: number | null
  academicPeriodId?: string | null
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<ClassRoom> {
  checkPolicyAdminAccess(params.actorRole)
  const cls = await params.providers.domainStore.updateClass(params.id, {
    name: params.name,
    grade: params.grade,
    academicPeriodId: params.academicPeriodId,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'update_class',
    entity_type: 'class',
    entity_id: cls.id,
    details: {
      name: cls.name,
      grade: cls.grade,
      academic_period_id: cls.academic_period_id,
    },
  })

  return cls
}

// --- Class Enrollments ---

export async function listClassEnrollments(params: {
  userId?: string
  classId?: string
  academicPeriodId?: string
  status?: ClassEnrollmentStatus
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<ClassEnrollment[]> {
  checkPolicyAdminAccess(params.actorRole)
  return params.providers.domainStore.listClassEnrollments({
    userId: params.userId,
    classId: params.classId,
    academicPeriodId: params.academicPeriodId,
    status: params.status,
  })
}

export async function enrollStudent(params: {
  userId: string
  classId: string
  academicPeriodId: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<ClassEnrollment> {
  checkPolicyAdminAccess(params.actorRole)
  const enrollment = await params.providers.domainStore.enrollStudentInClass({
    userId: params.userId,
    classId: params.classId,
    academicPeriodId: params.academicPeriodId,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'enroll_student',
    entity_type: 'class_enrollment',
    entity_id: enrollment.id,
    details: {
      user_id: enrollment.user_id,
      class_id: enrollment.class_id,
      academic_period_id: enrollment.academic_period_id,
      status: enrollment.status,
    },
  })

  return enrollment
}

export async function transferStudentEnrollment(params: {
  userId: string
  toClassId: string
  academicPeriodId: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<{ previous: ClassEnrollment; current: ClassEnrollment }> {
  checkPolicyAdminAccess(params.actorRole)
  const result = await params.providers.domainStore.transferStudentEnrollment({
    userId: params.userId,
    toClassId: params.toClassId,
    academicPeriodId: params.academicPeriodId,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'transfer_student_enrollment',
    entity_type: 'class_enrollment',
    entity_id: result.current.id,
    details: {
      user_id: params.userId,
      from_class_id: result.previous.class_id,
      to_class_id: result.current.class_id,
      academic_period_id: params.academicPeriodId,
    },
  })

  return result
}

export async function promoteStudentEnrollment(params: {
  userId: string
  fromAcademicPeriodId: string
  toAcademicPeriodId: string
  toClassId: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<{ previous: ClassEnrollment; current: ClassEnrollment }> {
  checkPolicyAdminAccess(params.actorRole)
  const result = await params.providers.domainStore.promoteStudentEnrollment({
    userId: params.userId,
    fromAcademicPeriodId: params.fromAcademicPeriodId,
    toAcademicPeriodId: params.toAcademicPeriodId,
    toClassId: params.toClassId,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'promote_student_enrollment',
    entity_type: 'class_enrollment',
    entity_id: result.current.id,
    details: {
      user_id: params.userId,
      from_academic_period_id: params.fromAcademicPeriodId,
      to_academic_period_id: params.toAcademicPeriodId,
      to_class_id: result.current.class_id,
    },
  })

  return result
}

export async function exitStudentEnrollment(params: {
  userId: string
  academicPeriodId: string
  status?: 'archived' | 'graduated'
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<ClassEnrollment> {
  checkPolicyAdminAccess(params.actorRole)
  const enrollment = await params.providers.domainStore.exitStudentEnrollment({
    userId: params.userId,
    academicPeriodId: params.academicPeriodId,
    status: params.status,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'exit_student_enrollment',
    entity_type: 'class_enrollment',
    entity_id: enrollment.id,
    details: {
      user_id: params.userId,
      academic_period_id: params.academicPeriodId,
      status: enrollment.status,
    },
  })

  return enrollment
}

// --- Schedules ---

export async function listSchedules(params: {
  filter?: {
    classId?: string
    academicPeriodId?: string
    dayOfWeek?: string
    isActive?: boolean
  }
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Schedule[]> {
  checkPolicyAdminAccess(params.actorRole)
  return params.providers.domainStore.listSchedules(params.filter)
}

export async function getSchedule(params: {
  id: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Schedule> {
  checkPolicyAdminAccess(params.actorRole)
  const schedule = await params.providers.domainStore.getScheduleById(params.id)
  if (!schedule) throw AppError.notFound('Schedule')
  return schedule
}

export async function createSchedule(params: {
  schoolId?: string | null
  classId?: string | null
  academicPeriodId?: string | null
  locationId?: string | null
  dayOfWeek: string
  startTime: string
  endTime: string
  startCheckout: string
  endCheckout: string
  gracePeriodMinutes?: number
  isActive?: boolean
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Schedule> {
  checkPolicyAdminAccess(params.actorRole)
  const schedule = await params.providers.domainStore.createSchedule({
    schoolId: params.schoolId,
    classId: params.classId,
    academicPeriodId: params.academicPeriodId,
    locationId: params.locationId,
    dayOfWeek: params.dayOfWeek,
    startTime: params.startTime,
    endTime: params.endTime,
    startCheckout: params.startCheckout,
    endCheckout: params.endCheckout,
    gracePeriodMinutes: params.gracePeriodMinutes,
    isActive: params.isActive,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'create_schedule',
    entity_type: 'schedule',
    entity_id: schedule.id ?? 'unknown',
    details: {
      day_of_week: schedule.day_of_week ?? schedule.hari,
      start_time: schedule.mulai_masuk,
      end_time: schedule.selesai_masuk,
      class_id: schedule.class_id,
      academic_period_id: schedule.academic_period_id,
      location_id: schedule.location_id,
    },
  })

  return schedule
}

export async function updateSchedule(params: {
  id: string
  classId?: string | null
  academicPeriodId?: string | null
  locationId?: string | null
  dayOfWeek?: string
  startTime?: string
  endTime?: string
  startCheckout?: string
  endCheckout?: string
  gracePeriodMinutes?: number
  isActive?: boolean
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Schedule> {
  checkPolicyAdminAccess(params.actorRole)
  const schedule = await params.providers.domainStore.updateSchedule(params.id, {
    classId: params.classId,
    academicPeriodId: params.academicPeriodId,
    locationId: params.locationId,
    dayOfWeek: params.dayOfWeek,
    startTime: params.startTime,
    endTime: params.endTime,
    startCheckout: params.startCheckout,
    endCheckout: params.endCheckout,
    gracePeriodMinutes: params.gracePeriodMinutes,
    isActive: params.isActive,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'update_schedule',
    entity_type: 'schedule',
    entity_id: schedule.id ?? params.id,
    details: {
      day_of_week: schedule.day_of_week ?? schedule.hari,
      start_time: schedule.mulai_masuk,
      end_time: schedule.selesai_masuk,
      class_id: schedule.class_id,
      academic_period_id: schedule.academic_period_id,
      location_id: schedule.location_id,
    },
  })

  return schedule
}

export async function deleteSchedule(params: {
  id: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<void> {
  checkPolicyAdminAccess(params.actorRole)
  await params.providers.domainStore.deleteSchedule(params.id)

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'delete_schedule',
    entity_type: 'schedule',
    entity_id: params.id,
    details: { id: params.id },
  })
}

// --- Locations ---

export async function listLocations(params: {
  filter?: { isActive?: boolean }
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Location[]> {
  checkPolicyAdminAccess(params.actorRole)
  return params.providers.domainStore.listLocations(params.filter)
}

export async function getLocation(params: {
  id: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Location> {
  checkPolicyAdminAccess(params.actorRole)
  const loc = await params.providers.domainStore.getLocationById(params.id)
  if (!loc) throw AppError.notFound('Location')
  return loc
}

export async function createLocation(params: {
  name: string
  latitude: number
  longitude: number
  radiusMeters?: number
  isActive?: boolean
  schoolId?: string | null
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Location> {
  checkPolicyAdminAccess(params.actorRole)
  const loc = await params.providers.domainStore.createLocation({
    name: params.name,
    latitude: params.latitude,
    longitude: params.longitude,
    radiusMeters: params.radiusMeters,
    isActive: params.isActive,
    schoolId: params.schoolId,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'create_location',
    entity_type: 'location',
    entity_id: loc.id,
    details: {
      name: loc.name,
      latitude: loc.latitude,
      longitude: loc.longitude,
      radius_meters: loc.radius_meters,
    },
  })

  return loc
}

export async function updateLocation(params: {
  id: string
  name?: string
  latitude?: number
  longitude?: number
  radiusMeters?: number
  isActive?: boolean
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Location> {
  checkPolicyAdminAccess(params.actorRole)
  const loc = await params.providers.domainStore.updateLocation(params.id, {
    name: params.name,
    latitude: params.latitude,
    longitude: params.longitude,
    radiusMeters: params.radiusMeters,
    isActive: params.isActive,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'update_location',
    entity_type: 'location',
    entity_id: loc.id,
    details: {
      name: loc.name,
      latitude: loc.latitude,
      longitude: loc.longitude,
      radius_meters: loc.radius_meters,
    },
  })

  return loc
}

export async function deleteLocation(params: {
  id: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<void> {
  checkPolicyAdminAccess(params.actorRole)
  await params.providers.domainStore.deleteLocation(params.id)

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'delete_location',
    entity_type: 'location',
    entity_id: params.id,
    details: { id: params.id },
  })
}

// --- Calendar Exceptions ---

export async function listCalendarExceptions(params: {
  filter?: {
    academicPeriodId?: string
    startDate?: string
    endDate?: string
  }
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<CalendarException[]> {
  checkPolicyAdminAccess(params.actorRole)
  return params.providers.domainStore.listCalendarExceptions(params.filter)
}

export async function getCalendarException(params: {
  id: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<CalendarException> {
  checkPolicyAdminAccess(params.actorRole)
  const exc = await params.providers.domainStore.getCalendarExceptionById(params.id)
  if (!exc) throw AppError.notFound('Calendar exception')
  return exc
}

export async function createCalendarException(params: {
  schoolId?: string | null
  academicPeriodId?: string | null
  date: string
  reason: string
  isHoliday?: boolean
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<CalendarException> {
  checkPolicyAdminAccess(params.actorRole)
  const exc = await params.providers.domainStore.createCalendarException({
    schoolId: params.schoolId,
    academicPeriodId: params.academicPeriodId,
    date: params.date,
    reason: params.reason,
    isHoliday: params.isHoliday,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'create_calendar_exception',
    entity_type: 'calendar_exception',
    entity_id: exc.id,
    details: {
      date: exc.date,
      reason: exc.reason,
      is_holiday: exc.is_holiday,
      academic_period_id: exc.academic_period_id,
    },
  })

  return exc
}

export async function updateCalendarException(params: {
  id: string
  academicPeriodId?: string | null
  date?: string
  reason?: string
  isHoliday?: boolean
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<CalendarException> {
  checkPolicyAdminAccess(params.actorRole)
  const exc = await params.providers.domainStore.updateCalendarException(params.id, {
    academicPeriodId: params.academicPeriodId,
    date: params.date,
    reason: params.reason,
    isHoliday: params.isHoliday,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'update_calendar_exception',
    entity_type: 'calendar_exception',
    entity_id: exc.id,
    details: {
      date: exc.date,
      reason: exc.reason,
      is_holiday: exc.is_holiday,
      academic_period_id: exc.academic_period_id,
    },
  })

  return exc
}

export async function deleteCalendarException(params: {
  id: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<void> {
  checkPolicyAdminAccess(params.actorRole)
  await params.providers.domainStore.deleteCalendarException(params.id)

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'delete_calendar_exception',
    entity_type: 'calendar_exception',
    entity_id: params.id,
    details: { id: params.id },
  })
}

