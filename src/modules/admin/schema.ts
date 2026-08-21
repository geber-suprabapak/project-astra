import { z } from 'zod'
import { identityRoleSchema, profileLifecycleStatusSchema } from '../../providers/types.js'
export const privilegedSessionSchema = z.object({
  user_id: z.string().min(1),
  role: identityRoleSchema.nullable(),
  profile_status: profileLifecycleStatusSchema,
  mfa_verified: z.boolean(),
  must_change_password: z.boolean(),
})

export type PrivilegedSession = z.infer<typeof privilegedSessionSchema>
