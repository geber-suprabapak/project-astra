import { z } from 'zod'
import { AppError } from '../../lib/errors/app-error.js'
import { generalContentDefinitions } from './content-resources-general.js'
import { portalContentDefinitions } from './content-resources-portal.js'
import {
  cmsContentInputSchema,
  cmsContentQuerySchema,
  type CmsContentInput,
  type CmsContentMutation,
  type CmsContentQuery,
  type CmsContentQueryInput,
} from './content-types.js'
import type { CmsSession } from './schema.js'

const definitions = [...generalContentDefinitions, ...portalContentDefinitions]

// Only these declared domain resources can reach SQL; no client table/column SQL is accepted.
export const cmsContentResources = new Map(
  definitions.map(
    ([name, definition]) => [name, { ...definition, schema: definition.schema.strict() }] as const,
  ),
)

export function getCmsContentResource(name: string) {
  const resource = cmsContentResources.get(name)
  if (!resource) throw AppError.notFound('CMS resource')
  return resource
}

export function cmsPublicFields(name: string): string[] {
  const fields = getCmsContentResource(name).schema.keyof().options
  const hidden = new Set(
    name === 'guru_staff'
      ? ['nip', 'phone', 'email']
      : name === 'tracer_alumni'
        ? [
            'name',
            'graduation_year',
            'jurusan',
            'status',
            'company_or_campus',
            'position',
            'salary_range',
          ]
        : [],
  )
  return ['id', 'created_at', 'updated_at', ...fields.filter((field) => !hidden.has(field))]
}

export function cmsJurusanAliases(slug: string): string[] {
  const value = slug.trim().toLowerCase()
  if (['pplg', 'rpl'].includes(value)) return ['pplg', 'rpl']
  if (['pm', 'pemasaran', 'bdp'].includes(value)) return ['pm', 'pemasaran', 'bdp']
  if (['ak', 'akl'].includes(value)) return ['ak', 'akl']
  if (['mplb', 'otkp'].includes(value)) return ['mplb', 'otkp']
  return [value]
}

export function assertCmsContentAccess(name: string, access: CmsSession) {
  const resource = getCmsContentResource(name)
  if (!resource.roles.includes(access.role)) throw AppError.forbidden()
  if (
    access.role === 'admin_jurusan' &&
    (!resource.scope || !access.jurusan_id || !access.jurusan_slug)
  ) {
    throw AppError.forbidden()
  }
}

export function validateCmsContentQuery(
  name: string,
  input: CmsContentQueryInput,
): CmsContentQuery {
  const result = cmsContentQuerySchema.safeParse(input)
  if (!result.success) throw AppError.validationError(result.error.flatten())
  const columns = new Set([
    'id',
    'created_at',
    'updated_at',
    ...getCmsContentResource(name).schema.keyof().options,
  ])
  if (!columns.has(result.data.sort)) throw AppError.validationError('Unsupported sort field.')
  for (const field of [
    'slug',
    'jurusan',
    'category',
    'page',
    'year_label',
    'is_published',
  ] as const) {
    if (result.data[field] !== undefined && !columns.has(field))
      throw AppError.validationError('Unsupported content filter.')
  }
  if (result.data.search && !columns.has('name'))
    throw AppError.validationError('Resource has no name search.')
  return result.data
}

