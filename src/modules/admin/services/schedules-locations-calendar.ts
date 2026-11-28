import { AppError } from '../../../lib/errors/app-error.js'
import type {
  AppProviders,
  AuditLogDetails,
  CalendarException,
  CreateCalendarExceptionRangeResult,
  IdentityRole,
  Location,
  Schedule,
} from '../../../providers/types.js'
import { assertAdminAccess, assertChronosStaffAccess, withAuditCorrelation } from './shared.js'

// --- Schedules ---

export async function listSchedules(params: {
  filter?: {
    classId?: string
    academicPeriodId?: string
    dayOfWeek?: string
    isActive?: boolean
  }
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Schedule[]> {
  assertChronosStaffAccess(params.actorRole)
  return params.providers.domainStore.listSchedules(params.filter)
}

export async function getSchedule(params: {
  id: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Schedule> {
  assertAdminAccess(params.actorRole)
  const schedule = await params.providers.domainStore.getScheduleById(params.id)
  if (!schedule) throw AppError.notFound('Schedule')
  return schedule
}

export async function createSchedule(params: {
  schoolId?: string | null
  classId?: string | null
  academicPeriodId?: string | null
  locationId?: string | null
  dayOfWeek: string
  startTime: string
  endTime: string
  startCheckout: string
  endCheckout: string
  gracePeriodMinutes?: number
  isActive?: boolean
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Schedule> {
  assertAdminAccess(params.actorRole)
  const schedule = await params.providers.domainStore.createSchedule({
    schoolId: params.schoolId,
    classId: params.classId,
    academicPeriodId: params.academicPeriodId,
    locationId: params.locationId,
    dayOfWeek: params.dayOfWeek,
    startTime: params.startTime,
    endTime: params.endTime,
    startCheckout: params.startCheckout,
    endCheckout: params.endCheckout,
    gracePeriodMinutes: params.gracePeriodMinutes,
    isActive: params.isActive,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'create_schedule',
    entity_type: 'schedule',
    entity_id: schedule.id ?? 'unknown',
    details: {
      day_of_week: schedule.day_of_week ?? schedule.hari,
      start_time: schedule.mulai_masuk,
      end_time: schedule.selesai_masuk,
      class_id: schedule.class_id,
      academic_period_id: schedule.academic_period_id,
      location_id: schedule.location_id,
    },
  })

  return schedule
}

export async function updateSchedule(params: {
  id: string
  classId?: string | null
  academicPeriodId?: string | null
  locationId?: string | null
  dayOfWeek?: string
  startTime?: string
  endTime?: string
  startCheckout?: string
  endCheckout?: string
  gracePeriodMinutes?: number
  isActive?: boolean
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Schedule> {
  assertAdminAccess(params.actorRole)
  const schedule = await params.providers.domainStore.updateSchedule(params.id, {
    classId: params.classId,
    academicPeriodId: params.academicPeriodId,
    locationId: params.locationId,
    dayOfWeek: params.dayOfWeek,
    startTime: params.startTime,
    endTime: params.endTime,
    startCheckout: params.startCheckout,
    endCheckout: params.endCheckout,
    gracePeriodMinutes: params.gracePeriodMinutes,
    isActive: params.isActive,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'update_schedule',
    entity_type: 'schedule',
    entity_id: schedule.id ?? params.id,
    details: {
      day_of_week: schedule.day_of_week ?? schedule.hari,
      start_time: schedule.mulai_masuk,
      end_time: schedule.selesai_masuk,
      class_id: schedule.class_id,
      academic_period_id: schedule.academic_period_id,
      location_id: schedule.location_id,
    },
  })

  return schedule
}

export async function deleteSchedule(params: {
  id: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<void> {
  assertAdminAccess(params.actorRole)
  await params.providers.domainStore.deleteSchedule(params.id)

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'delete_schedule',
    entity_type: 'schedule',
    entity_id: params.id,
    details: { id: params.id },
  })
}

// --- Locations ---

export async function listLocations(params: {
  filter?: { isActive?: boolean }
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Location[]> {
  assertAdminAccess(params.actorRole)
  return params.providers.domainStore.listLocations(params.filter)
}

export async function getLocation(params: {
  id: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Location> {
  assertAdminAccess(params.actorRole)
  const loc = await params.providers.domainStore.getLocationById(params.id)
  if (!loc) throw AppError.notFound('Location')
  return loc
}

export async function createLocation(params: {
  name: string
  latitude: number
  longitude: number
  radiusMeters?: number
  isActive?: boolean
  schoolId?: string | null
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Location> {
  assertAdminAccess(params.actorRole)
  const loc = await params.providers.domainStore.createLocation({
    name: params.name,
    latitude: params.latitude,
    longitude: params.longitude,
    radiusMeters: params.radiusMeters,
    isActive: params.isActive,
    schoolId: params.schoolId,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'create_location',
    entity_type: 'location',
    entity_id: loc.id,
    details: {
      name: loc.name,
      latitude: loc.latitude,
      longitude: loc.longitude,
      radius_meters: loc.radius_meters,
    },
  })

  return loc
}

export async function updateLocation(params: {
  id: string
  name?: string
  latitude?: number
  longitude?: number
  radiusMeters?: number
  isActive?: boolean
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Location> {
  assertAdminAccess(params.actorRole)
  const loc = await params.providers.domainStore.updateLocation(params.id, {
    name: params.name,
    latitude: params.latitude,
    longitude: params.longitude,
    radiusMeters: params.radiusMeters,
    isActive: params.isActive,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'update_location',
    entity_type: 'location',
    entity_id: loc.id,
    details: {
      name: loc.name,
      latitude: loc.latitude,
      longitude: loc.longitude,
      radius_meters: loc.radius_meters,
    },
  })

  return loc
}

export async function deleteLocation(params: {
  id: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<void> {
  assertAdminAccess(params.actorRole)
  await params.providers.domainStore.deleteLocation(params.id)

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'delete_location',
    entity_type: 'location',
    entity_id: params.id,
    details: { id: params.id },
  })
}

// --- Calendar Exceptions ---

export async function listCalendarExceptions(params: {
  filter?: {
    academicPeriodId?: string
    startDate?: string
    endDate?: string
  }
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<CalendarException[]> {
  assertChronosStaffAccess(params.actorRole)
  return params.providers.domainStore.listCalendarExceptions(params.filter)
}

export async function getCalendarException(params: {
  id: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<CalendarException> {
  assertChronosStaffAccess(params.actorRole)
  const exc = await params.providers.domainStore.getCalendarExceptionById(params.id)
  if (!exc) throw AppError.notFound('Calendar exception')
  return exc
}

export async function createCalendarException(params: {
  schoolId?: string | null
  academicPeriodId?: string | null
  date: string
  reason: string
  isHoliday?: boolean
  overrideConflicts?: boolean
  overrideReason?: string
  actorId: string
  actorRole: IdentityRole | null
  requestId?: string
  providers: AppProviders
}): Promise<CalendarException> {
  assertAdminAccess(params.actorRole)
  const exc = await params.providers.domainStore.createCalendarException({
    schoolId: params.schoolId,
    academicPeriodId: params.academicPeriodId,
    date: params.date,
    reason: params.reason,
    isHoliday: params.isHoliday,
    overrideConflicts: params.overrideConflicts,
    overrideReason: params.overrideReason,
  })

  const singleDetails: AuditLogDetails = {
    date: exc.date,
    reason: exc.reason,
    is_holiday: exc.is_holiday,
    academic_period_id: exc.academic_period_id,
    override_conflicts: params.overrideConflicts === true,
  }
  if (params.overrideReason) singleDetails.override_reason = params.overrideReason

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'create_calendar_exception',
    entity_type: 'calendar_exception',
    entity_id: exc.id,
    details: withAuditCorrelation(singleDetails, params.requestId),
  })

  return exc
}

export async function createCalendarExceptionRange(params: {
  schoolId?: string | null
  academicPeriodId?: string | null
  startDate: string
  endDate: string
  reason: string
  isHoliday?: boolean
  overrideConflicts?: boolean
  overrideReason?: string
  actorId: string
  actorRole: IdentityRole | null
  requestId?: string
  providers: AppProviders
}): Promise<CreateCalendarExceptionRangeResult> {
  assertAdminAccess(params.actorRole)
  const result = await params.providers.domainStore.createCalendarExceptionRange({
    schoolId: params.schoolId,
    academicPeriodId: params.academicPeriodId,
    startDate: params.startDate,
    endDate: params.endDate,
    reason: params.reason,
    isHoliday: params.isHoliday,
    overrideConflicts: params.overrideConflicts,
    overrideReason: params.overrideReason,
  })

  const rangeDetails: AuditLogDetails = {
    group_id: result.group_id,
    start_date: params.startDate,
    end_date: params.endDate,
    days_count: result.items.length,
    reason: params.reason,
    is_holiday: params.isHoliday ?? true,
    academic_period_id: params.academicPeriodId ?? null,
    override_conflicts: result.override_conflicts,
    attendance_count: result.attendance_count,
    approved_leave_count: result.approved_leave_count,
  }
  if (params.overrideReason) rangeDetails.override_reason = params.overrideReason

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'create_calendar_exception_range',
    entity_type: 'calendar_exception',
    entity_id: result.group_id,
    details: withAuditCorrelation(rangeDetails, params.requestId),
  })

  return result
}

export async function updateCalendarException(params: {
  id: string
  academicPeriodId?: string | null
  date?: string
  reason?: string
  isHoliday?: boolean
  actorId: string
  actorRole: IdentityRole | null
  requestId?: string
  providers: AppProviders
}): Promise<CalendarException> {
  assertAdminAccess(params.actorRole)
  const exc = await params.providers.domainStore.updateCalendarException(params.id, {
    academicPeriodId: params.academicPeriodId,
    date: params.date,
    reason: params.reason,
    isHoliday: params.isHoliday,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'update_calendar_exception',
    entity_type: 'calendar_exception',
    entity_id: exc.id,
    details: withAuditCorrelation(
      {
        date: exc.date,
        reason: exc.reason,
        is_holiday: exc.is_holiday,
        academic_period_id: exc.academic_period_id,
      },
      params.requestId,
    ),
  })

  return exc
}

export async function deleteCalendarException(params: {
  id: string
  actorId: string
  actorRole: IdentityRole | null
  requestId?: string
  providers: AppProviders
}): Promise<void> {
  assertAdminAccess(params.actorRole)
  await params.providers.domainStore.deleteCalendarException(params.id)

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'delete_calendar_exception',
    entity_type: 'calendar_exception',
    entity_id: params.id,
    details: withAuditCorrelation({ id: params.id }, params.requestId),
  })
}

export async function deleteCalendarExceptionGroup(params: {
  groupId: string
  actorId: string
  actorRole: IdentityRole | null
  requestId?: string
  providers: AppProviders
}): Promise<{ group_id: string; deleted_count: number }> {
  assertAdminAccess(params.actorRole)
  const result = await params.providers.domainStore.deleteCalendarExceptionGroup(params.groupId)

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'delete_calendar_exception_group',
    entity_type: 'calendar_exception',
    entity_id: params.groupId,
    details: withAuditCorrelation(
      {
        group_id: result.group_id,
        deleted_count: result.deleted_count,
      },
      params.requestId,
    ),
  })

  return result
}
