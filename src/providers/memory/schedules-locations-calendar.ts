import { randomUUID } from 'node:crypto'
import { AppError } from '../../lib/errors/app-error.js'
import { expandDateRange, resolveCalendarExceptionForDate } from '../shared/academic-batch.js'
import {
  toWibDate,
  type CalendarException,
  type CreateCalendarExceptionParams,
  type CreateCalendarExceptionRangeParams,
  type CreateCalendarExceptionRangeResult,
  type CreateLocationParams,
  type CreateScheduleParams,
  type Location,
  type Schedule,
  type UpdateCalendarExceptionParams,
  type UpdateLocationParams,
  type UpdateScheduleParams,
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
    list = list.filter(
      (e) => !e.academic_period_id || e.academic_period_id === filter.academicPeriodId,
    )
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
  const match = resolveCalendarExceptionForDate(
    Array.from(store.calendarExceptions.values()),
    academicPeriodId,
    date,
  )
  return match ? { ...match } : null
}

interface MemoryCalendarConflictScan {
  conflictingDates: string[]
  attendanceCount: number
  approvedLeaveCount: number
}

function scanMemoryCalendarConflicts(
  store: MemoryDomainState,
  startDate: string,
  endDate: string,
): MemoryCalendarConflictScan {
  const dates = expandDateRange(startDate, endDate, 90)
  const conflictingDateSet = new Set<string>()
  let attendanceCount = 0

  for (const att of store.attendancesList) {
    const d = att.date.slice(0, 10)
    if (d >= startDate && d <= endDate) {
      attendanceCount++
      conflictingDateSet.add(d)
    }
  }
  if (attendanceCount === 0) {
    for (const abs of store.absences) {
      const d = (abs.date ?? abs.created_at).slice(0, 10)
      if (d >= startDate && d <= endDate) {
        attendanceCount++
        conflictingDateSet.add(d)
      }
    }
  }

  let approvedLeaveCount = 0
  for (const permit of store.permits) {
    if (permit.approval_status !== 'approved') continue
    const leaveStart = toWibDate(permit.tanggal)
    const leaveEnd = toWibDate(permit.effective_end_date ?? permit.original_end_date ?? leaveStart)
    if (leaveStart <= endDate && leaveEnd >= startDate) {
      approvedLeaveCount++
      for (const d of dates) {
        if (d >= leaveStart && d <= leaveEnd) {
          conflictingDateSet.add(d)
        }
      }
    }
  }

  return {
    conflictingDates: Array.from(conflictingDateSet).sort(),
    attendanceCount,
    approvedLeaveCount,
  }
}

function assertMemoryCalendarUniqueDate(
  store: MemoryDomainState,
  schoolId: string | null,
  academicPeriodId: string | null,
  date: string,
  ignoreId?: string,
): void {
  const duplicate = Array.from(store.calendarExceptions.values()).find(
    (e) =>
      e.id !== ignoreId &&
      (e.school_id ?? null) === (schoolId ?? null) &&
      (e.academic_period_id ?? null) === (academicPeriodId ?? null) &&
      e.date === date,
  )
  if (duplicate) {
    throw AppError.conflict('Calendar exception already exists for this date and scope.', {
      reason_code: 'CALENDAR_DUPLICATE_DATE',
      date,
    })
  }
}

