import type { Sql } from 'postgres'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
import {
  normalizeAttendanceRecord,
  type Absence,
  type AttendanceActionType,
  type AttendanceAttempt,
  type AttendanceAttemptStatus,
  type AttendanceRecord,
  type InsertAttendanceData,
  type RecordAttendanceAttemptParams,
} from '../types.js'
import { withPgError } from './shared.js'

export interface AttendanceAttemptFilter {
  userId?: string
  status?: AttendanceAttemptStatus
  actionType?: AttendanceActionType
  limit?: number
}

export interface AttendanceListFilter {
  userId?: string
  date?: string
  startDate?: string
  endDate?: string
  status?: string
  actionType?: string
  limit?: number
  offset?: number
}

export async function getTodayAbsences(
  sql: Sql,
  userId: string,
  dateWIB: string,
): Promise<Absence[]> {
  return withPgError(
    (err) => logger.error({ err, userId, dateWIB }, 'Failed to query attendances'),
    async () => {
      const rows = await sql<Absence[]>`
        SELECT status, created_at, date, user_id
        FROM attendances
        WHERE user_id = ${userId} AND date = ${dateWIB}
        ORDER BY created_at ASC
      `
      return (rows ?? []).map((r) => ({
        ...r,
        status: r.status === 'Datang' ? 'Hadir' : r.status,
      }))
    },
  )
}

export async function insertAttendance(sql: Sql, data: InsertAttendanceData): Promise<Absence> {
  return withPgError(
    (err) => logger.error({ err, data }, 'Failed to insert attendance'),
    async () => {
      const createdAt = data.created_at ?? new Date().toISOString()
      const rows = await sql<Absence[]>`
        INSERT INTO attendances (user_id, date, status, created_at)
        VALUES (${data.user_id}, ${data.date}, ${data.status}, ${createdAt})
        RETURNING status, created_at, date, user_id
      `
      if (!rows || rows.length === 0) {
        logger.error({ data }, 'Failed to insert attendance record: empty return')
        throw AppError.internal('Failed to insert attendance record.')
      }
      return rows[0]
    },
  )
}

