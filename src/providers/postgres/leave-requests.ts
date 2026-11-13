import type { Sql } from 'postgres'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
import {
  getLeavePeriodFields,
  type ActivePermitSummary,
  type CreateLeaveRequestData,
  type InsertPermitData,
  type LeaveRequest,
  type ListLeaveRequestsFilter,
  type Permit,
} from '../types.js'
import { withPgError } from './shared.js'

export function withLeavePeriod(row: LeaveRequest): LeaveRequest {
  return {
    ...row,
    ...getLeavePeriodFields({
      date: row.date,
      approval_status: row.approval_status,
      original_end_date: row.original_end_date,
      effective_end_date: row.effective_end_date,
      duration_days: row.duration_days,
    }),
  }
}

export async function enrichLeaveRequest(sql: Sql, row: LeaveRequest): Promise<LeaveRequest> {
  // Profile enrichment remains best effort after the write has committed.
  const profile = await getLeaveRequestById(sql, row.id).catch(() => null)
  if (!profile) return row
  return {
    ...row,
    student_name: profile.student_name ?? null,
    student_nis: profile.student_nis ?? null,
    student_class: profile.student_class ?? null,
    absence_number: profile.absence_number ?? null,
  }
}

export async function getActivePermitsToday(
  sql: Sql,
  userId: string,
  startISO: string,
  endISO: string,
): Promise<ActivePermitSummary[]> {
  return withPgError(
    (err) => logger.error({ err, userId, startISO, endISO }, 'Failed to query permits'),
    async () => {
      const rows = await sql<ActivePermitSummary[]>`
        SELECT id, approval_status, category AS kategori_izin
        FROM leave_requests
        WHERE user_id = ${userId}
          AND approval_status = 'approved'
          AND (date AT TIME ZONE 'Asia/Jakarta')::date <= (${endISO.slice(0, 10)})::date
          AND COALESCE(effective_end_date, original_end_date, (date AT TIME ZONE 'Asia/Jakarta')::date) >= (${startISO.slice(0, 10)})::date
      `
      return rows ?? []
    },
  )
}

export async function getPermitHistory(sql: Sql, userId: string): Promise<Permit[]> {
  return withPgError(
    (err) => logger.error({ err, userId }, 'Failed to query permit history'),
    async () => {
      const rows = await sql<Permit[]>`
        SELECT id, user_id, category AS kategori_izin, description AS deskripsi,
               status, attachment_url AS link_foto, (date AT TIME ZONE 'Asia/Jakarta')::date::text AS tanggal,
               approval_status, original_end_date::text, effective_end_date::text,
               duration_days, created_at::text, rejection_reason, rejected_at::text
        FROM leave_requests
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
      `
      return (rows ?? []).map((row) => ({
        ...row,
        ...getLeavePeriodFields({
          date: row.tanggal,
          approval_status: row.approval_status,
          original_end_date: row.original_end_date,
          effective_end_date: row.effective_end_date,
          duration_days: row.duration_days,
        }),
      }))
    },
  )
}

export async function insertPermit(sql: Sql, data: InsertPermitData): Promise<Permit> {
  const created = await createLeaveRequest(sql, {
    user_id: data.user_id,
    category: data.kategori_izin,
    description: data.deskripsi,
    status: data.status,
    attachment_url: data.link_foto,
    date: data.tanggal,
    approval_status: 'pending',
  })
  return {
    id: created.id,
    user_id: created.user_id,
    kategori_izin: created.category,
    deskripsi: created.description,
    status: created.status,
    link_foto: created.attachment_url,
    tanggal: created.date,
    approval_status: created.approval_status,
    created_at: created.created_at,
    updated_at: created.updated_at,
    rejection_reason: created.rejection_reason,
    rejected_at: created.rejected_at,
    requested_start_date: created.requested_start_date,
    original_end_date: created.original_end_date,
    effective_end_date: created.effective_end_date,
    duration_days: created.duration_days,
  }
}

