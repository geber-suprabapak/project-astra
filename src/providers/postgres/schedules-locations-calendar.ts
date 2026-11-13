import type { Sql } from 'postgres'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
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
import { resolveSchoolId, withPgError, type PgQuery } from './shared.js'

export interface ActiveScheduleScope {
  classId?: string
  academicPeriodId?: string
}

export interface ScheduleFilter {
  classId?: string
  academicPeriodId?: string
  dayOfWeek?: string
  isActive?: boolean
}

export interface LocationFilter {
  isActive?: boolean
}

export interface CalendarExceptionFilter {
  academicPeriodId?: string
  startDate?: string
  endDate?: string
}

export async function getActiveSchedule(
  sql: PgQuery,
  dayKey: string,
  params?: ActiveScheduleScope,
): Promise<Schedule | null> {
  return withPgError(
    (err) => logger.error({ err, dayKey, params }, 'Failed to query schedule'),
    async () => {
      const day = dayKey.toLowerCase()
      const classId = params?.classId ?? null
      const periodId = params?.academicPeriodId ?? null

      const rows = await sql<Schedule[]>`
        SELECT
          id, school_id, class_id, academic_period_id, location_id,
          day_of_week, day_of_week AS hari, start_time::text AS mulai_masuk, end_time::text AS selesai_masuk,
          start_checkout::text AS mulai_pulang, end_checkout::text AS selesai_pulang,
          grace_period_minutes AS kompensasi_waktu, is_active,
          created_at::text, updated_at::text
        FROM schedules
        WHERE is_active = true
          AND (day_of_week = ${day})
          AND (
            (${classId}::uuid IS NOT NULL AND ${periodId}::uuid IS NOT NULL AND class_id = ${classId}::uuid AND academic_period_id = ${periodId}::uuid)
            OR (${classId}::uuid IS NOT NULL AND class_id = ${classId}::uuid AND academic_period_id IS NULL)
            OR (${periodId}::uuid IS NOT NULL AND academic_period_id = ${periodId}::uuid AND class_id IS NULL)
            OR (class_id IS NULL AND academic_period_id IS NULL)
          )
        ORDER BY
          CASE
            WHEN ${classId}::uuid IS NOT NULL AND ${periodId}::uuid IS NOT NULL AND class_id = ${classId}::uuid AND academic_period_id = ${periodId}::uuid THEN 1
            WHEN ${classId}::uuid IS NOT NULL AND class_id = ${classId}::uuid THEN 2
            WHEN ${periodId}::uuid IS NOT NULL AND academic_period_id = ${periodId}::uuid THEN 3
            ELSE 4
          END ASC
        LIMIT 1
      `
      if (rows && rows.length > 0) {
        return rows[0]
      }

      // Fallback for simple single-day matches if not class/period specific
      const fallbackRows = await sql<Schedule[]>`
        SELECT
          id, school_id, class_id, academic_period_id, location_id,
          day_of_week, day_of_week AS hari, start_time::text AS mulai_masuk, end_time::text AS selesai_masuk,
          start_checkout::text AS mulai_pulang, end_checkout::text AS selesai_pulang,
          grace_period_minutes AS kompensasi_waktu, is_active,
          created_at::text, updated_at::text
        FROM schedules
        WHERE is_active = true AND day_of_week = ${day}
        LIMIT 1
      `
      return fallbackRows[0] ?? null
    },
  )
}

export async function listSchedules(sql: Sql, filter?: ScheduleFilter): Promise<Schedule[]> {
  return withPgError(
    (err) => logger.error({ err, filter }, 'Failed to list schedules'),
    async () => {
      const rows = await sql<Schedule[]>`
        SELECT
          id, school_id, class_id, academic_period_id, location_id,
          day_of_week, day_of_week AS hari, start_time::text AS mulai_masuk, end_time::text AS selesai_masuk,
          start_checkout::text AS mulai_pulang, end_checkout::text AS selesai_pulang,
          grace_period_minutes AS kompensasi_waktu, is_active,
          created_at::text, updated_at::text
        FROM schedules
        WHERE (${filter?.classId ?? null}::uuid IS NULL OR class_id = ${filter?.classId ?? null}::uuid)
          AND (${filter?.academicPeriodId ?? null}::uuid IS NULL OR academic_period_id = ${filter?.academicPeriodId ?? null}::uuid)
          AND (${filter?.dayOfWeek?.toLowerCase() ?? null}::text IS NULL OR day_of_week = ${filter?.dayOfWeek?.toLowerCase() ?? null})
          AND (${filter?.isActive ?? null}::boolean IS NULL OR is_active = ${filter?.isActive ?? null})
        ORDER BY day_of_week ASC, start_time ASC
      `
      return rows ?? []
    },
  )
}

