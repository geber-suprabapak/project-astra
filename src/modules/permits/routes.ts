import { Hono } from 'hono'
import { auth } from '../../middleware/auth.js'
import { rateLimits } from '../../middleware/rate-limit.js'
import { successResponse } from '../../lib/http/responses.js'
import { AppError } from '../../lib/errors/app-error.js'
import { defaultProviders } from '../../providers/index.js'
import type { AppProviders } from '../../providers/types.js'
import { CreatePermitSchema, MAX_PERMIT_ATTACHMENT_SIZE_BYTES } from './schema.js'
import { createPermit, deletePermit, getPermit, listPermits } from './service.js'
import type { AppEnv } from '../../types/context.js'

export interface PermitsRouterDeps {
  providers?: AppProviders
}

export function createPermitsRouter(deps: PermitsRouterDeps = {}) {
  const router = new Hono<AppEnv>()

  router.use('*', auth)

  // GET /v1/mobile/permits (or /v1/mobile/leave-requests)
  router.get('/', rateLimits.permitsGet, async (c) => {
    const userId = c.get('userId')
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders

    const permits = await listPermits(userId, providers)
    return successResponse(c, { items: permits }, 'Permits loaded.')
  })

  // POST /v1/mobile/permits (or /v1/mobile/leave-requests)
  router.post('/', rateLimits.permitsPost, async (c) => {
    const userId = c.get('userId')
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders

    const contentType = c.req.header('content-type') || ''
    let category: unknown
    let description: unknown
    let date: unknown
    let fileId: string | null = null
    let attachment: { buffer: Buffer; contentType: string } | null = null

    if (contentType.includes('application/json')) {
      const json = await c.req.json().catch(() => ({}))
      category = json.category
      description = json.description
      date = json.date
      fileId = json.file_id ?? json.fileId ?? null
    } else {
      const form = await c.req.formData()
      category = form.get('category')
      description = form.get('description')
      date = form.get('date')
      const fileIdEntry = form.get('file_id') ?? form.get('fileId')
      if (fileIdEntry && !(fileIdEntry instanceof Blob)) {
        fileId = String(fileIdEntry)
      }

      const attachmentEntry = form.get('attachment')
      if (attachmentEntry instanceof Blob) {
        const arrayBuffer = await attachmentEntry.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        if (buffer.length > MAX_PERMIT_ATTACHMENT_SIZE_BYTES) {
          throw AppError.validationError('Attachment must be under 10MB.')
        }

        attachment = {
          buffer,
          contentType: attachmentEntry.type || 'image/jpeg',
        }
      }
    }

    const parsed = CreatePermitSchema.safeParse({
      category,
      description,
      date,
      file_id: fileId ?? undefined,
    })
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }

    const permit = await createPermit({
      userId,
      category: parsed.data.category,
      description: parsed.data.description,
      date: parsed.data.date,
      fileId: fileId ?? parsed.data.file_id,
      attachment,
      providers,
    })

    return successResponse(c, permit, 'Permit submitted.', 201)
  })

  // GET /v1/mobile/permits/:id
  router.get('/:id', rateLimits.permitsGet, async (c) => {
    const userId = c.get('userId')
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const id = c.req.param('id')

    const permit = await getPermit(userId, id, providers)
    return successResponse(c, permit, 'Permit retrieved.')
  })

  // DELETE /v1/mobile/permits/:id
  router.delete('/:id', async (c) => {
    const userId = c.get('userId')
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const id = c.req.param('id')

    await deletePermit(userId, id, providers)
    return successResponse(c, { id }, 'Permit cancelled successfully.')
  })

  return router
}

export const permitsRouter = createPermitsRouter()
export const createLeaveRequestsRouter = createPermitsRouter
export const leaveRequestsRouter = permitsRouter
