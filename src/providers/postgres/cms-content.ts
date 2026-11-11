import { lockCmsAuthority } from './cms-authority.js'
import postgres, { type Sql, type TransactionSql } from 'postgres'
import { z } from 'zod'
import { AppError } from '../../lib/errors/app-error.js'
import {
  assertCmsContentReadAccess,
  cmsJurusanAliases,
  cmsPublicFields,
  getCmsContentResource,
  prepareCmsContentWrite,
  validateCmsContentRecord,
  type CmsContentInput,
  type CmsContentImport,
  type CmsContentList,
  type CmsContentMutation,
  type CmsContentRow,
} from '../../modules/cms/content.js'

function contentWhere(sql: Sql | TransactionSql, params: CmsContentList) {
  const resource = getCmsContentResource(params.resource)
  let condition = sql`true`
  if (!params.access && !resource.singleton)
    condition = sql`${condition} AND content.is_published = true`
  if (!params.access && params.resource === 'berita') {
    condition = sql`${condition} AND content.published_at <= now()`
  }
  if (params.access?.role === 'admin_jurusan') {
    if (resource.scope === 'id')
      condition = sql`${condition} AND content.id = ${params.access.jurusan_id}`
    else {
      const aliases = cmsJurusanAliases(params.access.jurusan_slug!)
      condition = sql`${condition} AND (
        content.jurusan_id = ${params.access.jurusan_id}
        OR (content.jurusan_id IS NULL AND lower(content.jurusan) = ANY(${aliases}::text[]))
      )`
    }
  }
  if (params.access?.role === 'jurnalistik' && params.resource === 'berita') {
    condition = sql`${condition} AND COALESCE(content.page, 'umum') IN ('', 'umum')`
  }
  if (params.query.search)
    condition = sql`${condition} AND strpos(lower(content.name), lower(${params.query.search})) > 0`
  if (params.query.id) condition = sql`${condition} AND content.id = ${params.query.id}`
  for (const field of [
    'slug',
    'jurusan',
    'category',
    'page',
    'year_label',
    'is_published',
  ] as const) {
    const value = params.query[field]
    if (value === undefined) continue
    const column = sql('content.' + field)
    if (field === 'jurusan' || (field === 'slug' && params.resource === 'jurusan')) {
      condition = sql`${condition} AND lower(${column}) = ANY(${cmsJurusanAliases(value)}::text[])`
    } else if (field === 'is_published') {
      condition = sql`${condition} AND ${column} = ${value === 'true'}`
    } else condition = sql`${condition} AND ${column} = ${value}`
  }
  return condition
}

export async function listCmsContent(sql: Sql, params: CmsContentList): Promise<CmsContentRow[]> {
  const resource = getCmsContentResource(params.resource)
  if (params.access) assertCmsContentReadAccess(params.resource, params.access)
  const fields = params.access
    ? ['id', 'created_at', 'updated_at', ...resource.schema.keyof().options]
    : cmsPublicFields(params.resource)
  const read = async (query: Sql | TransactionSql) => {
    const direction = params.query.direction === 'desc' ? query`DESC` : query`ASC`
    const rows = await query<{ data: CmsContentRow }[]>`
      SELECT (SELECT jsonb_object_agg(key, value)
              FROM jsonb_each(to_jsonb(content.*)) WHERE key = ANY(${fields}::text[])) AS data
      FROM ${query('cms.' + params.resource)} AS content
      WHERE ${contentWhere(query, params)}
      ORDER BY ${query('content.' + params.query.sort)} ${direction} NULLS LAST, content.id ASC
      LIMIT ${params.query.limit + 1} OFFSET ${params.query.offset}
    `
    return rows.map((row) => row.data)
  }
  if (!params.access) return read(sql)
  const access = params.access
  return sql.begin(async (tx) => {
    await lockCmsAuthority(tx, access)
    return read(tx)
  })
}

export async function mutateCmsContent(
  sql: Sql,
  params: CmsContentMutation,
): Promise<CmsContentRow> {
  try {
    return await sql.begin((tx) => applyCmsContentMutation(tx, params))
  } catch (error) {
    if (error instanceof postgres.PostgresError) throwCmsContentError(error)
    throw error
  }
}