export async function getScheduleById(sql: PgQuery, id: string): Promise<Schedule | null> {
  return withPgError(
    (err) => logger.error({ err, id }, 'Failed to get schedule by id'),
    async () => {
      const rows = await sql<Schedule[]>`
        SELECT
          id, school_id, class_id, academic_period_id, location_id,
          day_of_week, day_of_week AS hari, start_time::text AS mulai_masuk, end_time::text AS selesai_masuk,
          start_checkout::text AS mulai_pulang, end_checkout::text AS selesai_pulang,
          grace_period_minutes AS kompensasi_waktu, is_active,
          created_at::text, updated_at::text
        FROM schedules
        WHERE id = ${id}
        LIMIT 1
      `
      return rows[0] ?? null
    },
  )
}

export async function createSchedule(sql: Sql, params: CreateScheduleParams): Promise<Schedule> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to create schedule'),
    async () => {
      const schoolId = await resolveSchoolId(sql, params.schoolId)
      const rows = await sql<Schedule[]>`
        INSERT INTO schedules (school_id, class_id, academic_period_id, location_id, day_of_week, start_time, end_time, start_checkout, end_checkout, grace_period_minutes, is_active)
        VALUES (${schoolId}, ${params.classId ?? null}, ${params.academicPeriodId ?? null}, ${params.locationId ?? null}, ${params.dayOfWeek.toLowerCase()}, ${params.startTime}::time, ${params.endTime}::time, ${params.startCheckout}::time, ${params.endCheckout}::time, ${params.gracePeriodMinutes ?? 0}, ${params.isActive ?? true})
        RETURNING
          id, school_id, class_id, academic_period_id, location_id,
          day_of_week, day_of_week AS hari, start_time::text AS mulai_masuk, end_time::text AS selesai_masuk,
          start_checkout::text AS mulai_pulang, end_checkout::text AS selesai_pulang,
          grace_period_minutes AS kompensasi_waktu, is_active,
          created_at::text, updated_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.internal('Failed to create schedule.')
      }
      return rows[0]
    },
  )
}

export async function updateSchedule(
  sql: Sql,
  id: string,
  params: UpdateScheduleParams,
): Promise<Schedule> {
  return withPgError(
    (err) => logger.error({ err, id, params }, 'Failed to update schedule'),
    async () => {
      const existing = await getScheduleById(sql, id)
      if (!existing) throw AppError.notFound('Schedule')

      const rows = await sql<Schedule[]>`
        UPDATE schedules
        SET
          day_of_week = COALESCE(${params.dayOfWeek?.toLowerCase() ?? null}, day_of_week),
          start_time = COALESCE(${params.startTime ?? null}::time, start_time),
          end_time = COALESCE(${params.endTime ?? null}::time, end_time),
          start_checkout = COALESCE(${params.startCheckout ?? null}::time, start_checkout),
          end_checkout = COALESCE(${params.endCheckout ?? null}::time, end_checkout),
          grace_period_minutes = COALESCE(${params.gracePeriodMinutes ?? null}, grace_period_minutes),
          is_active = COALESCE(${params.isActive ?? null}, is_active),
          class_id = COALESCE(${params.classId ?? null}, class_id),
          academic_period_id = COALESCE(${params.academicPeriodId ?? null}, academic_period_id),
          location_id = COALESCE(${params.locationId ?? null}, location_id),
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING
          id, school_id, class_id, academic_period_id, location_id,
          day_of_week, day_of_week AS hari, start_time::text AS mulai_masuk, end_time::text AS selesai_masuk,
          start_checkout::text AS mulai_pulang, end_checkout::text AS selesai_pulang,
          grace_period_minutes AS kompensasi_waktu, is_active,
          created_at::text, updated_at::text
      `
      return rows[0]
    },
  )
}

export async function deleteSchedule(sql: Sql, id: string): Promise<void> {
  return withPgError(
    (err) => logger.error({ err, id }, 'Failed to delete schedule'),
    async () => {
      const result = await sql`DELETE FROM schedules WHERE id = ${id}`
      if (result.count === 0) throw AppError.notFound('Schedule')
    },
  )
}

export async function listLocations(sql: Sql, filter?: LocationFilter): Promise<Location[]> {
  return withPgError(
    (err) => logger.error({ err, filter }, 'Failed to list locations'),
    async () => {
      const rows = await sql<Location[]>`
        SELECT id, school_id, name, latitude, longitude, radius_meters, is_active, created_at::text, updated_at::text
        FROM locations
        WHERE (${filter?.isActive ?? null}::boolean IS NULL OR is_active = ${filter?.isActive ?? null})
        ORDER BY name ASC
      `
      return rows ?? []
    },
  )
}

export async function getLocationById(sql: PgQuery, id: string): Promise<Location | null> {
  return withPgError(
    (err) => logger.error({ err, id }, 'Failed to get location by id'),
    async () => {
      const rows = await sql<Location[]>`
        SELECT id, school_id, name, latitude, longitude, radius_meters, is_active, created_at::text, updated_at::text
        FROM locations
        WHERE id = ${id}
        LIMIT 1
      `
      return rows[0] ?? null
    },
  )
}

export async function createLocation(sql: Sql, params: CreateLocationParams): Promise<Location> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to create location'),
    async () => {
      const schoolId = await resolveSchoolId(sql, params.schoolId)
      const rows = await sql<Location[]>`
        INSERT INTO locations (school_id, name, latitude, longitude, radius_meters, is_active)
        VALUES (${schoolId}, ${params.name}, ${params.latitude}, ${params.longitude}, ${params.radiusMeters ?? 100.0}, ${params.isActive ?? true})
        RETURNING id, school_id, name, latitude, longitude, radius_meters, is_active, created_at::text, updated_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.internal('Failed to create location.')
      }
      return rows[0]
    },
  )
}

