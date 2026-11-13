import { AppError } from '../../lib/errors/app-error.js'
import type {
  CalendarException,
  CreateCalendarExceptionParams,
  CreateLocationParams,
  CreateScheduleParams,
  Location,
  Schedule,
  UpdateCalendarExceptionParams,
  UpdateLocationParams,
  UpdateScheduleParams,
} from '../types.js'
import type { MemoryDomainState } from './domain-state.js'

export function getMemoryActiveSchedule(
  store: MemoryDomainState,
  dayKey: string,
  params?: { classId?: string; academicPeriodId?: string },
): Schedule | null {
  const day = dayKey.toLowerCase()
  const activeSchedules = Array.from(store.schedules.values()).filter(
    (s) => s.is_active && (s.day_of_week?.toLowerCase() === day || s.hari?.toLowerCase() === day),
  )

  if (activeSchedules.length === 0) return null

  // 1. Match classId + academicPeriodId
  if (params?.classId && params?.academicPeriodId) {
    const matched = activeSchedules.find(
      (s) => s.class_id === params.classId && s.academic_period_id === params.academicPeriodId,
    )
    if (matched) return { ...matched }
  }

  // 2. Match classId only
  if (params?.classId) {
    const matched = activeSchedules.find((s) => s.class_id === params.classId)
    if (matched) return { ...matched }
  }

  // 3. Match academicPeriodId only
  if (params?.academicPeriodId) {
    const matched = activeSchedules.find(
      (s) => s.academic_period_id === params.academicPeriodId && !s.class_id,
    )
    if (matched) return { ...matched }
  }

  // 4. Match general/school-wide (no classId, no academicPeriodId)
  const general = activeSchedules.find((s) => !s.class_id && !s.academic_period_id)
  if (general) return { ...general }

  return { ...activeSchedules[0] }
}

export function listMemorySchedules(
  store: MemoryDomainState,
  filter?: {
    classId?: string
    academicPeriodId?: string
    dayOfWeek?: string
    isActive?: boolean
  },
): Schedule[] {
  let list = Array.from(store.schedules.values())
  if (filter?.classId !== undefined) {
    list = list.filter((s) => s.class_id === filter.classId)
  }
  if (filter?.academicPeriodId !== undefined) {
    list = list.filter((s) => s.academic_period_id === filter.academicPeriodId)
  }
  if (filter?.dayOfWeek !== undefined) {
    const day = filter.dayOfWeek.toLowerCase()
    list = list.filter((s) => s.day_of_week?.toLowerCase() === day || s.hari?.toLowerCase() === day)
  }
  if (filter?.isActive !== undefined) {
    list = list.filter((s) => s.is_active === filter.isActive)
  }
  return list.map((s) => ({ ...s }))
}

export function getMemoryScheduleById(store: MemoryDomainState, id: string): Schedule | null {
  const s =
    store.schedules.get(id) ?? Array.from(store.schedules.values()).find((item) => item.id === id)
  return s ? { ...s } : null
}

export function createMemorySchedule(
  store: MemoryDomainState,
  params: CreateScheduleParams,
): Schedule {
  const now = new Date().toISOString()
  const id = `sched-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const schedule: Schedule = {
    id,
    school_id: params.schoolId ?? store.schools[0]?.id ?? null,
    class_id: params.classId ?? null,
    academic_period_id: params.academicPeriodId ?? null,
    location_id: params.locationId ?? null,
    day_of_week: params.dayOfWeek.toLowerCase(),
    hari: params.dayOfWeek.toLowerCase(),
    mulai_masuk: params.startTime,
    selesai_masuk: params.endTime,
    mulai_pulang: params.startCheckout,
    selesai_pulang: params.endCheckout,
    kompensasi_waktu: params.gracePeriodMinutes ?? 0,
    is_active: params.isActive ?? true,
    created_at: now,
    updated_at: now,
  }
  store.schedules.set(id, schedule)
  return { ...schedule }
}

export function updateMemorySchedule(
  store: MemoryDomainState,
  id: string,
  params: UpdateScheduleParams,
): Schedule {
  const schedule =
    store.schedules.get(id) ?? Array.from(store.schedules.values()).find((item) => item.id === id)
  if (!schedule) throw AppError.notFound('Schedule')

  if (params.dayOfWeek !== undefined) {
    schedule.day_of_week = params.dayOfWeek.toLowerCase()
    schedule.hari = params.dayOfWeek.toLowerCase()
  }
  if (params.startTime !== undefined) schedule.mulai_masuk = params.startTime
  if (params.endTime !== undefined) schedule.selesai_masuk = params.endTime
  if (params.startCheckout !== undefined) schedule.mulai_pulang = params.startCheckout
  if (params.endCheckout !== undefined) schedule.selesai_pulang = params.endCheckout
  if (params.gracePeriodMinutes !== undefined) schedule.kompensasi_waktu = params.gracePeriodMinutes
  if (params.isActive !== undefined) schedule.is_active = params.isActive
  if (params.classId !== undefined) schedule.class_id = params.classId
  if (params.academicPeriodId !== undefined) schedule.academic_period_id = params.academicPeriodId
  if (params.locationId !== undefined) schedule.location_id = params.locationId

  schedule.updated_at = new Date().toISOString()
  store.schedules.set(schedule.id ?? id, schedule)
  return { ...schedule }
}

export function deleteMemorySchedule(store: MemoryDomainState, id: string): void {
  const schedule =
    store.schedules.get(id) ?? Array.from(store.schedules.values()).find((item) => item.id === id)
  if (!schedule) throw AppError.notFound('Schedule')
  store.schedules.delete(schedule.id ?? id)
}

export function listMemoryLocations(
  store: MemoryDomainState,
  filter?: { isActive?: boolean },
): Location[] {
  let list = Array.from(store.locations.values())
  if (filter?.isActive !== undefined) {
    list = list.filter((loc) => loc.is_active === filter.isActive)
  }
  return list.map((loc) => ({ ...loc }))
}

export function getMemoryLocationById(store: MemoryDomainState, id: string): Location | null {
  const loc = store.locations.get(id)
  return loc ? { ...loc } : null
}

export function createMemoryLocation(
  store: MemoryDomainState,
  params: CreateLocationParams,
): Location {
  const now = new Date().toISOString()
  const id = `loc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const location: Location = {
    id,
    school_id: params.schoolId ?? store.schools[0]?.id ?? null,
    name: params.name,
    latitude: params.latitude,
    longitude: params.longitude,
    radius_meters: params.radiusMeters ?? 100.0,
    is_active: params.isActive ?? true,
    created_at: now,
    updated_at: now,
  }
  store.locations.set(id, location)
  return { ...location }
}

