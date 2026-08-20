import { Hono } from 'hono'
import { auth } from '../../middleware/auth.js'
import { rateLimits } from '../../middleware/rate-limit.js'
import { successResponse } from '../../lib/http/responses.js'
import { AppError } from '../../lib/errors/app-error.js'
import { defaultProviders } from '../../providers/index.js'
import type { AppProviders } from '../../providers/types.js'
import { PrecheckBodySchema, SubmitBodySchema } from './schema.js'
import { precheck, submit } from './service.js'
import type { AppEnv } from '../../types/context.js'

export interface AttendanceRouterDeps {
  providers?: AppProviders
}

export function createAttendanceRouter(deps: AttendanceRouterDeps = {}) {
  const router = new Hono<AppEnv>()

  router.use('*', auth)

  // POST /v1/mobile/attendance/precheck
  router.post('/precheck', rateLimits.attendancePrecheck, async (c) => {
    const userId = c.get('userId')
    const token = c.get('rawToken')
    const requestId = c.get('requestId')
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders

    const body = await c.req.json()
    const parsed = PrecheckBodySchema.safeParse(body)
    if (!parsed.success) throw AppError.validationError(parsed.error.flatten())

    const result = await precheck({
      userId,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      token,
      requestId,
      providers,
    })
    return successResponse(c, result, 'Attendance precheck completed.')
  })

  // POST /v1/mobile/attendance/submit
  router.post('/submit', rateLimits.attendanceSubmit, async (c) => {
    const userId = c.get('userId')
    const token = c.get('rawToken')
    const requestId = c.get('requestId')
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders

    const body = await c.req.json()
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
      providers,
    })

    return successResponse(c, result, 'Attendance recorded successfully.', 201)
  })

  return router
}

export const attendanceRouter = createAttendanceRouter()
