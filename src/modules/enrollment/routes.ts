import { Hono } from 'hono'
import { auth } from '../../middleware/auth.js'
import { rateLimits } from '../../middleware/rate-limit.js'
import { successResponse } from '../../lib/http/responses.js'
import { AppError } from '../../lib/errors/app-error.js'
import { defaultProviders } from '../../providers/index.js'
import type { AppProviders } from '../../providers/types.js'
import { enrollFace, getEnrollmentStatus, deleteEnrollment, type EnrollmentFile } from './service.js'
import type { AppEnv } from '../../types/context.js'

export interface EnrollmentRouterDeps {
  providers?: AppProviders
}

export function createEnrollmentRouter(deps: EnrollmentRouterDeps = {}) {
  const router = new Hono<AppEnv>()

  router.use('*', auth)

  // GET /v1/mobile/face/enrollment/status
  router.get('/status', rateLimits.enrollStatus, async (c) => {
    const userId = c.get('userId')
    const token = c.get('rawToken')
    const requestId = c.get('requestId')
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders

    const status = await getEnrollmentStatus(token, requestId, providers, userId)
    return successResponse(c, status, 'Enrollment status retrieved.')
  })

  // POST /v1/mobile/face/enrollment
  router.post('/', rateLimits.enrollment, async (c) => {
    const userId = c.get('userId')
    const token = c.get('rawToken')
    const requestId = c.get('requestId')
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders

    const form = await c.req.formData()
    const fileEntries = form.getAll('files')

    const files: EnrollmentFile[] = []
    for (const entry of fileEntries) {
      if (!(entry instanceof Blob)) {
        throw AppError.validationError('files must be file uploads, not strings.')
      }
      const arrayBuffer = await entry.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const filename = entry instanceof File ? entry.name : 'image.jpg'
      files.push({
        buffer,
        contentType: entry.type || 'application/octet-stream',
        filename: filename || 'image.jpg',
        size: buffer.length,
      })
    }

    const result = await enrollFace(files, token, requestId, providers, userId)
    return successResponse(c, result, 'Face enrollment completed.', 201)
  })

  // DELETE /v1/mobile/face/enrollment
  router.delete('/', rateLimits.standard, async (c) => {
    const userId = c.get('userId')
    const token = c.get('rawToken')
    const requestId = c.get('requestId')
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders

    await deleteEnrollment({ userId, token, requestId, providers })
    return successResponse(c, null, 'Face enrollment deleted.')
  })

  return router
}

export const enrollmentRouter = createEnrollmentRouter()

