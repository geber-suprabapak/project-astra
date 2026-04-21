import { Hono } from 'hono'
import { auth } from '../../middleware/auth.js'
import { rateLimits } from '../../middleware/rate-limit.js'
import { successResponse } from '../../lib/http/responses.js'
import { AppError } from '../../lib/errors/app-error.js'
import { CreatePermitSchema, MAX_PERMIT_ATTACHMENT_SIZE_BYTES } from './schema.js'
import { createPermit, listPermits } from './service.js'
import type { AppEnv } from '../../types/context.js'

export const permitsRouter = new Hono<AppEnv>()

permitsRouter.use('*', auth)

// GET /v1/mobile/permits
permitsRouter.get('/', rateLimits.permitsGet, async (c) => {
  const userId = c.get('userId')
  const permits = await listPermits(userId)
  return successResponse(c, permits, 'Permits retrieved.')
})

// POST /v1/mobile/permits
permitsRouter.post('/', rateLimits.permitsPost, async (c) => {
  const userId = c.get('userId')
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

  if (attachmentEntry && typeof attachmentEntry !== 'string') {
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
  })

  return successResponse(c, permit, 'Permit submitted.', 201)
})
