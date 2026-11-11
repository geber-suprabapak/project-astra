import type { Sql, TransactionSql } from 'postgres'
import { AppError } from '../../lib/errors/app-error.js'
import { cmsProfileSchema, type CmsProfile } from '../../modules/cms/schema.js'
import {
  assertCmsAccountManager,
  isCmsAccountAdmin,
  cmsManagedPklRoles,
  validateCmsAccountChange,
  type CmsAccountList,
  type CmsAccountInsert,
  type CmsAccountMutation,
} from '../../modules/cms/accounts.js'
import { cmsJurusanAliases } from '../../modules/cms/content.js'
import { lockCmsAuthority } from './cms-authority.js'

async function audit(
  sql: TransactionSql,
  access: CmsAccountMutation['access'],
  action: 'create' | 'update',
  before: CmsProfile | null,
  after: CmsProfile,
  resource = 'profiles',
) {
  await sql`INSERT INTO cms.content_audit(actor_id,actor_name,actor_role,resource,record_id,action,before_data,after_data) VALUES (${access.id},${access.full_name},${access.role},${resource},${after.id},${action},${sql.json(before)},${sql.json(after)})`
}
async function validateDepartment(
  sql: TransactionSql,
  profile: Pick<CmsProfile, 'role' | 'jurusan_id' | 'jurusan_slug'>,
) {
  if (profile.role !== 'admin_jurusan') return
  if (!profile.jurusan_id || !profile.jurusan_slug)
    throw AppError.validationError('Department binding is required.')
  const rows =
    await sql`SELECT id FROM cms.jurusan WHERE id = ${profile.jurusan_id} AND lower(slug) = ANY(${cmsJurusanAliases(profile.jurusan_slug)}::text[]) FOR SHARE`
  if (!rows[0])
    throw AppError.validationError('Department binding does not match an existing department.')
}
export async function listCmsAccounts(sql: Sql, params: CmsAccountList): Promise<CmsProfile[]> {
  assertCmsAccountManager(params.access)
  return sql.begin(async (tx) => {
    await lockCmsAuthority(tx, params.access)
    const roles = isCmsAccountAdmin(params.access)
      ? tx`true`
      : tx`profile.role = ANY(${[...cmsManagedPklRoles]}::text[])`
    const filter = params.id ? tx`profile.id = ${params.id}` : tx`true`
    const rows = await tx<
      { data: CmsProfile }[]
    >`SELECT to_jsonb(profile.*) AS data FROM cms.profiles profile WHERE ${roles} AND ${filter} ORDER BY profile.id LIMIT ${params.limit} OFFSET ${params.offset}`
    return rows.map((row) => cmsProfileSchema.parse(row.data))
  })
}
export async function insertCmsAccount(sql: Sql, params: CmsAccountInsert): Promise<CmsProfile> {
  validateCmsAccountChange(params.access, null, params.data)
  return sql.begin(async (tx) => {
    await lockCmsAuthority(tx, params.access)
    const profile = {
      role: params.data.role,
      jurusan_id: params.data.jurusan_id ?? null,
      jurusan_slug: params.data.jurusan_slug ?? null,
    }
    await validateDepartment(tx, profile)
    const rows = await tx<
      { data: CmsProfile }[]
    >`INSERT INTO cms.profiles AS profile(id, logto_subject, email, full_name, role, jurusan_id, jurusan_slug, access_enabled) VALUES (${params.id}, ${params.subject}, ${params.data.email}, ${params.data.full_name}, ${profile.role}, ${profile.jurusan_id}, ${profile.jurusan_slug}, false) RETURNING to_jsonb(profile.*) AS data`
    const after = cmsProfileSchema.parse(rows[0]!.data)
    await audit(tx, params.access, 'create', null, after)
    return after
  })
}
export async function mutateCmsAccount(sql: Sql, params: CmsAccountMutation): Promise<CmsProfile> {
  return sql.begin(async (tx) => {
    await lockCmsAuthority(tx, params.access)
    const rows = await tx<
      { data: CmsProfile }[]
    >`SELECT to_jsonb(profile.*) AS data FROM cms.profiles profile WHERE id = ${params.id} FOR UPDATE`
    if (!rows[0]) throw AppError.notFound('CMS account')
    const before = cmsProfileSchema.parse(rows[0].data)
    validateCmsAccountChange(params.access, before, params.data)
    const after = { ...before, ...params.data }
    if (after.role !== 'admin_jurusan') {
      after.jurusan_id = null
      after.jurusan_slug = null
    }
    await validateDepartment(tx, after)
    const updated = await tx<
      { data: CmsProfile }[]
    >`UPDATE cms.profiles AS profile SET full_name = ${after.full_name}, role = ${after.role}, jurusan_id = ${after.jurusan_id}, jurusan_slug = ${after.jurusan_slug}, access_enabled = ${after.access_enabled}, session_valid_after = ${params.invalidate_sessions ? new Date().toISOString() : before.session_valid_after} WHERE id = ${before.id} RETURNING to_jsonb(profile.*) AS data`
    const result = cmsProfileSchema.parse(updated[0]!.data)
    await audit(
      tx,
      params.access,
      'update',
      before,
      result,
      params.invalidate_sessions ? 'account_password' : 'profiles',
    )
    return result
  })
}
