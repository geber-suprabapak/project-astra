import { Hono } from 'hono'
import { auth } from '../../middleware/auth.js'
import { rateLimits } from '../../middleware/rate-limit.js'
import { successResponse } from '../../lib/http/responses.js'
import { AppError } from '../../lib/errors/app-error.js'
import { enrollFace, getEnrollmentStatus, type EnrollmentFile } from './service.js'
import type { AppEnv } from '../../types/context.js'

export const enrollmentRouter = new Hono<AppEnv>()

enrollmentRouter.use('*', auth)

// GET /v1/mobile/face/enrollment/status
enrollmentRouter.get('/status', rateLimits.enrollStatus, async (c) => {
  const token = c.get('rawToken')
  const requestId = c.get('requestId')

  const status = await getEnrollmentStatus(token, requestId)
  return successResponse(c, status, 'Enrollment status retrieved.')
})

// POST /v1/mobile/face/enrollment
enrollmentRouter.post('/', rateLimits.enrollment, async (c) => {
  const token = c.get('rawToken')
  const requestId = c.get('requestId')

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

  const result = await enrollFace(files, token, requestId)
  return successResponse(c, result, 'Face enrollment completed.', 201)
})