async function applyCmsContentMutation(
  tx: TransactionSql,
  params: CmsContentMutation,
): Promise<CmsContentRow> {
  const data = prepareCmsContentWrite(params)
  await lockCmsAuthority(tx, params.access)
  const table = tx('cms.' + params.resource)
  let before: CmsContentRow | null = null
  if (params.action !== 'create') {
    if (!params.id) throw AppError.validationError('Content ID is required.')
    const scoped: CmsContentList = {
      resource: params.resource,
      access: params.access,
      query: { id: params.id, limit: 1, offset: 0, sort: 'id', direction: 'asc' },
    }
    const rows = await tx<{ data: CmsContentRow }[]>`
          SELECT to_jsonb(content.*) AS data FROM ${table} AS content
          WHERE ${contentWhere(tx, scoped)} FOR UPDATE
        `
    before = rows[0]?.data ?? null
    if (!before) throw AppError.notFound('CMS content')
  } else if (getCmsContentResource(params.resource).singleton) {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`cms:${params.resource}`}, 0))`
    const existing = await tx`SELECT id FROM ${table} LIMIT 1`
    if (existing.length) throw AppError.conflict('CMS singleton already exists.')
  }
  let after: CmsContentRow | null = null
  if (params.action === 'delete') {
    await tx`DELETE FROM ${table} WHERE id = ${params.id!}`
  } else {
    const columns = Object.keys(data)
    const payload: CmsContentInput = { ...data }
    const projection = tx(columns)
    const rows =
      params.action === 'create'
        ? await tx<{ data: CmsContentRow }[]>`
              INSERT INTO ${table} AS content (${projection})
              SELECT ${projection} FROM jsonb_populate_record(NULL::${table}, ${tx.json(payload)})
              RETURNING to_jsonb(content.*) AS data
            `
        : await tx<{ data: CmsContentRow }[]>`
              UPDATE ${table} AS content SET (${projection}) = (
                SELECT ${projection} FROM jsonb_populate_record(NULL::${table}, ${tx.json(payload)})
              ), updated_at = now()
              WHERE id = ${params.id!}
              RETURNING to_jsonb(content.*) AS data
            `
    after = rows[0]?.data ?? null
    if (!after) throw AppError.notFound('CMS content')
  }
  const row = after ?? before!
  if (params.action !== 'delete') validateCmsContentRecord(params.resource, row)
  await tx`
        INSERT INTO cms.content_audit
          (actor_id, actor_name, actor_role, resource, record_id, action, before_data, after_data)
        VALUES (${params.access.id}, ${params.access.full_name}, ${params.access.role}, ${params.resource},
          ${row.id}, ${params.action}, ${tx.json(before)}, ${tx.json(after)})
      `
  return row
}

export async function importCmsContent(
  sql: Sql,
  params: CmsContentImport,
): Promise<CmsContentRow[]> {
  if (params.upsert_by_slug && params.resource !== 'berita')
    throw AppError.validationError('Slug upsert is only supported for news imports.')
  try {
    return await sql.begin(async (tx) => {
      const rows: CmsContentRow[] = []
      for (const data of params.data) {
        let id: string | undefined
        if (params.upsert_by_slug) {
          const slug = z.string().min(1).safeParse(data.slug)
          if (!slug.success) throw AppError.validationError('News slug is required.')
          await lockCmsAuthority(tx, params.access)
          const matches = await tx<
            { id: string }[]
          >`SELECT id FROM cms.berita AS content WHERE ${contentWhere(tx, { resource: 'berita', access: params.access, query: { slug: slug.data, limit: 1, offset: 0, sort: 'id', direction: 'asc' } })} FOR UPDATE`
          id = matches[0]?.id
        }
        rows.push(
          await applyCmsContentMutation(tx, {
            ...params,
            action: id ? 'update' : 'create',
            id,
            data,
          }),
        )
      }
      return rows
    })
  } catch (error) {
    if (error instanceof postgres.PostgresError) throwCmsContentError(error)
    throw error
  }
}

function throwCmsContentError(error: postgres.PostgresError): never {
  if (error instanceof postgres.PostgresError && ['23505', '23503'].includes(error.code)) {
    throw AppError.conflict('Content conflicts with an existing record or dependency.')
  }
  if (
    error instanceof postgres.PostgresError &&
    ['22P02', '22007', '23514', '23502'].includes(error.code)
  ) {
    throw AppError.validationError('Content does not satisfy the resource schema.')
  }
  throw error
}

export async function countCmsContent(sql: Sql, params: CmsContentList): Promise<number> {
  if (params.access) assertCmsContentReadAccess(params.resource, params.access)
  const read = async (query: Sql | TransactionSql) => {
    const rows = await query<
      { total: number }[]
    >`SELECT count(*)::integer AS total FROM ${query('cms.' + params.resource)} AS content WHERE ${contentWhere(query, params)}`
    return rows[0]!.total
  }
  if (!params.access) return read(sql)
  return sql.begin(async (tx) => {
    await lockCmsAuthority(tx, params.access!)
    return read(tx)
  })
}
