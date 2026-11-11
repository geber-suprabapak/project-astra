import { z } from 'zod'
import { AppError } from '../../lib/errors/app-error.js'
import { cmsRoleSchema, type CmsProfile, type CmsSession } from './schema.js'
import { pklAdminRoles } from '../pkl/policy.js'

export const cmsAccountCreateSchema = z
  .object({
    email: z.email().trim().toLowerCase(),
    full_name: z.string().trim().min(1).max(200),
    password: z.string().min(6).max(1024),
    role: cmsRoleSchema,
    jurusan_id: z.uuid().nullable().optional(),
    jurusan_slug: z.string().trim().min(1).max(100).nullable().optional(),
  })
  .strict()
export const cmsAccountPatchSchema = cmsAccountCreateSchema
  .omit({ email: true, password: true })
  .partial()
  .extend({ access_enabled: z.boolean().optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Empty account update.')
export type CmsAccountPatch = z.infer<typeof cmsAccountPatchSchema>
export type CmsAccountCreate = z.infer<typeof cmsAccountCreateSchema>
export interface CmsAccountMutation {
  access: CmsSession
  id: string
  data: CmsAccountPatch
  invalidate_sessions?: boolean
}
export interface CmsAccountInsert {
  access: CmsSession
  id: string
  subject: string
  data: Omit<CmsAccountCreate, 'password'>
}
export const cmsManagedPklRoles = new Set([
  'siswa',
  'guru',
  'industri',
  'pembimbing_sekolah',
  'pembimbing_industri',
  'supervisor',
])
export function isCmsAccountAdmin(access: CmsSession) {
  return access.role === 'super_admin' || access.role === 'admin'
}
export function assertCmsAccountManager(access: CmsSession, targetRole?: CmsProfile['role']) {
  if (
    !isCmsAccountAdmin(access) &&
    (!pklAdminRoles.has(access.role) || (targetRole && !cmsManagedPklRoles.has(targetRole)))
  )
    throw AppError.forbidden()
  if (targetRole === 'super_admin' && access.role !== 'super_admin') throw AppError.forbidden()
}
export function accountView(profile: CmsProfile) {
  return {
    id: profile.id,
    email: profile.email,
    full_name: profile.full_name,
    created_at: profile.created_at ?? null,
    role: profile.role,
    jurusan_id: profile.jurusan_id,
    jurusan_slug: profile.jurusan_slug,
    access_enabled: profile.access_enabled,
    authz_version: profile.authz_version,
  }
}
export function validateCmsAccountChange(
  access: CmsSession,
  before: CmsProfile | null,
  data: CmsAccountPatch,
) {
  assertCmsAccountManager(access, before?.role ?? data.role)
  if (data.role) assertCmsAccountManager(access, data.role)
  if (
    before?.id === access.id &&
    (data.access_enabled === false || (data.role && data.role !== before.role))
  )
    throw AppError.conflict('Administrators cannot disable or change their own authority.')
  if (
    before &&
    !isCmsAccountAdmin(access) &&
    (data.role || data.jurusan_id !== undefined || data.jurusan_slug !== undefined)
  )
    throw AppError.forbidden()
  const role = data.role ?? before?.role
  if (
    role === 'admin_jurusan' &&
    (!(data.jurusan_id !== undefined ? data.jurusan_id : before?.jurusan_id) ||
      !(data.jurusan_slug !== undefined ? data.jurusan_slug : before?.jurusan_slug))
  )
    throw AppError.validationError(
      'Department administrators require an explicit department binding.',
    )
}

export interface CmsAccountList {
  access: CmsSession
  id?: string
  limit: number
  offset: number
}
