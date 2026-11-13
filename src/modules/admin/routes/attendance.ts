import type { Context, Hono } from 'hono'
import { successResponse } from '../../../lib/http/responses.js'
import { AppError } from '../../../lib/errors/app-error.js'
import {
  attendanceActionTypeSchema,
  attendanceAttemptStatusSchema,
} from '../../../providers/types.js'
import type { AppEnv } from '../../../types/context.js'
import {
  bulkDeleteAttendanceSchema,
  createManualAttendanceSchema,
  deleteAttendanceSchema,
} from '../schema.js'
import {
  createManualAttendance,
  deleteAdminAttendances,
  getAttendance,
  getAttendanceAttempt,
  listAttendanceAttempts,
  listAttendances,
} from '../service.js'
import {
  type AdminRouterDeps,
  isValidIsoDate,
  parseJsonBody,
  requireRouteParam,
  resolveAdminProviders,
} from './shared.js'

function assertValidAttendanceDateFilters(
  date: string | undefined,
  startDate: string | undefined,
  endDate: string | undefined,
): void {
  if (date !== undefined && !isValidIsoDate(date)) {
    throw AppError.validationError('date must be in YYYY-MM-DD format.')
  }
  if (startDate !== undefined && !isValidIsoDate(startDate)) {
    throw AppError.validationError('start_date must be in YYYY-MM-DD format.')
  }
  if (endDate !== undefined && !isValidIsoDate(endDate)) {
    throw AppError.validationError('end_date must be in YYYY-MM-DD format.')
  }
  if (startDate !== undefined && endDate !== undefined && startDate > endDate) {
    throw AppError.validationError('start_date cannot be after end_date.')
  }
}