export async function updateLocation(
  sql: Sql,
  id: string,
  params: UpdateLocationParams,
): Promise<Location> {
  return withPgError(
    (err) => logger.error({ err, id, params }, 'Failed to update location'),
    async () => {
      const existing = await getLocationById(sql, id)
      if (!existing) throw AppError.notFound('Location')

      const rows = await sql<Location[]>`
        UPDATE locations
        SET
          name = COALESCE(${params.name ?? null}, name),
          latitude = COALESCE(${params.latitude ?? null}, latitude),
          longitude = COALESCE(${params.longitude ?? null}, longitude),
          radius_meters = COALESCE(${params.radiusMeters ?? null}, radius_meters),
          is_active = COALESCE(${params.isActive ?? null}, is_active),
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING id, school_id, name, latitude, longitude, radius_meters, is_active, created_at::text, updated_at::text
      `
      return rows[0]
    },
  )
}

export async function deleteLocation(sql: Sql, id: string): Promise<void> {
  return withPgError(
    (err) => logger.error({ err, id }, 'Failed to delete location'),
    async () => {
      const result = await sql`DELETE FROM locations WHERE id = ${id}`
      if (result.count === 0) throw AppError.notFound('Location')
    },
  )
}

export async function listCalendarExceptions(
  sql: Sql,
  filter?: CalendarExceptionFilter,
): Promise<CalendarException[]> {
  return withPgError(
    (err) => logger.error({ err, filter }, 'Failed to list calendar exceptions'),
    async () => {
      const rows = await sql<CalendarException[]>`
        SELECT id, school_id, academic_period_id, date::text, reason, is_holiday, created_at::text, updated_at::text
        FROM calendar_exceptions
        WHERE (${filter?.academicPeriodId ?? null}::uuid IS NULL OR academic_period_id = ${filter?.academicPeriodId ?? null}::uuid)
          AND (${filter?.startDate ?? null}::date IS NULL OR date >= ${filter?.startDate ?? null}::date)
          AND (${filter?.endDate ?? null}::date IS NULL OR date <= ${filter?.endDate ?? null}::date)
        ORDER BY date ASC
      `
      return rows ?? []
    },
  )
}

