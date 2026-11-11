import { AppError } from '../../lib/errors/app-error.js'
import {
  assertCmsAccountManager,
  isCmsAccountAdmin,
  cmsManagedPklRoles,
  validateCmsAccountChange,
  type CmsAccountList,
  type CmsAccountInsert,
  type CmsAccountMutation,
} from '../../modules/cms/accounts.js'
import { cmsProfileSchema, type CmsProfile } from '../../modules/cms/schema.js'
import { cmsJurusanAliases } from '../../modules/cms/content.js'
import { assertMemoryCmsAuthority } from './cms-authority.js'
import type { MemoryCmsState } from './cms-content.js'
function validateDepartment(store: MemoryCmsState, profile: CmsProfile) {
  if (profile.role !== 'admin_jurusan') return
  const department = profile.jurusan_id
    ? store.cmsContent.get('jurusan')?.get(profile.jurusan_id)
    : null
  if (
    !department ||
    !cmsJurusanAliases(profile.jurusan_slug ?? '').includes(String(department.slug).toLowerCase())
  )
    throw AppError.validationError('Department binding does not match an existing department.')
}
export function listMemoryCmsAccounts(store: MemoryCmsState, params: CmsAccountList): CmsProfile[] {
  assertMemoryCmsAuthority(store, params.access)
  assertCmsAccountManager(params.access)
  return structuredClone(
    [...store.cmsProfiles.values()]
      .filter(
        (row) =>
          (!params.id || row.id === params.id) &&
          (isCmsAccountAdmin(params.access) || cmsManagedPklRoles.has(row.role)),
      )
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(params.offset, params.offset + params.limit),
  )
}
export function insertMemoryCmsAccount(
  store: MemoryCmsState,
  params: CmsAccountInsert,
): CmsProfile {
  assertMemoryCmsAuthority(store, params.access)
  validateCmsAccountChange(params.access, null, params.data)
  if (
    [...store.cmsProfiles.values()].some(
      (row) => row.id === params.id || row.logto_subject === params.subject,
    )
  )
    throw AppError.conflict('CMS identity is already bound.')
  const profile = cmsProfileSchema.parse({
    ...params.data,
    id: params.id,
    logto_subject: params.subject,
    jurusan_id: params.data.jurusan_id ?? null,
    jurusan_slug: params.data.jurusan_slug ?? null,
    access_enabled: false,
    created_at: new Date().toISOString(),
    authz_version: 1,
    session_valid_after: null,
  })
  validateDepartment(store, profile)
  store.cmsProfiles.set(params.subject, profile)
  store.cmsContentAudit.push({
    actor_id: params.access.id,
    resource: 'profiles',
    action: 'create',
    before: null,
    after: { ...profile },
  })
  return structuredClone(profile)
}
export function mutateMemoryCmsAccount(
  store: MemoryCmsState,
  params: CmsAccountMutation,
): CmsProfile {
  assertMemoryCmsAuthority(store, params.access)
  const before = [...store.cmsProfiles.values()].find((row) => row.id === params.id)
  if (!before) throw AppError.notFound('CMS account')
  validateCmsAccountChange(params.access, before, params.data)
  const after = { ...before, ...params.data }
  if (after.role !== 'admin_jurusan') {
    after.jurusan_id = null
    after.jurusan_slug = null
  }
  validateDepartment(store, after)
  if (
    (['role', 'jurusan_id', 'jurusan_slug', 'access_enabled'] as const).some(
      (key) => after[key] !== before[key],
    )
  ) {
    after.authz_version++
    after.session_valid_after = new Date().toISOString()
  }
  if (params.invalidate_sessions) after.session_valid_after = new Date().toISOString()
  store.cmsProfiles.set(after.logto_subject, after)
  store.cmsContentAudit.push({
    actor_id: params.access.id,
    resource: params.invalidate_sessions ? 'account_password' : 'profiles',
    action: 'update',
    before: { ...before },
    after: { ...after },
  })
  return structuredClone(after)
}