export function registerAttendanceRoutes(router: Hono<AppEnv>, deps: AdminRouterDeps): void {
  // POST /v1/admin/attendance/manual & /v1/admin/attendances/manual
  const handleCreateManualAttendance = async (c: Context<AppEnv>) => {
    const providers = resolveAdminProviders(c, deps)
    const data = await parseJsonBody(c, createManualAttendanceSchema)

    const targetUserId = (data.user_id ?? data.userId)!
    const actionType = (data.action_type ?? data.actionType)!
    const attemptId = data.attempt_id ?? data.attemptId ?? null

    const attendance = await createManualAttendance({
      userId: targetUserId,
      actionType,
      status: data.status,
      reason: data.reason,
      date: data.date,
      attemptId,
      latitude: data.latitude,
      longitude: data.longitude,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, attendance, 'Manual attendance recorded successfully.', 201)
  }

  router.post('/attendance/manual', handleCreateManualAttendance)
  router.post('/attendances/manual', handleCreateManualAttendance)

  // DELETE /v1/admin/attendance/:id & /v1/admin/attendances/:id
  const handleDeleteAttendance = async (c: Context<AppEnv>) => {
    const providers = resolveAdminProviders(c, deps)
    const parsed = deleteAttendanceSchema.safeParse({ id: c.req.param('id') })
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }

    const result = await deleteAdminAttendances({
      ids: [parsed.data.id],
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    if (result.deletedCount === 0) {
      throw AppError.notFound('Attendance')
    }

    return successResponse(c, { id: result.deletedIds[0] }, 'Attendance deleted successfully.')
  }

  // DELETE /v1/admin/attendance/bulk & /v1/admin/attendances/bulk
  const handleBulkDeleteAttendances = async (c: Context<AppEnv>) => {
    const providers = resolveAdminProviders(c, deps)
    const data = await parseJsonBody(c, bulkDeleteAttendanceSchema)

    const result = await deleteAdminAttendances({
      ids: data.ids,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, result, 'Attendances deleted successfully.')
  }

  router.delete('/attendance/bulk', handleBulkDeleteAttendances)
  router.delete('/attendances/bulk', handleBulkDeleteAttendances)
  router.delete('/attendance/:id', handleDeleteAttendance)
  router.delete('/attendances/:id', handleDeleteAttendance)

  // GET /v1/admin/attendance/attempts & /v1/admin/attendances/attempts
  const handleListAttendanceAttempts = async (c: Context<AppEnv>) => {
    const providers = resolveAdminProviders(c, deps)
    const userId = c.req.query('user_id') ?? c.req.query('userId')
    const statusQuery = c.req.query('status')
    const actionTypeQuery = c.req.query('action_type') ?? c.req.query('actionType')
    const limitQuery = c.req.query('limit')

    const statusParsed = statusQuery ? attendanceAttemptStatusSchema.safeParse(statusQuery) : null
    const actionTypeParsed = actionTypeQuery
      ? attendanceActionTypeSchema.safeParse(actionTypeQuery)
      : null

    if (statusQuery && (!statusParsed || !statusParsed.success)) {
      throw AppError.validationError('Invalid status query parameter.')
    }
    if (actionTypeQuery && (!actionTypeParsed || !actionTypeParsed.success)) {
      throw AppError.validationError('Invalid action_type query parameter.')
    }

    const limit = limitQuery ? Number(limitQuery) : undefined

    const attempts = await listAttendanceAttempts({
      filter: {
        userId,
        status: statusParsed ? statusParsed.data : undefined,
        actionType: actionTypeParsed ? actionTypeParsed.data : undefined,
        limit,
      },
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, attempts, 'Attendance attempts retrieved successfully.')
  }

  router.get('/attendance/attempts', handleListAttendanceAttempts)
  router.get('/attendances/attempts', handleListAttendanceAttempts)

  // GET /v1/admin/attendance/attempts/:id & /v1/admin/attendances/attempts/:id
  const handleGetAttendanceAttempt = async (c: Context<AppEnv>) => {
    const providers = resolveAdminProviders(c, deps)
    const id = requireRouteParam(c, 'id')
    const attempt = await getAttendanceAttempt({
      id,
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, attempt, 'Attendance attempt retrieved successfully.')
  }

  router.get('/attendance/attempts/:id', handleGetAttendanceAttempt)
  router.get('/attendances/attempts/:id', handleGetAttendanceAttempt)

  // GET /v1/admin/attendance/:id & /v1/admin/attendances/:id
  const handleGetAttendance = async (c: Context<AppEnv>) => {
    const providers = resolveAdminProviders(c, deps)
    const id = requireRouteParam(c, 'id')
    const attendance = await getAttendance({
      id,
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, attendance, 'Attendance retrieved successfully.')
  }

  // GET /v1/admin/attendance/export & /v1/admin/attendances/export
  //
  // Chronos exports and aggregate views need a complete, stable snapshot.
  // Returning one bounded server-side collection avoids making a client walk
  // hundreds of 100-row pages through the per-user admin-session limiter.
  const handleCollectAttendances = async (c: Context<AppEnv>) => {
    const providers = resolveAdminProviders(c, deps)
    const userId = c.req.query('user_id') ?? c.req.query('userId')
    const date = c.req.query('date')
    const startDate = c.req.query('start_date') ?? c.req.query('startDate')
    const endDate = c.req.query('end_date') ?? c.req.query('endDate')
    const status = c.req.query('status')
    const actionType = c.req.query('action_type') ?? c.req.query('actionType')

    assertValidAttendanceDateFilters(date, startDate, endDate)

    const maxRows = 50_000
    const attendances = await listAttendances({
      filter: {
        userId,
        date,
        startDate,
        endDate,
        status,
        actionType,
        limit: maxRows,
        offset: 0,
      },
      actorRole: c.get('profileRole'),
      providers,
    })

    if (attendances.length >= maxRows) {
      throw AppError.validationError(
        `Attendance collection exceeds the ${maxRows}-row safety limit.`,
      )
    }

    return successResponse(
      c,
      attendances,
      'Complete attendances collection retrieved successfully.',
      200,
      { pagination: { limit: attendances.length, offset: 0, has_more: false } },
    )
  }

  // Keep these routes before /:id so "export" cannot be parsed as an id.
  router.get('/attendance/export', handleCollectAttendances)
  router.get('/attendances/export', handleCollectAttendances)

  // GET /v1/admin/attendance & /v1/admin/attendances
  const handleListAttendances = async (c: Context<AppEnv>) => {
    const providers = resolveAdminProviders(c, deps)
    const userId = c.req.query('user_id') ?? c.req.query('userId')
    const date = c.req.query('date')
    const startDate = c.req.query('start_date') ?? c.req.query('startDate')
    const endDate = c.req.query('end_date') ?? c.req.query('endDate')
    const status = c.req.query('status')
    const actionType = c.req.query('action_type') ?? c.req.query('actionType')
    const limitQuery = c.req.query('limit')
    const offsetQuery = c.req.query('offset')

    const limit = limitQuery ? Number(limitQuery) : 50
    const offset = offsetQuery ? Number(offsetQuery) : 0

    if (
      limitQuery !== undefined &&
      (limitQuery.trim() === '' || !Number.isInteger(limit) || limit < 1 || limit > 100)
    ) {
      throw AppError.validationError('limit must be an integer between 1 and 100.')
    }
    if (
      offsetQuery !== undefined &&
      (offsetQuery.trim() === '' || !Number.isInteger(offset) || offset < 0)
    ) {
      throw AppError.validationError('offset must be a non-negative integer.')
    }

    assertValidAttendanceDateFilters(date, startDate, endDate)

    const attendances = await listAttendances({
      filter: {
        userId,
        date,
        startDate,
        endDate,
        status,
        actionType,
        limit: limit + 1,
        offset,
      },
      actorRole: c.get('profileRole'),
      providers,
    })
    const hasMore = attendances.length > limit

    return successResponse(
      c,
      attendances.slice(0, limit),
      'Attendances retrieved successfully.',
      200,
      { pagination: { limit, offset, has_more: hasMore } },
    )
  }

  router.get('/attendance', handleListAttendances)
  router.get('/attendances', handleListAttendances)
  router.get('/attendance/:id', handleGetAttendance)
  router.get('/attendances/:id', handleGetAttendance)
}
