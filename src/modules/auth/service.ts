import { randomBytes } from 'node:crypto'
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
    throw AppError.validationError(
      `NIS "${input.nis}" is not found in the accepted student roster.`,
    )
  }

  // 3. Check if an active/pending profile already exists for this NIS
  const fullName = input.full_name?.trim() || rosterStudent.full_name
  const existingProfile = await providers.domainStore.getProfileByNis(input.nis)
  if (existingProfile) {
    if (existingProfile.lifecycle_status === 'approved') {
      throw AppError.conflict(
        `A student account is already registered or pending approval for NIS "${input.nis}".`,
      )
    }

    if (existingProfile.lifecycle_status === 'pending' && existingProfile.email) {
      if (existingProfile.email !== input.email) {
        throw AppError.conflict(
          `A student account is already registered or pending approval for NIS "${input.nis}".`,
        )
      }

      // Recoverable retry for the same NIS + email after an interrupted registration
      if (rosterStudent.student_id) {
        await providers.domainStore.bindStudentToUser({
          studentId: rosterStudent.student_id,
          userId: existingProfile.user_id,
        })
      }

      const existingAudits = await providers.domainStore.getAuditLogs(
        'profile',
        existingProfile.user_id,
      )
      if (!existingAudits.some((entry) => entry.action === 'student_signup')) {
        await providers.domainStore.insertAuditLog({
          actor_id: existingProfile.user_id,
          action: 'student_signup',
          entity_type: 'profile',
          entity_id: existingProfile.user_id,
          details: {
            nis: input.nis,
            email: input.email,
            full_name: fullName,
            class_name: rosterStudent.class_name,
            student_id: rosterStudent.student_id ?? null,
          },
        })
      }

      return existingProfile
    }

    throw AppError.conflict(
      `A student account is already registered or pending approval for NIS "${input.nis}".`,
    )
  }

  // 4. Create identity in IdentityProvider (suspended / disabled until school admin approval).
  // Never persist caller-supplied credentials from an unverified signup request; first
  // sign-in credentials must be established via admin-issued reset-code handoff.
  const bootstrapSecret = randomBytes(24).toString('base64url')
  const identity = await (providers.identityProvider.createStudentIdentity
    ? providers.identityProvider.createStudentIdentity({
        username: input.nis,
        email: input.email,
        password: bootstrapSecret,
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

  if (rosterStudent.student_id) {
    await providers.domainStore.bindStudentToUser({
      studentId: rosterStudent.student_id,
      userId: identity.userId,
    })
  }

  // 6. Audit log (idempotent check in case of partial recovery)
  const existingAudits = await providers.domainStore.getAuditLogs('profile', identity.userId)
  if (!existingAudits.some((entry) => entry.action === 'student_signup')) {
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
        student_id: rosterStudent.student_id ?? null,
      },
    })
  }

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

  // 3. Update password in identity provider BEFORE consuming the one-time reset code
  // so transient 500/network failures do not burn the student's one-time recovery code.
  await providers.identityProvider.updatePassword(profile.user_id, input.new_password)

  // 4. Mark reset code as used (cannot be reused)
  await providers.domainStore.markPasswordResetCodeUsed(resetCode.id)

  // 5. Revoke sessions for security (both Astra-side and IdP-side)
  await providers.domainStore.revokeUserSessions(profile.user_id)
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
