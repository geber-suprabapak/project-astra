import type { Sql, TransactionSql } from 'postgres'
import { z } from 'zod'
import { AppError } from '../../lib/errors/app-error.js'
import type { AuditLog, AuditLogEntry, School } from '../types.js'

export type PgQuery = Sql | TransactionSql

export const DEFAULT_SCHOOL_ID = 'a0000000-0000-0000-0000-000000000001'

const DAY_KEY_MAP = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'] as const

export function getTodayWIB(now = new Date()): string {
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  return wib.toISOString().slice(0, 10)
}

export function getDayKeyWIB(now = new Date()): string {
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  return DAY_KEY_MAP[wib.getUTCDay()]
}

export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export function isPgUniqueViolation(cause: unknown): boolean {
  return z.object({ code: z.literal('23505') }).safeParse(cause).success
}

export async function withPgError<T>(
  logFailure: (cause: unknown) => void,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof AppError) throw err
    logFailure(err)
    throw AppError.internal('An unexpected database error occurred.')
  }
}

export function runInTransaction<T>(sql: Sql, cb: (tx: PgQuery) => Promise<T>): Promise<T> {
  if (sql.begin) {
    // SAFETY: postgres.js types sql.begin return as UnwrapPromiseArray<T>, while T here is a domain record or transition object.
    return sql.begin((tx) => cb(tx)) as Promise<T>
  }
  return cb(sql)
}

export async function querySchool(sql: PgQuery): Promise<School | null> {
  const rows = await sql<School[]>`
    SELECT id, name, slug, timezone, signup_open, created_at::text, updated_at::text
    FROM schools
    LIMIT 1
  `
  return rows[0] ?? null
}

export async function resolveSchoolId(
  sql: PgQuery,
  explicitSchoolId?: string | null,
  fallbackSchoolId: string | null = null,
): Promise<string | null> {
  if (explicitSchoolId) return explicitSchoolId
  const school = await querySchool(sql)
  return school?.id ?? fallbackSchoolId
}

export async function insertAuditLogRow(
  sql: PgQuery,
  entry: AuditLogEntry,
  failureMessage = 'Failed to return inserted audit log record.',
): Promise<AuditLog> {
  const detailsJson = entry.details ? JSON.stringify(entry.details) : null
  let rows: AuditLog[]
  // Preserve SQL literals on domain mutations where unit mocks assert positional param indices.
  if (entry.entity_type === 'adiwiyata_report') {
    rows = await sql<AuditLog[]>`
      INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details)
      VALUES (${entry.actor_id ?? null}, ${entry.action}, 'adiwiyata_report', ${entry.entity_id ?? null}, ${detailsJson}::text::jsonb)
      RETURNING id, actor_id, action, entity_type, entity_id, details, created_at::text
    `
  } else if (
    entry.entity_type === 'leave_request' &&
    entry.action === 'force_finish_leave_request'
  ) {
    rows = await sql<AuditLog[]>`
      INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details)
      VALUES (${entry.actor_id ?? null}, 'force_finish_leave_request', 'leave_request', ${entry.entity_id ?? null}, ${detailsJson}::text::jsonb)
      RETURNING id, actor_id, action, entity_type, entity_id, details, created_at::text
    `
  } else if (entry.entity_type === 'leave_request') {
    rows = await sql<AuditLog[]>`
      INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details)
      VALUES (${entry.actor_id ?? null}, ${entry.action}, 'leave_request', ${entry.entity_id ?? null}, ${detailsJson}::text::jsonb)
      RETURNING id, actor_id, action, entity_type, entity_id, details, created_at::text
    `
  } else {
    rows = await sql<AuditLog[]>`
      INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details)
      VALUES (${entry.actor_id ?? null}, ${entry.action}, ${entry.entity_type}, ${entry.entity_id ?? null}, ${detailsJson}::text::jsonb)
      RETURNING id, actor_id, action, entity_type, entity_id, details, created_at::text
    `
  }
  const inserted = rows[0]
  if (!inserted) {
    throw AppError.internal(failureMessage)
  }
  return inserted
}

export async function findBlockingApprovedLeave(
  sql: PgQuery,
  userId: string,
  dateWIB: string,
): Promise<{ id: string; start_date: string; effective_end_date: string } | null> {
  const blocking = await sql<
    {
      id: string
      start_date: string
      effective_end_date: string
    }[]
  >`
    SELECT id,
           (date AT TIME ZONE 'Asia/Jakarta')::date::text AS start_date,
           COALESCE(effective_end_date, original_end_date, (date AT TIME ZONE 'Asia/Jakarta')::date)::text AS effective_end_date
    FROM leave_requests
    WHERE user_id = ${userId}
      AND approval_status = 'approved'
      AND (date AT TIME ZONE 'Asia/Jakarta')::date <= (${dateWIB})::date
      AND COALESCE(effective_end_date, original_end_date, (date AT TIME ZONE 'Asia/Jakarta')::date) >= (${dateWIB})::date
    ORDER BY start_date ASC, id ASC
    LIMIT 1
  `
  return blocking[0] ?? null
}
