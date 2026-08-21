import { AppError } from '../../lib/errors/app-error.js'
import type { AppProviders, UserProfile } from '../../providers/types.js'
import type { StudentResetPasswordInput, StudentSignupInput } from './schema.js'

export async function registerStudent(
  input: StudentSignupInput,
  providers: AppProviders,
): Promise<UserProfile> {
  // 1. Check if signup is open
  const signupOpen = await providers.domainStore.isSignupOpen()
  if (!signupOpen) {
    throw AppError.conflict('Student signup is currently closed.')
  }

  // 2. Validate that NIS is present in the accepted student roster
  const rosterStudent = await providers.domainStore.getRosterStudentByNis(input.nis)
  if (!rosterStudent) {
    throw AppError.validationError(`NIS "${input.nis}" is not found in the accepted student roster.`)
  }

  // 3. Check if an active/pending profile already exists for this NIS
  const existingProfile = await providers.domainStore.getProfileByNis(input.nis)
  if (
    existingProfile &&
    (existingProfile.lifecycle_status === 'pending' || existingProfile.lifecycle_status === 'approved') &&
    existingProfile.email
  ) {
    throw AppError.conflict(
      `A student account is already registered or pending approval for NIS "${input.nis}".`,
    )
  }

  // 4. Create identity in IdentityProvider (suspended / disabled until school admin approval)
  const fullName = input.full_name?.trim() || rosterStudent.full_name
  const identity = await (providers.identityProvider.createStudentIdentity
    ? providers.identityProvider.createStudentIdentity({
        username: input.nis,
        email: input.email,
        password: input.password,
        name: fullName,
        suspended: true,
        roles: ['student'],
      })
    : Promise.resolve({ userId: `student-user-${input.nis}-${Date.now()}` }))

  // 5. Create pending profile in DomainStore
  const profile = await providers.domainStore.createPendingStudentProfile({
    userId: identity.userId,
    nis: input.nis,
    email: input.email,
    fullName,
    className: rosterStudent.class_name,
  })

  // 6. Audit log
  await providers.domainStore.insertAuditLog({
    actor_id: identity.userId,
    action: 'student_signup',
    entity_type: 'profile',
    entity_id: identity.userId,
    details: {
      nis: input.nis,
      email: input.email,
      full_name: fullName,
      class_name: rosterStudent.class_name,
    },
  })

  return profile
}

export async function resetStudentPassword(
  input: StudentResetPasswordInput,
  providers: AppProviders,
): Promise<{ success: boolean; message: string }> {
  // 1. Find student profile by NIS
  const profile = await providers.domainStore.getProfileByNis(input.nis)
  if (!profile || profile.lifecycle_status !== 'approved') {
    throw AppError.authInvalid('Invalid NIS or student profile is not active.')
  }

  // 2. Validate reset code
  const resetCode = await providers.domainStore.getActivePasswordResetCode(
    profile.user_id,
    input.code,
  )
  if (!resetCode) {
    throw AppError.authInvalid('Invalid or expired password reset code.')
  }

  // 3. Mark reset code as used (cannot be reused)
  await providers.domainStore.markPasswordResetCodeUsed(resetCode.id)

  // 4. Update password in identity provider
  await providers.identityProvider.updatePassword(profile.user_id, input.new_password)

  // 5. Revoke sessions for security
  if (providers.identityProvider.revokeUserSessions) {
    await providers.identityProvider.revokeUserSessions(profile.user_id)
  }

  // 6. Audit log
  await providers.domainStore.insertAuditLog({
    actor_id: profile.user_id,
    action: 'student_password_reset',
    entity_type: 'profile',
    entity_id: profile.user_id,
    details: {
      nis: input.nis,
      code_id: resetCode.id,
    },
  })

  return {
    success: true,
    message: 'Password has been reset successfully. You can now log in with your new password.',
  }
}