export async function getCalendarExceptionById(
  sql: PgQuery,
  id: string,
): Promise<CalendarException | null> {
  return withPgError(
    (err) => logger.error({ err, id }, 'Failed to get calendar exception by id'),
    async () => {
      const rows = await sql<CalendarException[]>`
        SELECT id, school_id, academic_period_id, date::text, reason, is_holiday, created_at::text, updated_at::text
        FROM calendar_exceptions
        WHERE id = ${id}
        LIMIT 1
      `
      return rows[0] ?? null
    },
  )
}

export async function getCalendarExceptionByDate(
  sql: Sql,
  date: string,
  academicPeriodId?: string,
): Promise<CalendarException | null> {
  return withPgError(
    (err) =>
      logger.error({ err, date, academicPeriodId }, 'Failed to get calendar exception by date'),
    async () => {
      const formattedDate = date.slice(0, 10)
      const rows = await sql<CalendarException[]>`
        SELECT id, school_id, academic_period_id, date::text, reason, is_holiday, created_at::text, updated_at::text
        FROM calendar_exceptions
        WHERE date = ${formattedDate}::date
          AND (${academicPeriodId ?? null}::uuid IS NULL OR academic_period_id IS NULL OR academic_period_id = ${academicPeriodId ?? null}::uuid)
        LIMIT 1
      `
      return rows[0] ?? null
    },
  )
}

export async function createCalendarException(
  sql: Sql,
  params: CreateCalendarExceptionParams,
): Promise<CalendarException> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to create calendar exception'),
    async () => {
      const schoolId = await resolveSchoolId(sql, params.schoolId)
      const formattedDate = params.date.slice(0, 10)
      const rows = await sql<CalendarException[]>`
        INSERT INTO calendar_exceptions (school_id, academic_period_id, date, reason, is_holiday)
        VALUES (${schoolId}, ${params.academicPeriodId ?? null}, ${formattedDate}::date, ${params.reason}, ${params.isHoliday ?? true})
        RETURNING id, school_id, academic_period_id, date::text, reason, is_holiday, created_at::text, updated_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.internal('Failed to create calendar exception.')
      }
      return rows[0]
    },
  )
}

export async function updateCalendarException(
  sql: Sql,
  id: string,
  params: UpdateCalendarExceptionParams,
): Promise<CalendarException> {
  return withPgError(
    (err) => logger.error({ err, id, params }, 'Failed to update calendar exception'),
    async () => {
      const existing = await getCalendarExceptionById(sql, id)
      if (!existing) throw AppError.notFound('Calendar exception')

      const formattedDate = params.date ? params.date.slice(0, 10) : null
      const rows = await sql<CalendarException[]>`
        UPDATE calendar_exceptions
        SET
          date = COALESCE(${formattedDate ? `${formattedDate}::date` : null}, date),
          reason = COALESCE(${params.reason ?? null}, reason),
          is_holiday = COALESCE(${params.isHoliday ?? null}, is_holiday),
          academic_period_id = COALESCE(${params.academicPeriodId ?? null}, academic_period_id),
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING id, school_id, academic_period_id, date::text, reason, is_holiday, created_at::text, updated_at::text
      `
      return rows[0]
    },
  )
}

export async function deleteCalendarException(sql: Sql, id: string): Promise<void> {
  return withPgError(
    (err) => logger.error({ err, id }, 'Failed to delete calendar exception'),
    async () => {
      const result = await sql`DELETE FROM calendar_exceptions WHERE id = ${id}`
      if (result.count === 0) throw AppError.notFound('Calendar exception')
    },
  )
}