export async function recordAttendanceAttempt(
  sql: Sql,
  params: RecordAttendanceAttemptParams,
): Promise<AttendanceAttempt> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to record attendance attempt'),
    async () => {
      const rows = await sql<AttendanceAttempt[]>`
        INSERT INTO attendance_attempts (
          user_id, action_type, status, reason, quality_score, confidence, latitude, longitude, process_time_ms
        )
        VALUES (
          ${params.userId}, ${params.actionType}, ${params.status},
          ${params.reason ?? null}, ${params.qualityScore ?? null}, ${params.confidence ?? null},
          ${params.latitude ?? null}, ${params.longitude ?? null}, ${params.processTimeMs ?? null}
        )
        RETURNING id, user_id, action_type, status, reason, quality_score, confidence,
                  latitude, longitude, process_time_ms, created_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.internal('Failed to record attendance attempt.')
      }
      return rows[0]
    },
  )
}

export async function listAttendanceAttempts(
  sql: Sql,
  filter?: AttendanceAttemptFilter,
): Promise<AttendanceAttempt[]> {
  return withPgError(
    (err) => logger.error({ err, filter }, 'Failed to list attendance attempts'),
    async () => {
      const limit = Math.min(Math.max(filter?.limit ?? 50, 1), 100)
      const rows = await sql<AttendanceAttempt[]>`
        SELECT id, user_id, action_type, status, reason, quality_score, confidence,
               latitude, longitude, process_time_ms, created_at::text
        FROM attendance_attempts
        WHERE 1 = 1
          ${filter?.userId ? sql`AND user_id = ${filter.userId}` : sql``}
          ${filter?.status ? sql`AND status = ${filter.status}` : sql``}
          ${filter?.actionType ? sql`AND action_type = ${filter.actionType}` : sql``}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `
      return rows
    },
  )
}

export async function getAttendanceAttempt(
  sql: Sql,
  id: string,
): Promise<AttendanceAttempt | null> {
  return withPgError(
    (err) => logger.error({ err, id }, 'Failed to get attendance attempt'),
    async () => {
      const rows = await sql<AttendanceAttempt[]>`
        SELECT id, user_id, action_type, status, reason, quality_score, confidence,
               latitude, longitude, process_time_ms, created_at::text
        FROM attendance_attempts
        WHERE id = ${id}
        LIMIT 1
      `
      return rows[0] ?? null
    },
  )
}

export async function deleteAttendances(sql: Sql, ids: string[]): Promise<AttendanceRecord[]> {
  if (ids.length === 0) return []

  return withPgError(
    (err) => logger.error({ err, ids }, 'Failed to delete attendance records'),
    async () => {
      return await sql.begin(async (tx) => {
        const existing = await tx<AttendanceRecord[]>`
          SELECT id, user_id, date, status, action_type, latitude, longitude, created_at::text
          FROM attendances
          WHERE id IN ${tx(ids)}
          FOR UPDATE
        `

        if (existing.length !== ids.length) {
          throw AppError.notFound('Attendance')
        }

        const deleted = await tx<AttendanceRecord[]>`
          DELETE FROM attendances
          WHERE id IN ${tx(ids)}
          RETURNING id, user_id, date, status, action_type, latitude, longitude, created_at::text
        `
        const deletedById = new Map(deleted.map((record) => [record.id, record]))
        return ids
          .map((id) => deletedById.get(id)!)
          .filter(Boolean)
          .map((record) => normalizeAttendanceRecord(record))
      })
    },
  )
}

export async function listAttendances(
  sql: Sql,
  filter?: AttendanceListFilter,
): Promise<AttendanceRecord[]> {
  return withPgError(
    (err) => logger.error({ err, filter }, 'Failed to list attendances'),
    async () => {
      // The public admin route caps requests at 100 rows. Internal
      // server-authoritative collection routes may request a larger bounded
      // batch so clients do not need hundreds of rate-limited page calls.
      const limit = Math.min(Math.max(filter?.limit ?? 50, 1), 50_000)
      const offset = Math.max(filter?.offset ?? 0, 0)
      const rows = await sql<AttendanceRecord[]>`
        SELECT id, user_id, date, status, action_type, latitude, longitude, created_at::text
        FROM attendances
        WHERE 1 = 1
          ${filter?.userId ? sql`AND user_id = ${filter.userId}` : sql``}
          ${filter?.date ? sql`AND date = ${filter.date}` : sql``}
          ${filter?.startDate ? sql`AND date >= ${filter.startDate}` : sql``}
          ${filter?.endDate ? sql`AND date <= ${filter.endDate}` : sql``}
          ${
            filter?.status
              ? filter.status === 'Hadir'
                ? sql`AND status IN ('Hadir', 'Datang')`
                : sql`AND status = ${filter.status}`
              : sql``
          }
          ${
            filter?.actionType
              ? filter.actionType === 'check_in'
                ? sql`AND (action_type = 'check_in' OR (action_type IS NULL AND status IN ('Hadir', 'Terlambat', 'Datang')))`
                : sql`AND action_type = ${filter.actionType}`
              : sql``
          }
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `
      return (rows ?? []).map((r) => normalizeAttendanceRecord(r))
    },
  )
}

export async function getAttendance(sql: Sql, id: string): Promise<AttendanceRecord | null> {
  return withPgError(
    (err) => logger.error({ err, id }, 'Failed to get attendance'),
    async () => {
      const rows = await sql<AttendanceRecord[]>`
        SELECT id, user_id, date, status, action_type, latitude, longitude, created_at::text
        FROM attendances
        WHERE id = ${id}
        LIMIT 1
      `
      return rows[0] ? normalizeAttendanceRecord(rows[0]) : null
    },
  )
}