export async function createLeaveRequest(
  sql: Sql,
  data: CreateLeaveRequestData,
): Promise<LeaveRequest> {
  return withPgError(
    (err) => logger.error({ err, data }, 'Failed to insert leave request'),
    async () => {
      const approvalStatus = data.approval_status ?? 'approved'
      const status = data.status !== undefined ? data.status : approvalStatus === 'approved'
      const periodFields = getLeavePeriodFields({
        date: data.date,
        approval_status: approvalStatus,
      })
      const dateOnly = data.date.slice(0, 10)
      const created = await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${data.user_id}, 0))`
        const pending = await tx<{ id: string }[]>`
          SELECT id
          FROM leave_requests
          WHERE user_id = ${data.user_id} AND approval_status = 'pending'
          ORDER BY created_at ASC, id ASC
          LIMIT 1
        `
        if (pending[0]) {
          throw AppError.leaveRequestPending({
            pending_request_id: pending[0].id,
            requested_start_date: dateOnly,
          })
        }

        const overlapping = await tx<{ id: string; start_date: string; end_date: string }[]>`
          SELECT id,
                 (date AT TIME ZONE 'Asia/Jakarta')::date::text AS start_date,
                 COALESCE(effective_end_date, original_end_date, (date AT TIME ZONE 'Asia/Jakarta')::date)::text AS end_date
          FROM leave_requests
          WHERE user_id = ${data.user_id}
            AND approval_status = 'approved'
            AND (date AT TIME ZONE 'Asia/Jakarta')::date <= ${dateOnly}::date
            AND COALESCE(effective_end_date, original_end_date, (date AT TIME ZONE 'Asia/Jakarta')::date) >= ${dateOnly}::date
          ORDER BY start_date ASC, id ASC
          LIMIT 1
        `
        if (overlapping[0]) {
          throw AppError.leavePeriodOverlap({
            overlapping_request_id: overlapping[0].id,
            overlapping_start_date: overlapping[0].start_date,
            overlapping_end_date: overlapping[0].end_date,
            requested_start_date: dateOnly,
          })
        }

        const rows = await tx<LeaveRequest[]>`
          INSERT INTO leave_requests (user_id, category, description, status, attachment_url, date, approval_status, original_end_date, effective_end_date, duration_days)
          VALUES (${data.user_id}, ${data.category}, ${data.description}, ${status}, ${data.attachment_url ?? null}, ${data.date}, ${approvalStatus}, ${periodFields.original_end_date}, ${periodFields.effective_end_date}, ${periodFields.duration_days})
          RETURNING id, user_id, category, description, status,
                     attachment_url, (date AT TIME ZONE 'Asia/Jakarta')::date::text AS date, approval_status,
                     original_end_date::text, effective_end_date::text, duration_days,
                     rejection_reason, rejected_at::text, created_at::text, updated_at::text
        `
        return rows[0]
      })
      if (!created) {
        logger.error({ data }, 'Failed to insert leave request: empty return')
        throw AppError.internal('Failed to create leave request.')
      }
      return enrichLeaveRequest(sql, withLeavePeriod(created))
    },
  )
}

async function readLeaveRequests(
  sql: Sql,
  filter?: ListLeaveRequestsFilter,
  id?: string,
): Promise<LeaveRequest[]> {
  return withPgError(
    (err) => logger.error({ err, filter, id }, 'Failed to list leave requests'),
    async () => {
      const rows = await sql<LeaveRequest[]>`
        SELECT lr.id, lr.user_id, lr.category, lr.description, lr.status,
               lr.attachment_url, (lr.date AT TIME ZONE 'Asia/Jakarta')::date::text AS date, lr.approval_status,
               lr.original_end_date::text, lr.effective_end_date::text, lr.duration_days,
               lr.rejection_reason, lr.rejected_at::text, lr.created_at::text, lr.updated_at::text,
               CASE WHEN canonical.student_id IS NOT NULL THEN canonical.full_name ELSE p.full_name END AS student_name,
               p.nis AS student_nis,
               CASE WHEN canonical.student_id IS NOT NULL THEN canonical.class_name ELSE p.class_name END AS student_class,
               CASE WHEN canonical.student_id IS NOT NULL THEN canonical.absence_number ELSE p.absence_number END AS absence_number
        FROM leave_requests lr
        LEFT JOIN profiles p ON lr.user_id = p.user_id
        LEFT JOIN LATERAL (
          SELECT s.id AS student_id, s.full_name, c.name AS class_name, ce.absence_number
          FROM student_bindings sb
          JOIN students s ON s.id = sb.student_id
          LEFT JOIN LATERAL (
            SELECT e.class_id, e.absence_number
            FROM class_enrollments e
            WHERE e.student_id = s.id AND e.status = 'active'
            ORDER BY e.created_at DESC NULLS LAST
            LIMIT 1
          ) ce ON true
          LEFT JOIN classes c ON c.id = ce.class_id
          WHERE sb.user_id = lr.user_id AND p.role = 'student' AND s.nis = p.nis AND p.nis <> ''
        ) canonical ON true
        WHERE 1=1
          ${id !== undefined ? sql`AND lr.id = ${id}` : sql``}
          ${filter?.userId ? sql`AND lr.user_id = ${filter.userId}` : sql``}
          ${filter?.approvalStatus ? sql`AND lr.approval_status = ${filter.approvalStatus}` : sql``}
          ${filter?.category ? sql`AND lr.category = ${filter.category}` : sql``}
          ${
            filter?.endDate
              ? sql`AND (lr.date AT TIME ZONE 'Asia/Jakarta')::date <= ${filter.endDate}::date`
              : sql``
          }
          ${
            filter?.startDate
              ? sql`AND COALESCE(lr.effective_end_date, lr.original_end_date, (lr.date AT TIME ZONE 'Asia/Jakarta')::date) >= ${filter.startDate}::date`
              : sql``
          }
        ORDER BY lr.created_at DESC
        ${filter?.limit ? sql`LIMIT ${filter.limit}` : sql``}
        ${filter?.offset ? sql`OFFSET ${filter.offset}` : sql``}
      `
      return (rows ?? []).map(withLeavePeriod)
    },
  )
}

export async function getLeaveRequestById(sql: Sql, id: string): Promise<LeaveRequest | null> {
  if (!id) throw AppError.validationError('Leave request ID is required.')
  const rows = await readLeaveRequests(sql, { limit: 1 }, id)
  return rows[0] ?? null
}

export async function listLeaveRequests(
  sql: Sql,
  filter?: ListLeaveRequestsFilter,
): Promise<LeaveRequest[]> {
  return readLeaveRequests(sql, filter)
}

export async function deleteLeaveRequest(sql: Sql, id: string): Promise<void> {
  return withPgError(
    (err) => logger.error({ err, id }, 'Failed to delete leave request'),
    async () => {
      await sql`
        DELETE FROM leave_requests
        WHERE id = ${id}
      `
    },
  )
}
