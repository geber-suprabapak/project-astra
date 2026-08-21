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

export const createRoleSchema = z.object({
  name: z
    .string()
    .min(1, 'Role name is required.')
    .regex(/^[a-z0-9-_]+$/, 'Role name must be lowercase alphanumeric with hyphens or underscores.'),
  description: z.string().nullable().optional(),
  permissions: z.array(z.string().min(1)).optional(),
})

export type CreateRoleInput = z.infer<typeof createRoleSchema>

export const updateRoleSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-_]+$/, 'Role name must be lowercase alphanumeric with hyphens or underscores.')
    .optional(),
  description: z.string().nullable().optional(),
  permissions: z.array(z.string().min(1)).optional(),
  is_active: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>

export const roleResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  is_active: z.boolean(),
  permissions: z.array(z.string()).optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export type RoleResponse = z.infer<typeof roleResponseSchema>

export const createPermissionSchema = z.object({
  name: z.string().min(1, 'Permission name is required.'),
  description: z.string().nullable().optional(),
})

export type CreatePermissionInput = z.infer<typeof createPermissionSchema>

export const permissionResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export type PermissionResponse = z.infer<typeof permissionResponseSchema>

export const createStaffSchema = z
  .object({
    user_id: z.string().min(1).optional(),
    userId: z.string().min(1).optional(),
    email: z.string().email('Valid email is required.'),
    full_name: z.string().min(1).nullable().optional(),
    fullName: z.string().min(1).nullable().optional(),
    role: z.string().min(1, 'Role is required.'),
    roles: z.array(z.string().min(1)).optional(),
    gender: z.string().nullable().optional(),
    password: z.string().min(6).optional(),
  })
  .refine((data) => Boolean(data.full_name || data.fullName), {
    message: 'Full name is required.',
    path: ['full_name'],
  })

export type CreateStaffInput = z.infer<typeof createStaffSchema>

export const updateStaffSchema = z.object({
  full_name: z.string().min(1).nullable().optional(),
  fullName: z.string().min(1).nullable().optional(),
  role: z.string().min(1).optional(),
  roles: z.array(z.string().min(1)).optional(),
  lifecycle_status: profileLifecycleStatusSchema.optional(),
  lifecycleStatus: profileLifecycleStatusSchema.optional(),
  gender: z.string().nullable().optional(),
})

export type UpdateStaffInput = z.infer<typeof updateStaffSchema>

export const staffResponseSchema = z.object({
  user_id: z.string(),
  full_name: z.string().nullable(),
  email: z.string().nullable().optional(),
  nis: z.string().nullable().optional(),
  class_name: z.string().nullable().optional(),
  absence_number: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  lifecycle_status: profileLifecycleStatusSchema,
  gender: z.string().nullable().optional(),
  roles: z.array(z.string()).optional(),
  effective_permissions: z.array(z.string()).optional(),
})

export type StaffResponse = z.infer<typeof staffResponseSchema>

export const requestStaffPasswordResetSchema = z.object({
  email: z.string().email().optional(),
})

export type RequestStaffPasswordResetInput = z.infer<typeof requestStaffPasswordResetSchema>

export const effectivePermissionsResponseSchema = z.object({
  user_id: z.string(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
})

export type EffectivePermissionsResponse = z.infer<typeof effectivePermissionsResponseSchema>

export const updateStudentEmailSchema = z.object({
  email: z.string().trim().email('Valid email is required.'),
})

export type UpdateStudentEmailInput = z.infer<typeof updateStudentEmailSchema>

export const rejectStudentSchema = z.object({
  reason: z.string().trim().optional(),
})

export type RejectStudentInput = z.infer<typeof rejectStudentSchema>

