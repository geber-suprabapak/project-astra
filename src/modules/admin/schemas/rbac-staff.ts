import { z } from 'zod'
import { profileLifecycleStatusSchema } from '../../../providers/types.js'

export const createRoleSchema = z.object({
  name: z
    .string()
    .min(1, 'Role name is required.')
    .regex(
      /^[a-z0-9-_]+$/,
      'Role name must be lowercase alphanumeric with hyphens or underscores.',
    ),
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
