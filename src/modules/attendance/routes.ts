import { Hono } from 'hono'
import { auth } from '../../middleware/auth.js'
import { rateLimits } from '../../middleware/rate-limit.js'
import { parseJsonRequest } from '../../lib/http/request.js'
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

    const data = await parseJsonRequest(c, PrecheckBodySchema)

    const result = await precheck({
      userId,
      latitude: data.latitude,
      longitude: data.longitude,
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

    const data = await parseJsonRequest(c, SubmitBodySchema)

    const result = await submit({
      userId,
      actionType: data.action_type,
      imageBase64: data.image_base64,
      latitude: data.latitude,
      longitude: data.longitude,
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
      startDate: c.req.query('startDate') ?? c.req.query('start_date'),
      endDate: c.req.query('endDate') ?? c.req.query('end_date'),
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
      startDate: c.req.query('startDate') ?? c.req.query('start_date'),
      endDate: c.req.query('endDate') ?? c.req.query('end_date'),
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