export function updateMemoryLocation(
  store: MemoryDomainState,
  id: string,
  params: UpdateLocationParams,
): Location {
  const loc = store.locations.get(id)
  if (!loc) throw AppError.notFound('Location')
  if (params.name !== undefined) loc.name = params.name
  if (params.latitude !== undefined) loc.latitude = params.latitude
  if (params.longitude !== undefined) loc.longitude = params.longitude
  if (params.radiusMeters !== undefined) loc.radius_meters = params.radiusMeters
  if (params.isActive !== undefined) loc.is_active = params.isActive
  loc.updated_at = new Date().toISOString()
  store.locations.set(id, loc)
  return { ...loc }
}

export function deleteMemoryLocation(store: MemoryDomainState, id: string): void {
  if (!store.locations.has(id)) throw AppError.notFound('Location')
  store.locations.delete(id)
}

export function listMemoryCalendarExceptions(
  store: MemoryDomainState,
  filter?: {
    academicPeriodId?: string
    startDate?: string
    endDate?: string
  },
): CalendarException[] {
  let list = Array.from(store.calendarExceptions.values())
  if (filter?.academicPeriodId) {
    list = list.filter((e) => e.academic_period_id === filter.academicPeriodId)
  }
  if (filter?.startDate) {
    list = list.filter((e) => e.date >= filter.startDate!)
  }
  if (filter?.endDate) {
    list = list.filter((e) => e.date <= filter.endDate!)
  }
  return list.map((e) => ({ ...e }))
}

export function getMemoryCalendarExceptionById(
  store: MemoryDomainState,
  id: string,
): CalendarException | null {
  const e = store.calendarExceptions.get(id)
  return e ? { ...e } : null
}

export function getMemoryCalendarExceptionByDate(
  store: MemoryDomainState,
  date: string,
  academicPeriodId?: string,
): CalendarException | null {
  const formattedDate = date.slice(0, 10)
  for (const e of store.calendarExceptions.values()) {
    if (e.date === formattedDate) {
      if (!academicPeriodId || !e.academic_period_id || e.academic_period_id === academicPeriodId) {
        return { ...e }
      }
    }
  }
  return null
}

export function createMemoryCalendarException(
  store: MemoryDomainState,
  params: CreateCalendarExceptionParams,
): CalendarException {
  const now = new Date().toISOString()
  const id = `cal-exc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const exc: CalendarException = {
    id,
    school_id: params.schoolId ?? store.schools[0]?.id ?? null,
    academic_period_id: params.academicPeriodId ?? null,
    date: params.date.slice(0, 10),
    reason: params.reason,
    is_holiday: params.isHoliday ?? true,
    created_at: now,
    updated_at: now,
  }
  store.calendarExceptions.set(id, exc)
  return { ...exc }
}

export function updateMemoryCalendarException(
  store: MemoryDomainState,
  id: string,
  params: UpdateCalendarExceptionParams,
): CalendarException {
  const exc = store.calendarExceptions.get(id)
  if (!exc) throw AppError.notFound('Calendar exception')
  if (params.date !== undefined) exc.date = params.date.slice(0, 10)
  if (params.reason !== undefined) exc.reason = params.reason
  if (params.isHoliday !== undefined) exc.is_holiday = params.isHoliday
  if (params.academicPeriodId !== undefined) exc.academic_period_id = params.academicPeriodId
  exc.updated_at = new Date().toISOString()
  store.calendarExceptions.set(id, exc)
  return { ...exc }
}

export function deleteMemoryCalendarException(store: MemoryDomainState, id: string): void {
  if (!store.calendarExceptions.has(id)) throw AppError.notFound('Calendar exception')
  store.calendarExceptions.delete(id)
}
