import { assertMemoryCmsAuthority } from './cms-authority.js'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { AppError } from '../../lib/errors/app-error.js'
import {
  assertCmsContentReadAccess,
  cmsJurusanAliases,
  cmsPublicFields,
  getCmsContentResource,
  prepareCmsContentWrite,
  validateCmsContentRecord,
  type CmsContentList,
  type CmsContentMutation,
  type CmsContentRow,
} from '../../modules/cms/content.js'
import type { CmsProfile } from '../../modules/cms/schema.js'

export interface MemoryCmsState {
  cmsProfiles: Map<string, CmsProfile>
  cmsContent: Map<string, Map<string, CmsContentRow>>
  cmsContentAudit: Array<{
    actor_id: string
    action: string
    resource: string
    before: CmsContentRow | null
    after: CmsContentRow | null
  }>
}

function visible(row: CmsContentRow, params: CmsContentList): boolean {
  const resource = getCmsContentResource(params.resource)
  if (!params.access && !resource.singleton && row.is_published !== true) return false
  const publishedAt = z.string().datetime({ offset: true }).safeParse(row.published_at)
  if (
    !params.access &&
    params.resource === 'berita' &&
    (!publishedAt.success || Date.parse(publishedAt.data) > Date.now())
  )
    return false
  const rowJurusan = z.string().safeParse(row.jurusan)
  if (params.access?.role === 'admin_jurusan') {
    if (resource.scope === 'id') {
      if (row.id !== params.access.jurusan_id) return false
    } else if (
      row.jurusan_id !== params.access.jurusan_id &&
      !(
        (row.jurusan_id === null || row.jurusan_id === undefined) &&
        rowJurusan.success &&
        cmsJurusanAliases(params.access.jurusan_slug!).includes(rowJurusan.data.toLowerCase())
      )
    )
      return false
  }
  if (
    params.access?.role === 'jurnalistik' &&
    params.resource === 'berita' &&
    row.page &&
    row.page !== 'umum'
  )
    return false
  for (const field of [
    'id',
    'slug',
    'jurusan',
    'category',
    'page',
    'year_label',
    'is_published',
  ] as const) {
    const value = params.query[field]
    if (value === undefined) continue
    if (field === 'is_published') {
      if (row[field] !== (value === 'true')) return false
    } else if (field === 'jurusan' || (field === 'slug' && params.resource === 'jurusan')) {
      const text = z.string().safeParse(row[field])
      if (!text.success || !cmsJurusanAliases(value).includes(text.data.toLowerCase())) return false
    } else if (row[field] !== value) return false
  }
  if (
    params.query.search &&
    !String(row.name ?? '')
      .toLowerCase()
      .includes(params.query.search.toLowerCase())
  )
    return false
  return true
}

export function listMemoryCmsContent(
  store: MemoryCmsState,
  params: CmsContentList,
): CmsContentRow[] {
  getCmsContentResource(params.resource)
  if (params.access) {
    assertCmsContentReadAccess(params.resource, params.access)
    assertMemoryCmsAuthority(store, params.access)
  }
  const rows = [...(store.cmsContent.get(params.resource)?.values() ?? [])].filter((row) =>
    visible(row, params),
  )
  rows.sort((a, b) => {
    const left = a[params.query.sort],
      right = b[params.query.sort]
    if (left === null || left === undefined)
      return right === null || right === undefined ? a.id.localeCompare(b.id) : 1
    if (right === null || right === undefined) return -1
    const leftNumber = z.number().safeParse(left),
      rightNumber = z.number().safeParse(right)
    const order =
      leftNumber.success && rightNumber.success
        ? leftNumber.data - rightNumber.data
        : String(left).localeCompare(String(right))
    return (params.query.direction === 'desc' ? -order : order) || a.id.localeCompare(b.id)
  })
  const page = rows.slice(params.query.offset, params.query.offset + params.query.limit + 1)
  const fields = params.access ? null : new Set(cmsPublicFields(params.resource))
  return page.map((row) => {
    const result = structuredClone(row)
    if (fields) for (const key of Object.keys(result)) if (!fields.has(key)) delete result[key]
    return result
  })
}

export function mutateMemoryCmsContent(
  store: MemoryCmsState,
  params: CmsContentMutation,
): CmsContentRow {
  const data = prepareCmsContentWrite(params)
  assertMemoryCmsAuthority(store, params.access)
  let table = store.cmsContent.get(params.resource)
  if (!table) {
    table = new Map()
    store.cmsContent.set(params.resource, table)
  }
  const before = params.id ? (table.get(params.id) ?? null) : null
  if (
    params.action !== 'create' &&
    (!before ||
      !visible(before, {
        resource: params.resource,
        access: params.access,
        query: { limit: 1, offset: 0, sort: 'id', direction: 'asc' },
      }))
  )
    throw AppError.notFound('CMS content')
  if (params.action === 'create' && getCmsContentResource(params.resource).singleton && table.size)
    throw AppError.conflict('CMS singleton already exists.')
  const now = new Date().toISOString()
  const row: CmsContentRow =
    params.action === 'create'
      ? { ...data, id: randomUUID(), created_at: now, updated_at: now }
      : { ...before!, ...data, updated_at: now }
  if (params.action !== 'delete') validateCmsContentRecord(params.resource, row)
  if (params.action === 'delete') table.delete(row.id)
  else table.set(row.id, row)
  store.cmsContentAudit.push({
    actor_id: params.access.id,
    action: params.action,
    resource: params.resource,
    before: before ? structuredClone(before) : null,
    after: params.action === 'delete' ? null : structuredClone(row),
  })
  return structuredClone(row)
}