export function prepareCmsContentWrite(params: CmsContentMutation): CmsContentInput {
  assertCmsContentAccess(params.resource, params.access)
  const resource = getCmsContentResource(params.resource)
  if (
    params.access.role === 'admin_jurusan' &&
    resource.scope === 'id' &&
    params.action !== 'update'
  )
    throw AppError.forbidden()
  if (params.action === 'delete') return {}
  const input = { ...params.data }
  const aliases = new Map<string, [string, string][]>(
    Object.entries({
      download_dokumen: [
        ['name', 'title'],
        ['type', 'file_type'],
      ],
      mou_kerjasama: [
        ['partner', 'partner_name'],
        ['scope', 'description'],
        ['signed_date', 'mou_date'],
        ['expired_date', 'valid_until'],
      ],
      guru_tamu: [['date', 'event_date']],
      tata_tertib: [['description', 'content']],
      testimoni_dudi: [['quote', 'content']],
      poin_pelanggaran: [
        ['title', 'violation'],
        ['poin', 'points'],
      ],
    }),
  )
  for (const [canonical, alias] of aliases.get(params.resource) ?? []) {
    if (
      input[canonical] !== undefined &&
      input[alias] !== undefined &&
      input[canonical] !== input[alias]
    )
      throw AppError.validationError('Conflicting content aliases.')
    if (input[canonical] !== undefined) input[alias] = input[canonical]
    else if (input[alias] !== undefined) input[canonical] = input[alias]
  }
  if (params.access.role === 'admin_jurusan' && resource.scope === 'id') {
    const slug = z.string().safeParse(input.slug)
    if (
      input.slug !== undefined &&
      (!slug.success ||
        !cmsJurusanAliases(params.access.jurusan_slug!).includes(slug.data.toLowerCase()))
    )
      throw AppError.forbidden()
  }
  if (params.access.role === 'admin_jurusan' && resource.scope === 'jurusan') {
    const slug = z.string().safeParse(input.jurusan)
    if (
      (input.jurusan !== undefined &&
        (!slug.success ||
          !cmsJurusanAliases(params.access.jurusan_slug!).includes(slug.data.toLowerCase()))) ||
      (input.jurusan_id !== undefined && input.jurusan_id !== params.access.jurusan_id)
    )
      throw AppError.forbidden()
    if (
      params.action === 'create' ||
      input.jurusan !== undefined ||
      input.jurusan_id !== undefined
    ) {
      input.jurusan_id = params.access.jurusan_id
      input.jurusan = slug.success ? slug.data : params.access.jurusan_slug
    }
  }
  if (
    params.access.role === 'jurnalistik' &&
    params.resource === 'berita' &&
    input.page !== undefined &&
    input.page !== null &&
    input.page !== '' &&
    input.page !== 'umum'
  )
    throw AppError.forbidden()
  const validator = params.action === 'create' ? resource.schema : resource.schema.partial()
  const result = validator.safeParse(input)
  if (!result.success) throw AppError.validationError(result.error.flatten())
  const data = cmsContentInputSchema.parse(result.data)
  if (params.action === 'update') {
    for (const key of Object.keys(data)) if (!Object.hasOwn(input, key)) delete data[key]
  }
  if (Object.keys(data).length === 0) throw AppError.validationError('Empty content mutation.')
  if (
    resource.schema.keyof().options.includes('order') &&
    resource.schema.keyof().options.includes('sort_order')
  ) {
    if (data.order !== undefined) data.sort_order = data.order
    else if (data.sort_order !== undefined) data.order = data.sort_order
  }
  return data
}

export function validateCmsContentRecord(resource: string, row: CmsContentInput) {
  const nonempty = (key: string) => z.string().trim().min(1).safeParse(row[key]).success
  const required = new Map([
    ['download_dokumen', 'name'],
    ['mou_kerjasama', 'partner'],
    ['poin_pelanggaran', 'title'],
  ])
  const field = required.get(resource)
  if (field && !nonempty(field)) throw AppError.validationError(`${field} is required.`)
  if (
    resource === 'tracer_alumni' &&
    !(nonempty('name') && nonempty('status')) &&
    !['year', 'employed_percent', 'college_percent', 'entrepreneur_percent'].every(nonempty)
  )
    throw AppError.validationError(
      'Tracer requires an individual outcome or complete yearly statistics.',
    )
}

export function canReadCmsContent(name: string, access: CmsSession): boolean {
  const resource = getCmsContentResource(name)
  return resource.roles.includes(access.role) || !!resource.readRoles?.includes(access.role)
}

export function assertCmsContentReadAccess(name: string, access: CmsSession) {
  if (!canReadCmsContent(name, access)) throw AppError.forbidden()
  if (access.role === 'admin_jurusan') assertCmsContentAccess(name, access)
}