export function createMemoryCalendarException(
  store: MemoryDomainState,
  params: CreateCalendarExceptionParams,
): CalendarException {
  const formattedDate = params.date.slice(0, 10)
  const isHoliday = params.isHoliday ?? true
  const schoolId = params.schoolId ?? store.schools[0]?.id ?? null
  const academicPeriodId = params.academicPeriodId ?? null

  if (isHoliday) {
    const conflicts = scanMemoryCalendarConflicts(store, formattedDate, formattedDate)
    if (conflicts.attendanceCount > 0 || conflicts.approvedLeaveCount > 0) {
      const overrideReason = params.overrideReason?.trim() ?? ''
      if (!params.overrideConflicts || overrideReason.length < 3) {
        throw AppError.conflict(
          'Date conflicts with existing attendance or approved leave records.',
          {
            reason_code: 'CALENDAR_CONFLICT',
            conflicting_dates: conflicts.conflictingDates,
            attendance_count: conflicts.attendanceCount,
            approved_leave_count: conflicts.approvedLeaveCount,
          },
        )
      }
    }
  }

  assertMemoryCalendarUniqueDate(store, schoolId, academicPeriodId, formattedDate)

  const now = new Date().toISOString()
  const id = `cal-exc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const exc: CalendarException = {
    id,
    school_id: schoolId,
    academic_period_id: academicPeriodId,
    date: formattedDate,
    reason: params.reason,
    is_holiday: isHoliday,
    group_id: params.groupId ?? null,
    created_at: now,
    updated_at: now,
  }
  store.calendarExceptions.set(id, exc)
  return { ...exc }
}

export function createMemoryCalendarExceptionRange(
  store: MemoryDomainState,
  params: CreateCalendarExceptionRangeParams,
): CreateCalendarExceptionRangeResult {
  const dates = expandDateRange(params.startDate.slice(0, 10), params.endDate.slice(0, 10), 90)
  const isHoliday = params.isHoliday ?? true
  const schoolId = params.schoolId ?? store.schools[0]?.id ?? null
  const academicPeriodId = params.academicPeriodId ?? null

  let attendanceCount = 0
  let approvedLeaveCount = 0
  if (isHoliday) {
    const conflicts = scanMemoryCalendarConflicts(store, dates[0]!, dates[dates.length - 1]!)
    attendanceCount = conflicts.attendanceCount
    approvedLeaveCount = conflicts.approvedLeaveCount
    if (attendanceCount > 0 || approvedLeaveCount > 0) {
      const overrideReason = params.overrideReason?.trim() ?? ''
      if (!params.overrideConflicts || overrideReason.length < 3) {
        throw AppError.conflict(
          'Date range conflicts with existing attendance or approved leave records.',
          {
            reason_code: 'CALENDAR_CONFLICT',
            conflicting_dates: conflicts.conflictingDates,
            attendance_count: attendanceCount,
            approved_leave_count: approvedLeaveCount,
          },
        )
      }
    }
  }

  for (const d of dates) {
    assertMemoryCalendarUniqueDate(store, schoolId, academicPeriodId, d)
  }

  const groupId = randomUUID()
  const now = new Date().toISOString()
  const items: CalendarException[] = []
  for (const date of dates) {
    const id = `cal-exc-${randomUUID()}`
    const exc: CalendarException = {
      id,
      school_id: schoolId,
      academic_period_id: academicPeriodId,
      date,
      reason: params.reason,
      is_holiday: isHoliday,
      group_id: groupId,
      created_at: now,
      updated_at: now,
    }
    store.calendarExceptions.set(id, exc)
    items.push({ ...exc })
  }

  return {
    group_id: groupId,
    items,
    override_conflicts: Boolean(
      params.overrideConflicts && (attendanceCount > 0 || approvedLeaveCount > 0),
    ),
    attendance_count: attendanceCount,
    approved_leave_count: approvedLeaveCount,
  }
}

export function updateMemoryCalendarException(
  store: MemoryDomainState,
  id: string,
  params: UpdateCalendarExceptionParams,
): CalendarException {
  const exc = store.calendarExceptions.get(id)
  if (!exc) throw AppError.notFound('Calendar exception')

  const nextDate = params.date !== undefined ? params.date.slice(0, 10) : exc.date
  const nextPeriodId =
    params.academicPeriodId !== undefined
      ? params.academicPeriodId
      : (exc.academic_period_id ?? null)
  assertMemoryCalendarUniqueDate(store, exc.school_id ?? null, nextPeriodId, nextDate, id)

  exc.date = nextDate
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

export interface DeletedCalendarGroupResult {
  group_id: string
  deleted_count: number
}

export function deleteMemoryCalendarExceptionGroup(
  store: MemoryDomainState,
  groupId: string,
): DeletedCalendarGroupResult {
  let deleted = 0
  for (const [id, exc] of store.calendarExceptions.entries()) {
    if (exc.group_id === groupId) {
      store.calendarExceptions.delete(id)
      deleted++
    }
  }
  if (deleted === 0) throw AppError.notFound('Calendar exception group')
  return { group_id: groupId, deleted_count: deleted }
}
