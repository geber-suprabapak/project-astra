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

export const bootstrapSchoolSchema = z.object({
  name: z.string().min(1, 'School name is required.'),
  slug: z
    .string()
    .min(1, 'School slug is required.')
    .regex(/^[a-z0-9-_]+$/, 'School slug must contain only lowercase letters, numbers, hyphens, and underscores.'),
  timezone: z.string().min(1).default('Asia/Jakarta').optional(),
})

export type BootstrapSchoolInput = z.infer<typeof bootstrapSchoolSchema>

export const createSchoolAdminSchema = z
  .object({
    user_id: z.string().min(1, 'User ID is required.').optional(),
    userId: z.string().min(1, 'User ID is required.').optional(),
    full_name: z.string().nullable().optional(),
    fullName: z.string().nullable().optional(),
    email: z.string().email().nullable().optional(),
  })
  .refine((data) => Boolean(data.user_id || data.userId), {
    message: 'User ID is required.',
    path: ['user_id'],
  })

export type CreateSchoolAdminInput = z.infer<typeof createSchoolAdminSchema>

export const rosterRowSchema = z.object({
  nis: z.string(),
  full_name: z.string(),
  class_name: z.string(),
  grade: z.number().int().positive().nullable().optional(),
})

export const stageRosterSchema = z.object({
  rows: z.array(rosterRowSchema).min(1, 'Roster must contain at least one row.'),
})

export type StageRosterInput = z.infer<typeof stageRosterSchema>

export const rosterReportResponseSchema = z.object({
  id: z.string(),
  school_id: z.string().nullable().optional(),
  total_rows: z.number(),
  valid_rows: z.number(),
  rejected_rows: z.number(),
  status: z.enum(['staged', 'accepted', 'rejected']),
  review_state: z.enum(['pending', 'accepted', 'rejected']),
  rejected_items: z.array(
    z.object({
      row_index: z.number(),
      nis: z.string().nullable().optional(),
      full_name: z.string().nullable().optional(),
      class_name: z.string().nullable().optional(),
      grade: z.number().nullable().optional(),
      reason: z.string(),
    }),
  ),
  accepted_at: z.string().nullable().optional(),
  accepted_by: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export type RosterReportResponse = z.infer<typeof rosterReportResponseSchema>
