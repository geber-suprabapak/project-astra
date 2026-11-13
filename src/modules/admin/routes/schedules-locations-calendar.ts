import type { Context, Hono } from 'hono'
import { successResponse } from '../../../lib/http/responses.js'
import type { AppEnv } from '../../../types/context.js'
import {
  createCalendarExceptionSchema,
  createLocationSchema,
  createScheduleSchema,
  updateCalendarExceptionSchema,
  updateLocationSchema,
  updateScheduleSchema,
} from '../schema.js'
import {
  createCalendarException,
  createLocation,
  createSchedule,
  deleteCalendarException,
  deleteLocation,
  deleteSchedule,
  getCalendarException,
  getLocation,
  getSchedule,
  listCalendarExceptions,
  listLocations,
  listSchedules,
  updateCalendarException,
  updateLocation,
  updateSchedule,
} from '../service.js'
import {
  type AdminRouterDeps,
  parseJsonBody,
  requireRouteParam,
  resolveAdminProviders,
} from './shared.js'

export function registerScheduleLocationCalendarRoutes(
  router: Hono<AppEnv>,
  deps: AdminRouterDeps,
): void {
  // GET /v1/admin/schedules
  router.get('/schedules', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const classId = c.req.query('class_id') ?? c.req.query('classId')
    const academicPeriodId = c.req.query('academic_period_id') ?? c.req.query('academicPeriodId')
    const dayOfWeek = c.req.query('day_of_week') ?? c.req.query('dayOfWeek')
    const isActiveQuery = c.req.query('is_active') ?? c.req.query('isActive')
    const isActive = isActiveQuery !== undefined ? isActiveQuery === 'true' : undefined
    const schedules = await listSchedules({
      filter: { classId, academicPeriodId, dayOfWeek, isActive },
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, schedules, 'Schedules retrieved successfully.')
  })

  // GET /v1/admin/schedules/:id
  router.get('/schedules/:id', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const id = c.req.param('id')
    const schedule = await getSchedule({
      id,
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, schedule, 'Schedule retrieved successfully.')
  })

  // POST /v1/admin/schedules
  router.post('/schedules', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const data = await parseJsonBody(c, createScheduleSchema)
    const schedule = await createSchedule({
      schoolId: data.school_id ?? data.schoolId,
      classId: data.class_id ?? data.classId,
      academicPeriodId: data.academic_period_id ?? data.academicPeriodId,
      locationId: data.location_id ?? data.locationId,
      dayOfWeek: (data.day_of_week ?? data.dayOfWeek)!,
      startTime: (data.start_time ?? data.startTime)!,
      endTime: (data.end_time ?? data.endTime)!,
      startCheckout: (data.start_checkout ?? data.startCheckout)!,
      endCheckout: (data.end_checkout ?? data.endCheckout)!,
      gracePeriodMinutes: data.grace_period_minutes ?? data.gracePeriodMinutes,
      isActive: data.is_active ?? data.isActive,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, schedule, 'Schedule created successfully.', 201)
  })

  // PUT|PATCH /v1/admin/schedules/:id
  const handleUpdateSchedule = async (c: Context<AppEnv>) => {
    const providers = resolveAdminProviders(c, deps)
    const id = requireRouteParam(c, 'id')
    const data = await parseJsonBody(c, updateScheduleSchema)
    const schedule = await updateSchedule({
      id,
      classId: data.class_id ?? data.classId,
      academicPeriodId: data.academic_period_id ?? data.academicPeriodId,
      locationId: data.location_id ?? data.locationId,
      dayOfWeek: data.day_of_week ?? data.dayOfWeek,
      startTime: data.start_time ?? data.startTime,
      endTime: data.end_time ?? data.endTime,
      startCheckout: data.start_checkout ?? data.startCheckout,
      endCheckout: data.end_checkout ?? data.endCheckout,
      gracePeriodMinutes: data.grace_period_minutes ?? data.gracePeriodMinutes,
      isActive: data.is_active ?? data.isActive,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, schedule, 'Schedule updated successfully.')
  }

  router.put('/schedules/:id', handleUpdateSchedule)
  router.patch('/schedules/:id', handleUpdateSchedule)

  // DELETE /v1/admin/schedules/:id
  router.delete('/schedules/:id', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const id = c.req.param('id')
    await deleteSchedule({
      id,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, { id }, 'Schedule deleted successfully.')
  })

  // GET /v1/admin/locations
  router.get('/locations', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const isActiveQuery = c.req.query('is_active') ?? c.req.query('isActive')
    const isActive = isActiveQuery !== undefined ? isActiveQuery === 'true' : undefined
    const locations = await listLocations({
      filter: { isActive },
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, locations, 'Locations retrieved successfully.')
  })

  // GET /v1/admin/locations/:id
  router.get('/locations/:id', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const id = c.req.param('id')
    const loc = await getLocation({
      id,
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, loc, 'Location retrieved successfully.')
  })

  // POST /v1/admin/locations
  router.post('/locations', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const data = await parseJsonBody(c, createLocationSchema)
    const loc = await createLocation({
      name: data.name,
      latitude: data.latitude,
      longitude: data.longitude,
      radiusMeters: data.radius_meters ?? data.radiusMeters,
      isActive: data.is_active ?? data.isActive,
      schoolId: data.school_id ?? data.schoolId,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, loc, 'Location created successfully.', 201)
  })

  // PUT|PATCH /v1/admin/locations/:id
  const handleUpdateLocation = async (c: Context<AppEnv>) => {
    const providers = resolveAdminProviders(c, deps)
    const id = requireRouteParam(c, 'id')
    const data = await parseJsonBody(c, updateLocationSchema)
    const loc = await updateLocation({
      id,
      name: data.name,
      latitude: data.latitude,
      longitude: data.longitude,
      radiusMeters: data.radius_meters ?? data.radiusMeters,
      isActive: data.is_active ?? data.isActive,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, loc, 'Location updated successfully.')
  }

  router.put('/locations/:id', handleUpdateLocation)
  router.patch('/locations/:id', handleUpdateLocation)

  // DELETE /v1/admin/locations/:id
  router.delete('/locations/:id', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const id = c.req.param('id')
    await deleteLocation({
      id,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, { id }, 'Location deleted successfully.')
  })

  // GET /v1/admin/calendar-exceptions
  router.get('/calendar-exceptions', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const academicPeriodId = c.req.query('academic_period_id') ?? c.req.query('academicPeriodId')
    const startDate = c.req.query('start_date') ?? c.req.query('startDate')
    const endDate = c.req.query('end_date') ?? c.req.query('endDate')
    const exceptions = await listCalendarExceptions({
      filter: { academicPeriodId, startDate, endDate },
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, exceptions, 'Calendar exceptions retrieved successfully.')
  })

  // GET /v1/admin/calendar-exceptions/:id
  router.get('/calendar-exceptions/:id', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const id = c.req.param('id')
    const exc = await getCalendarException({
      id,
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, exc, 'Calendar exception retrieved successfully.')
  })

  // POST /v1/admin/calendar-exceptions
  router.post('/calendar-exceptions', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const data = await parseJsonBody(c, createCalendarExceptionSchema)
    const exc = await createCalendarException({
      date: data.date,
      reason: data.reason,
      isHoliday: data.is_holiday ?? data.isHoliday,
      academicPeriodId: data.academic_period_id ?? data.academicPeriodId,
      schoolId: data.school_id ?? data.schoolId,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, exc, 'Calendar exception created successfully.', 201)
  })

  // PUT /v1/admin/calendar-exceptions/:id
  router.put('/calendar-exceptions/:id', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const id = c.req.param('id')
    const data = await parseJsonBody(c, updateCalendarExceptionSchema)
    const exc = await updateCalendarException({
      id,
      academicPeriodId: data.academic_period_id ?? data.academicPeriodId,
      date: data.date,
      reason: data.reason,
      isHoliday: data.is_holiday ?? data.isHoliday,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, exc, 'Calendar exception updated successfully.')
  })

  // DELETE /v1/admin/calendar-exceptions/:id
  router.delete('/calendar-exceptions/:id', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const id = c.req.param('id')
    await deleteCalendarException({
      id,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, { id }, 'Calendar exception deleted successfully.')
  })
}
