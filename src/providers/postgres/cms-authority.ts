import type { TransactionSql } from 'postgres'
import { AppError } from '../../lib/errors/app-error.js'
import type { CmsSession } from '../../modules/cms/schema.js'

export async function lockCmsAuthority(sql: TransactionSql, access: CmsSession) {
  const rows = await sql<(CmsSession & { access_enabled: boolean })[]>`
    SELECT role, jurusan_id, jurusan_slug, authz_version, access_enabled FROM cms.profiles
    WHERE id = ${access.id} FOR SHARE
  `
  if (
    !rows[0]?.access_enabled ||
    rows[0].authz_version !== access.authz_version ||
    rows[0].role !== access.role ||
    rows[0].jurusan_id !== access.jurusan_id ||
    rows[0].jurusan_slug !== access.jurusan_slug
  ) {
    throw AppError.forbidden('CMS authorization has changed.')
  }
}
