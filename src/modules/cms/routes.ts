import { accountView, cmsAccountCreateSchema, cmsAccountPatchSchema } from './accounts.js'
import { createCmsAccount, resetCmsAccountPassword } from './account-service.js'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import {
  cmsContentInputSchema,
  cmsContentResources,
  canReadCmsContent,
  getCmsContentResource,
  validateCmsContentQuery,
  type CmsContentRow,
} from './content.js'
import { AppError } from '../../lib/errors/app-error.js'
import { successResponse } from '../../lib/http/responses.js'
import { defaultProviders } from '../../providers/index.js'
import type { AppEnv } from '../../types/context.js'
import type { AppProviders } from '../../providers/types.js'
import { getCmsSession } from './service.js'

const CMS_UPLOAD_SIGNATURES = new Map<string, (buf: Buffer) => boolean>([
  ['image/jpeg', (b) => b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))],
  [
    'image/png',
    (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  ],
  [
    'image/webp',
    (b) =>
      b.length >= 12 &&
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  ],
  [
    'image/gif',
    (b) => {
      const header = b.subarray(0, 6).toString('ascii')
      return header === 'GIF87a' || header === 'GIF89a'
    },
  ],
  ['application/pdf', (b) => b.subarray(0, 5).toString('ascii') === '%PDF-'],
  [
    'application/msword',
    (b) => b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
  ],
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    (b) => b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
  ],
])

