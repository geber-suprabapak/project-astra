import { Hono } from 'hono'
import { auth } from '../../middleware/auth.js'
import { rateLimits } from '../../middleware/rate-limit.js'
import { successResponse } from '../../lib/http/responses.js'
import { AppError } from '../../lib/errors/app-error.js'
import { defaultProviders } from '../../providers/index.js'
import type { AppProviders } from '../../providers/types.js'
import { CreatePermitSchema, MAX_PERMIT_ATTACHMENT_SIZE_BYTES } from './schema.js'
import { createPermit, listPermits } from './service.js'
import type { AppEnv } from '../../types/context.js'

export interface PermitsRouterDeps {
  providers?: AppProviders
}

export function createPermitsRouter(deps: PermitsRouterDeps = {}) {
  const router = new Hono<AppEnv>()

  router.use('*', auth)

  // GET /v1/mobile/permits
  router.get('/', rateLimits.permitsGet, async (c) => {
    const userId = c.get('userId')
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders

    const permits = await listPermits(userId, providers)
    return successResponse(c, { items: permits }, 'Permits loaded.')
  })

  // POST /v1/mobile/permits
  router.post('/', rateLimits.permitsPost, async (c) => {
    const userId = c.get('userId')
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders

    const form = await c.req.formData()

    const body = {
      category: form.get('category'),
      description: form.get('description'),
      date: form.get('date'),
    }

    const parsed = CreatePermitSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }

    const attachmentEntry = form.get('attachment')
    let attachment: { buffer: Buffer; contentType: string } | null = null

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

    const permit = await createPermit({
      userId,
      category: parsed.data.category,
      description: parsed.data.description,
      date: parsed.data.date,
      attachment,
      providers,
    })

    return successResponse(c, permit, 'Permit submitted.', 201)
  })

  return router
}

export const permitsRouter = createPermitsRouter()
