import { randomInt } from 'node:crypto'
import { AppError } from '../../../lib/errors/app-error.js'
import type {
  AppProviders,
  IdentityRole,
  ProfileLifecycleStatus,
  StudentRosterRow,
  UserProfile,
} from '../../../providers/types.js'
import { getCanonicalProfile } from '../../profile/canonical-profile.js'
import { assertAdminAccess, assertChronosStaffAccess } from './shared.js'

async function getStudentProfileOrThrow(
  providers: AppProviders,
  userId: string,
): Promise<UserProfile> {
  const profile = await providers.domainStore.getUserProfile(userId)
  if (profile.role !== 'student') {
    throw AppError.notFound('Student profile')
  }
  return profile
}

export async function listStudents(params: {
  status?: ProfileLifecycleStatus
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<StudentRosterRow[]> {
  assertChronosStaffAccess(params.actorRole)

  const rows = await params.providers.domainStore.listStudentProfiles(
    params.status ? { lifecycle_status: params.status } : undefined,
  )

  if (params.actorRole === 'teacher' || params.actorRole === 'staff') {
    return rows.map((row) => ({
      student_id: row.student_id,
      user_id: row.user_id,
      full_name: row.full_name,
      nis: row.nis ?? null,
      class_id: row.class_id ?? null,
      class_name: row.class_name ?? null,
      absence_number: row.absence_number ?? null,
      gender: row.gender ?? null,
      academic_period_id: row.academic_period_id ?? null,
      period_name: row.period_name ?? null,
      lifecycle_status: row.lifecycle_status,
    }))
  }

  return rows
}

export async function getStudent(params: {
  userId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<UserProfile> {
  assertAdminAccess(params.actorRole)

  const profile = await getCanonicalProfile(params.userId, params.providers)
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
  assertAdminAccess(params.actorRole)

  const profile = await getStudentProfileOrThrow(params.providers, params.userId)

  // Keep Astra's access gate closed until every identity operation succeeds; retries are safe.
  if (params.providers.identityProvider.assignUserRole) {
    await params.providers.identityProvider.assignUserRole(params.userId, 'student')
  }
  if (params.providers.identityProvider.setUserSuspended) {
    await params.providers.identityProvider.setUserSuspended(params.userId, false)
  }

  const updated = await params.providers.domainStore.updateProfileLifecycle(
    params.userId,
    'approved',
  )

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

  await params.providers.domainStore.enqueueNotification({
    userId: params.userId,
    channel: 'push',
    eventKey: `student_approved:${params.userId}`,
    payload: {
      title: 'Akun Disetujui',
      body: 'Pendaftaran akun Anda telah disetujui oleh admin sekolah.',
      type: 'student_approved',
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
  assertAdminAccess(params.actorRole)

  const profile = await getStudentProfileOrThrow(params.providers, params.userId)

  const updated = await params.providers.domainStore.updateProfileLifecycle(
    params.userId,
    'rejected',
  )

  await params.providers.domainStore.updateUserProfile(params.userId, { nis: null })
  if (profile.nis) {
    await params.providers.domainStore.unbindStudentByNis?.(profile.nis)
  }

  if (params.providers.identityProvider.setUserSuspended) {
    await params.providers.identityProvider.setUserSuspended(params.userId, true)
  }
  if (params.providers.identityProvider.revokeUserSessions) {
    await params.providers.identityProvider.revokeUserSessions(params.userId)
  }
  if (params.providers.identityProvider.deleteUser) {
    await params.providers.identityProvider.deleteUser(params.userId)
  }
  await params.providers.domainStore.revokeUserSessions(params.userId)

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

  await params.providers.domainStore.enqueueNotification({
    userId: params.userId,
    channel: 'email',
    eventKey: `student_rejected:${params.userId}`,
    payload: {
      title: 'Pendaftaran Akun Ditolak',
      body: `Pendaftaran akun Anda ditolak.${params.reason ? ` Alasan: ${params.reason}` : ''}`,
      rejection_reason: params.reason ?? null,
      type: 'student_rejected',
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
  assertAdminAccess(params.actorRole)

  const profile = await getStudentProfileOrThrow(params.providers, params.userId)

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
  await params.providers.domainStore.revokeUserSessions(params.userId)

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
  assertAdminAccess(params.actorRole)

  const profile = await getStudentProfileOrThrow(params.providers, params.userId)

  if (profile.lifecycle_status !== 'approved') {
    throw AppError.validationError(
      'Cannot generate password reset code for non-approved student profile.',
    )
  }

  const code = randomInt(100000, 1000000).toString()
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

  await params.providers.domainStore.enqueueNotification({
    userId: params.userId,
    channel: 'email',
    payload: {
      title: 'Kode Reset Kata Sandi',
      body: `Kode verifikasi reset kata sandi Anda: ${code}`,
      code,
      expires_at: expiresAt,
      type: 'password_reset_code',
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
  assertAdminAccess(params.actorRole)

  const profile = await getStudentProfileOrThrow(params.providers, params.userId)

  const oldEmail = profile.email
  if (params.providers.identityProvider.updateUserEmail) {
    await params.providers.identityProvider.updateUserEmail(params.userId, params.email)
  }

  let updated: UserProfile
  try {
    updated = await params.providers.domainStore.updateProfileEmail(params.userId, params.email)
  } catch (err) {
    if (oldEmail && params.providers.identityProvider.updateUserEmail) {
      await params.providers.identityProvider
        .updateUserEmail(params.userId, oldEmail)
        .catch(() => {})
    }
    throw err
  }

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'correct_student_email',
    entity_type: 'profile',
    entity_id: params.userId,
    details: {
      nis: profile.nis,
      previous_email: oldEmail,
      new_email: params.email,
    },
  })

  return updated
}

export async function resetStudentFaceEnrollment(params: {
  userId: string
  requestId: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<void> {
  assertAdminAccess(params.actorRole)

  const profile = await getStudentProfileOrThrow(params.providers, params.userId)

  await params.providers.robinClient.deleteEnrollment(undefined, params.requestId, params.userId)
  await params.providers.objectStorage.deleteFaceEnrollmentImages(params.userId)
  await params.providers.domainStore.deleteFaceEnrollmentFiles(params.userId)
  await params.providers.domainStore.deleteFaceEnrollment(params.userId)

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'reset_student_face_enrollment',
    entity_type: 'face_enrollment',
    entity_id: params.userId,
    details: {
      nis: profile.nis,
    },
  })
}