export function createCmsRouter(deps: { providers?: AppProviders } = {}) {
  const router = new Hono<AppEnv>()
  router.get('/session', async (c) => {
    c.header('Cache-Control', 'no-store')
    const authorization = c.req.header('Authorization')
    if (!authorization?.startsWith('Bearer ') || !authorization.slice(7).trim()) {
      throw AppError.authRequired()
    }
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    return successResponse(
      c,
      await getCmsSession(providers, authorization.slice(7)),
      'CMS session.',
    )
  })
  async function sessionFor(c: Context<AppEnv>) {
    c.header('Cache-Control', 'no-store')
    const authorization = c.req.header('Authorization')
    if (!authorization?.startsWith('Bearer ') || !authorization.slice(7).trim())
      throw AppError.authRequired()
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    return { providers, session: await getCmsSession(providers, authorization.slice(7)) }
  }

  router.get('/accounts', async (c) => {
    const { providers, session } = await sessionFor(c)
    const parsed = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(100),
        offset: z.coerce.number().int().min(0).max(1000000).default(0),
      })
      .strict()
      .safeParse(c.req.query())
    if (!parsed.success) throw AppError.validationError(parsed.error.flatten())
    const rows = await providers.domainStore.listCmsAccounts({
      access: session,
      limit: parsed.data.limit + 1,
      offset: parsed.data.offset,
    })
    return successResponse(
      c,
      rows.slice(0, parsed.data.limit).map(accountView),
      'CMS accounts.',
      200,
      { pagination: { ...parsed.data, has_more: rows.length > parsed.data.limit } },
    )
  })
  router.get('/accounts/:id', async (c) => {
    const { providers, session } = await sessionFor(c)
    const parsed = z.uuid().safeParse(c.req.param('id'))
    if (!parsed.success) throw AppError.validationError('Invalid CMS account ID.')
    const [row] = await providers.domainStore.listCmsAccounts({
      access: session,
      id: parsed.data,
      limit: 1,
      offset: 0,
    })
    if (!row) throw AppError.notFound('CMS account')
    return successResponse(c, accountView(row), 'CMS account.')
  })
  router.post('/accounts', async (c) => {
    const { providers, session } = await sessionFor(c)
    const parsed = cmsAccountCreateSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw AppError.validationError(parsed.error.flatten())
    return successResponse(
      c,
      accountView(await createCmsAccount(providers, session, parsed.data)),
      'CMS account created.',
      201,
    )
  })
  router.patch('/accounts/:id', async (c) => {
    const { providers, session } = await sessionFor(c)
    const id = z.uuid().safeParse(c.req.param('id'))
    const parsed = cmsAccountPatchSchema.safeParse(await c.req.json().catch(() => null))
    if (!id.success || !parsed.success)
      throw AppError.validationError('Invalid CMS account update.')
    return successResponse(
      c,
      accountView(
        await providers.domainStore.mutateCmsAccount({
          access: session,
          id: id.data,
          data: parsed.data,
        }),
      ),
      'CMS account updated.',
    )
  })
  router.post('/accounts/:id/password', async (c) => {
    const { providers, session } = await sessionFor(c)
    const id = z.uuid().safeParse(c.req.param('id'))
    const parsed = z
      .object({ password: z.string().min(6).max(1024) })
      .strict()
      .safeParse(await c.req.json().catch(() => null))
    if (!id.success || !parsed.success)
      throw AppError.validationError('Invalid CMS password update.')
    return successResponse(
      c,
      await resetCmsAccountPassword(providers, session, id.data, parsed.data.password),
      'CMS account password updated.',
    )
  })

  router.post('/uploads', async (c) => {
    const { providers, session } = await sessionFor(c)
    const allowedRoles = new Set([
      'super_admin',
      'admin',
      'admin_jurusan',
      'admin_hubin',
      'waka_hubin',
      'waka_hubin_humas',
      'waka_kurikulum',
      'waka_akademik',
      'waka_kesiswaan',
      'waka_sarpras',
      'waka_humas',
      'wks_1',
      'wks_2',
      'wks_3',
      'wks_4',
      'jurnalistik',
      'bkk',
    ])
    if (!allowedRoles.has(session.role)) {
      throw AppError.forbidden('You do not have permission to upload CMS media.')
    }

    const formData = await c.req.formData().catch(() => null)
    if (!formData) throw AppError.validationError('Form data is required.')

    const fileEntry = formData.get('file')
    const folderEntry = formData.get('folder')

    if (!(fileEntry instanceof File)) {
      throw AppError.validationError('File is required.')
    }

    const verifySignature = CMS_UPLOAD_SIGNATURES.get(fileEntry.type)
    if (!verifySignature) {
      throw AppError.validationError(`Unsupported file type: ${fileEntry.type}`)
    }
    if (fileEntry.size === 0) {
      throw AppError.validationError('Uploaded file cannot be empty.')
    }
    if (fileEntry.size > 15 * 1024 * 1024) {
      throw AppError.validationError('File exceeds 15MB limit.')
    }

    const rawFolder =
      folderEntry instanceof File ? 'general' : (folderEntry?.toString().trim() ?? 'general')
    const safeFolder = rawFolder.replace(/[^a-z0-9_-]/gi, '') || 'general'
    const ext = fileEntry.name.split('.').pop()?.toLowerCase() || 'bin'
    const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : 'bin'
    const safePath = `cms/${safeFolder}/${Date.now()}-${Math.random().toString(36).substring(2)}.${safeExt}`

    const buffer = Buffer.from(await fileEntry.arrayBuffer())
    if (buffer.length === 0 || !verifySignature(buffer)) {
      throw AppError.validationError('File contents do not match the declared file type.')
    }
    if (providers.objectStorage.uploadPublicFile) {
      await providers.objectStorage.uploadPublicFile(safePath, buffer, fileEntry.type)
    }

    const url = providers.objectStorage.getPublicUrl
      ? providers.objectStorage.getPublicUrl(safePath)
      : `https://storage.local/public/${safePath}`

    return successResponse(c, { path: safePath, url }, 'File uploaded successfully.', 201)
  })

  router.get('/resources', async (c) => {
    const { session } = await sessionFor(c)
    const resources = [...cmsContentResources].map(([name, definition]) => ({
      name,
      read: true,
      write: definition.roles.includes(session.role),
    }))
    return successResponse(c, resources, 'CMS resource capabilities.')
  })

  async function readData(c: Context<AppEnv>) {
    let input: unknown
    try {
      input = await c.req.json()
    } catch {
      throw AppError.validationError('Invalid JSON body.')
    }
    const result = cmsContentInputSchema.safeParse(input)
    if (!result.success) throw AppError.validationError(result.error.flatten())
    return result.data
  }

  async function listContent(c: Context<AppEnv>, authenticated: boolean) {
    const resource = c.req.param('resource')!
    getCmsContentResource(resource)
    const query = validateCmsContentQuery(resource, c.req.query())
    const context = authenticated ? await sessionFor(c) : null
    const providers = context?.providers ?? deps.providers ?? c.get('providers') ?? defaultProviders
    // Published lookup data remains readable by roles that cannot manage that resource.
    const access = context && canReadCmsContent(resource, context.session) ? context.session : null
    const rows = await providers.domainStore.listCmsContent({ resource, query, access })
    const hasMore = rows.length > query.limit
    return successResponse(c, rows.slice(0, query.limit), 'CMS content.', 200, {
      pagination: { limit: query.limit, offset: query.offset, has_more: hasMore },
    })
  }

  router.get('/public/:resource', (c) => listContent(c, false))
  router.get('/content/:resource', (c) => listContent(c, true))
  router.post('/content/:resource/import', async (c) => {
    const { providers, session } = await sessionFor(c)
    const input = z
      .object({
        rows: z.array(cmsContentInputSchema).min(1).max(500),
        upsert_by_slug: z.boolean().optional(),
      })
      .strict()
    const parsed = input.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw AppError.validationError(parsed.error.flatten())
    const rows = await providers.domainStore.importCmsContent({
      resource: c.req.param('resource'),
      data: parsed.data.rows,
      upsert_by_slug: parsed.data.upsert_by_slug,
      access: session,
    })
    return successResponse(c, { imported: rows.length }, 'CMS content imported.', 201)
  })
  router.get('/content/:resource/count', async (c) => {
    const { providers, session } = await sessionFor(c)
    const resource = c.req.param('resource')
    getCmsContentResource(resource)
    const query = validateCmsContentQuery(resource, c.req.query())
    const access = canReadCmsContent(resource, session) ? session : null
    const total = await providers.domainStore.countCmsContent({ resource, query, access })
    return successResponse(c, { total }, 'CMS content count.')
  })
  router.get('/content/:resource/:id', async (c) => {
    const resource = c.req.param('resource')
    const parsed = z.uuid().safeParse(c.req.param('id'))
    if (!parsed.success) throw AppError.validationError('Invalid content ID.')
    const { providers, session } = await sessionFor(c)
    getCmsContentResource(resource)
    const access = canReadCmsContent(resource, session) ? session : null
    const query = validateCmsContentQuery(resource, { id: parsed.data, limit: 1 })
    const rows = await providers.domainStore.listCmsContent({ resource, query, access })
    if (!rows[0]) throw AppError.notFound('CMS content')
    return successResponse(c, rows[0], 'CMS content.')
  })

  for (const [method, action] of [
    ['post', 'create'],
    ['patch', 'update'],
    ['delete', 'delete'],
  ] as const) {
    const path = action === 'create' ? '/content/:resource' : '/content/:resource/:id'
    router[method](path, async (c) => {
      const { providers, session } = await sessionFor(c)
      const resource = c.req.param('resource')!
      let id: string | undefined
      if (action !== 'create') {
        const parsed = z.uuid().safeParse(c.req.param('id'))
        if (!parsed.success) throw AppError.validationError('Invalid content ID.')
        id = parsed.data
      }
      const data = action === 'delete' ? {} : await readData(c)
      const row = await providers.domainStore.mutateCmsContent({
        resource,
        action,
        id,
        data,
        access: session,
      })
      const fields = new Set([
        'id',
        'created_at',
        'updated_at',
        ...getCmsContentResource(resource).schema.keyof().options,
      ])
      const projected: CmsContentRow = { id: row.id }
      for (const key of fields) if (row[key] !== undefined) projected[key] = row[key]
      return successResponse(c, projected, 'CMS content saved.', action === 'create' ? 201 : 200)
    })
  }

  return router
}
