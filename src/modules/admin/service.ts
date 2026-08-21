import type { IdentityRole, IdentityUser, ProfileLifecycleStatus } from '../../providers/types.js'
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
