import { Hono } from 'hono'
import { auth } from '../../middleware/auth.js'
import { rateLimits } from '../../middleware/rate-limit.js'
import { successResponse } from '../../lib/http/responses.js'
import { defaultProviders } from '../../providers/index.js'
import type { AppProviders } from '../../providers/types.js'
import type { AppEnv } from '../../types/context.js'
import { RequestUploadIntentSchema } from './schema.js'
import { createUploadIntent, confirmFileUpload, getFile, deleteFile } from './service.js'
import { AppError } from '../../lib/errors/app-error.js'

export interface FilesRouterDeps {
  providers?: AppProviders
}

export function createFilesRouter(deps: FilesRouterDeps = {}) {
  const router = new Hono<AppEnv>()

  router.use('*', auth)

  // POST /v1/mobile/files/upload-intent
  router.post('/upload-intent', rateLimits.standard, async (c) => {
    const userId = c.get('userId')
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders

    const body = await c.req.json().catch(() => null)
    const parsed = RequestUploadIntentSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.errors.map((e) => e.message).join('; '))
    }

    const intent = await createUploadIntent({
      userId,
      purpose: parsed.data.purpose,
      contentType: parsed.data.content_type,
      sizeBytes: parsed.data.size_bytes,
      filename: parsed.data.filename,
      providers,
    })

    return successResponse(c, intent, 'Upload intent created.', 201)
  })

  // POST /v1/mobile/files/:id/confirm
  router.post('/:id/confirm', rateLimits.standard, async (c) => {
    const userId = c.get('userId')
    const fileId = c.req.param('id')
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders

    const record = await confirmFileUpload({
      userId,
      fileId,
      providers,
    })

    return successResponse(c, record, 'File upload confirmed.')
  })

  // GET /v1/mobile/files/:id
  router.get('/:id', rateLimits.standard, async (c) => {
    const userId = c.get('userId')
    const fileId = c.req.param('id')
    const identityUser = c.get('identityUser')
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders

    const result = await getFile({
      userId,
      fileId,
      userRoles: identityUser?.roles ? [...identityUser.roles] : [],
      providers,
    })

    return successResponse(c, result, 'File retrieved.')
  })

  // DELETE /v1/mobile/files/:id
  router.delete('/:id', rateLimits.standard, async (c) => {
    const userId = c.get('userId')
    const fileId = c.req.param('id')
    const identityUser = c.get('identityUser')
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders

    await deleteFile({
      userId,
      fileId,
      userRoles: identityUser?.roles ? [...identityUser.roles] : [],
      providers,
    })

    return successResponse(c, null, 'File deleted.')
  })

  return router
}

export const filesRouter = createFilesRouter()
