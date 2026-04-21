import { Hono } from 'hono'
import { auth } from '../../middleware/auth.js'
import { rateLimits } from '../../middleware/rate-limit.js'
import { successResponse } from '../../lib/http/responses.js'
import { AppError } from '../../lib/errors/app-error.js'
import { PrecheckBodySchema, SubmitBodySchema } from './schema.js'
import { precheck, submit } from './service.js'
import type { AppEnv } from '../../types/context.js'

export const attendanceRouter = new Hono<AppEnv>()

attendanceRouter.use('*', auth)

// POST /v1/mobile/attendance/precheck
attendanceRouter.post('/precheck', rateLimits.attendancePrecheck, async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json() as unknown
  const parsed = PrecheckBodySchema.safeParse(body)
  if (!parsed.success) throw AppError.validationError(parsed.error.flatten())

  const result = await precheck({
    userId,
    latitude: parsed.data.latitude,
    longitude: parsed.data.longitude,
  })
  return successResponse(c, result, 'Attendance precheck completed.')
})

// POST /v1/mobile/attendance/submit
attendanceRouter.post('/submit', rateLimits.attendanceSubmit, async (c) => {
  const userId = c.get('userId')
  const token = c.get('rawToken')
  const requestId = c.get('requestId')

  const body = await c.req.json() as unknown
  const parsed = SubmitBodySchema.safeParse(body)
  if (!parsed.success) throw AppError.validationError(parsed.error.flatten())

  const result = await submit({
    userId,
    actionType: parsed.data.action_type,
    imageBase64: parsed.data.image_base64,
    latitude: parsed.data.latitude,
    longitude: parsed.data.longitude,
    token,
    requestId,
  })

  return successResponse(c, result, 'Attendance recorded successfully.', 201)
})
