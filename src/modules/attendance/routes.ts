import { Hono } from 'hono'
import { auth } from '../../middleware/auth.js'
import { rateLimits } from '../../middleware/rate-limit.js'
import { successResponse } from '../../lib/http/responses.js'
import { AppError } from '../../lib/errors/app-error.js'
import { defaultProviders } from '../../providers/index.js'
import type { AppProviders } from '../../providers/types.js'
import {
  AttendanceCalendarQuerySchema,
  AttendanceHistoryQuerySchema,
  PrecheckBodySchema,
  SubmitBodySchema,
} from './schema.js'
import {
  getAttendanceCalendar,
  getAttendanceHistory,
  getStudentAttendanceHistory,
  precheck,
  submit,
} from './service.js'
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

  // GET /v1/mobile/attendance
  router.get('/', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const parsed = AttendanceHistoryQuerySchema.safeParse({
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
    })
    if (!parsed.success) throw AppError.validationError(parsed.error.flatten())

    const result = await getAttendanceHistory({
      userId: c.get('userId'),
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      providers,
    })
    return successResponse(c, result, 'Attendance history retrieved.')
  })

  // GET /v1/mobile/attendance/history
  router.get('/history', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const parsed = AttendanceHistoryQuerySchema.safeParse({
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
    })
    if (!parsed.success) throw AppError.validationError(parsed.error.flatten())

    const result = await getStudentAttendanceHistory({
      userId: c.get('userId'),
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      providers,
    })
    return successResponse(c, result, 'Attendance history retrieved.')
  })

  // GET /v1/mobile/attendance/calendar
  router.get('/calendar', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const parsed = AttendanceCalendarQuerySchema.safeParse({
      year: c.req.query('year'),
      month: c.req.query('month'),
    })
    if (!parsed.success) throw AppError.validationError(parsed.error.flatten())

    const result = await getAttendanceCalendar({
      userId: c.get('userId'),
      year: parsed.data.year,
      month: parsed.data.month,
      providers,
    })
    return successResponse(c, result, 'Attendance calendar retrieved.')
  })

  return router
}

export const attendanceRouter = createAttendanceRouter()
