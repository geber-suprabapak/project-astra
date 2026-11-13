import type { Sql } from 'postgres'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
import {
  getLeavePeriodFields,
  type AuditLogDetails,
  type ForceFinishLeaveRequestParams,
  type LeaveRequest,
  type UpdateLeaveRequestStatusParams,
} from '../types.js'
import { enrichLeaveRequest, withLeavePeriod } from './leave-requests.js'
import { insertNotificationOutboxRow } from './notifications-outbox.js'
import { insertAuditLogRow, withPgError } from './shared.js'

async function approveLeaveRequest(
  sql: Sql,
  params: UpdateLeaveRequestStatusParams,
): Promise<LeaveRequest> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to approve leave request'),
    async () => {
      const currentRows = await sql<{ user_id: string }[]>`
        SELECT user_id FROM leave_requests WHERE id = ${params.id} LIMIT 1
      `
      if (!currentRows[0]) throw AppError.notFound('Leave request')

      const updated = await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${currentRows[0].user_id}, 0))`
        const current = await tx<LeaveRequest[]>`
          SELECT id, user_id, category, description, status,
                 attachment_url, (date AT TIME ZONE 'Asia/Jakarta')::date::text AS date, approval_status,
                 original_end_date::text, effective_end_date::text, duration_days,
                 rejection_reason, rejected_at::text, created_at::text, updated_at::text
          FROM leave_requests
          WHERE id = ${params.id}
          FOR UPDATE
        `
        if (!current[0]) throw AppError.notFound('Leave request')
        if (current[0].approval_status !== 'pending') {
          throw AppError.conflict('Leave request is no longer pending.')
        }

        const durationDays = params.durationDays ?? 1
        const requestedStartDate = current[0].date.slice(0, 10)
        const requestedEndDate = new Date(
          Date.parse(`${requestedStartDate}T00:00:00Z`) + (durationDays - 1) * 86_400_000,
        )
          .toISOString()
          .slice(0, 10)
        const overlapping = await tx<{ id: string; start_date: string; end_date: string }[]>`
          SELECT id,
                 (date AT TIME ZONE 'Asia/Jakarta')::date::text AS start_date,
                 COALESCE(effective_end_date, original_end_date, (date AT TIME ZONE 'Asia/Jakarta')::date)::text AS end_date
          FROM leave_requests
          WHERE user_id = ${current[0].user_id}
            AND approval_status = 'approved'
            AND id <> ${params.id}
            AND (date AT TIME ZONE 'Asia/Jakarta')::date <= ${requestedEndDate}::date
            AND COALESCE(effective_end_date, original_end_date, (date AT TIME ZONE 'Asia/Jakarta')::date) >= ${requestedStartDate}::date
          ORDER BY start_date ASC, id ASC
          LIMIT 1
        `
        if (overlapping[0] && overlapping[0].id !== params.id) {
          throw AppError.leavePeriodOverlap({
            overlapping_request_id: overlapping[0].id,
            overlapping_start_date: overlapping[0].start_date,
            overlapping_end_date: overlapping[0].end_date,
            requested_start_date: requestedStartDate,
            requested_end_date: requestedEndDate,
          })
        }
        const conflicts = await tx<{ date: string }[]>`
          SELECT DISTINCT a.date::date::text AS date
          FROM attendances a
          WHERE a.user_id = ${current[0].user_id}
            AND a.status IN ('Hadir', 'Terlambat', 'Pulang', 'Datang')
            AND a.date::date BETWEEN ((${current[0].date})::timestamptz AT TIME ZONE 'Asia/Jakarta')::date
              AND (((${current[0].date})::timestamptz AT TIME ZONE 'Asia/Jakarta')::date + (${durationDays} - 1))
          ORDER BY date ASC
        `
        if (conflicts.length > 0) {
          throw AppError.leaveApprovalConflict({
            conflicting_dates: conflicts.map((row) => row.date),
            requested_start_date: requestedStartDate,
            requested_end_date: requestedEndDate,
          })
        }

        const rows = await tx<LeaveRequest[]>`
          UPDATE leave_requests
          SET approval_status = 'approved',
              status = ${params.status !== undefined ? params.status : true},
              original_end_date = (date AT TIME ZONE 'Asia/Jakarta')::date + (${durationDays} - 1),
              effective_end_date = (date AT TIME ZONE 'Asia/Jakarta')::date + (${durationDays} - 1),
              duration_days = ${durationDays},
              rejection_reason = NULL,
              rejected_at = NULL,
              updated_at = NOW()
          WHERE id = ${params.id}
          RETURNING id, user_id, category, description, status,
                    attachment_url, (date AT TIME ZONE 'Asia/Jakarta')::date::text AS date, approval_status,
                    original_end_date::text, effective_end_date::text, duration_days,
                    rejection_reason, rejected_at::text, created_at::text, updated_at::text
        `
        if (!rows[0]) throw AppError.notFound('Leave request')
        if (params.audit) {
          const period = getLeavePeriodFields({
            date: rows[0].date,
            approval_status: rows[0].approval_status,
            original_end_date: rows[0].original_end_date,
            effective_end_date: rows[0].effective_end_date,
            duration_days: rows[0].duration_days,
          })
          await insertAuditLogRow(tx, {
            actor_id: params.audit.actorId,
            action: params.audit.action,
            entity_type: 'leave_request',
            entity_id: params.id,
            details: {
              previous_status: current[0].approval_status,
              student_user_id: current[0].user_id,
              category: current[0].category,
              date: current[0].date.slice(0, 10),
              duration_days: durationDays,
              requested_start_date: period.requested_start_date,
              original_end_date: period.original_end_date,
              effective_end_date: period.effective_end_date,
            },
          })
        }
        if (params.notification) {
          await insertNotificationOutboxRow(tx, params.notification)
        }
        return rows[0]
      })

      return enrichLeaveRequest(sql, withLeavePeriod(updated))
    },
  )
}

export async function updateLeaveRequestStatus(
  sql: Sql,
  params: UpdateLeaveRequestStatusParams,
): Promise<LeaveRequest> {
  if (params.approvalStatus === 'approved') {
    return approveLeaveRequest(sql, params)
  }

  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to update leave request status'),
    async () => {
      const statusValue = params.status !== undefined ? params.status : false
      const updated = await sql.begin(async (tx) => {
        const current = await tx<LeaveRequest[]>`
          SELECT id, user_id, category, description, status,
                 attachment_url, (date AT TIME ZONE 'Asia/Jakarta')::date::text AS date, approval_status,
                 original_end_date::text, effective_end_date::text, duration_days,
                 rejection_reason, rejected_at::text, created_at::text, updated_at::text
          FROM leave_requests
          WHERE id = ${params.id}
          FOR UPDATE
        `
        if (!current[0]) throw AppError.notFound('Leave request')
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${current[0].user_id}, 0))`
        if (current[0].approval_status === 'approved') {
          throw AppError.conflict('Approved Leave Period cannot be edited or extended.')
        }
        if (params.approvalStatus === 'pending') {
          const pending = await tx<{ id: string }[]>`
            SELECT id
            FROM leave_requests
            WHERE user_id = ${current[0].user_id}
              AND approval_status = 'pending'
              AND id <> ${params.id}
            ORDER BY created_at ASC, id ASC
            LIMIT 1
          `
          if (pending[0]) {
            throw AppError.leaveRequestPending({
              pending_request_id: pending[0].id,
              requested_start_date: current[0].date.slice(0, 10),
            })
          }
        }

        const rows = await tx<LeaveRequest[]>`
          UPDATE leave_requests
          SET approval_status = ${params.approvalStatus},
              status = ${statusValue},
              original_end_date = NULL,
              effective_end_date = NULL,
              duration_days = NULL,
              rejection_reason = ${params.rejectionReason ?? null},
              rejected_at = ${params.rejectedAt ? params.rejectedAt : params.approvalStatus === 'rejected' ? tx`NOW()` : null},
              updated_at = NOW()
          WHERE id = ${params.id}
          RETURNING id, user_id, category, description, status,
                    attachment_url, (date AT TIME ZONE 'Asia/Jakarta')::date::text AS date, approval_status,
                    original_end_date::text, effective_end_date::text, duration_days,
                    rejection_reason, rejected_at::text, created_at::text, updated_at::text
        `
        if (!rows[0]) throw AppError.notFound('Leave request')

        if (params.audit) {
          const auditDetails: AuditLogDetails = {
            previous_status: current[0].approval_status,
            student_user_id: current[0].user_id,
            category: current[0].category,
            date: current[0].date.slice(0, 10),
            actor_name: params.audit.actorName,
            actor_role: params.audit.actorRole,
          }
          if (params.approvalStatus === 'rejected') {
            auditDetails['rejection_reason'] = params.rejectionReason ?? null
          }
          await insertAuditLogRow(tx, {
            actor_id: params.audit.actorId,
            action: params.audit.action,
            entity_type: 'leave_request',
            entity_id: params.id,
            details: auditDetails,
          })
        }
        if (params.notification) {
          await insertNotificationOutboxRow(tx, params.notification)
        }

        return rows[0]
      })
      return enrichLeaveRequest(sql, withLeavePeriod(updated))
    },
  )
}

export async function forceFinishLeaveRequest(
  sql: Sql,
  params: ForceFinishLeaveRequestParams,
): Promise<LeaveRequest> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to force-finish leave request'),
    async () => {
      const owner = await sql<{ user_id: string }[]>`
        SELECT user_id FROM leave_requests WHERE id = ${params.id} LIMIT 1
      `
      if (!owner[0]) throw AppError.notFound('Leave request')

      const updated = await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${owner[0].user_id}, 0))`
        const current = await tx<LeaveRequest[]>`
          SELECT id, user_id, category, description, status,
                 attachment_url, (date AT TIME ZONE 'Asia/Jakarta')::date::text AS date, approval_status,
                 original_end_date::text, effective_end_date::text, duration_days,
                 rejection_reason, rejected_at::text, created_at::text, updated_at::text
          FROM leave_requests
          WHERE id = ${params.id}
          FOR UPDATE
        `
        if (!current[0]) throw AppError.notFound('Leave request')
        if (current[0].approval_status !== 'approved') {
          throw AppError.conflict('Only an approved Leave Period can be force-finished.')
        }

        const start = current[0].date.slice(0, 10)
        const originalEnd = current[0].original_end_date?.slice(0, 10) ?? start
        const effectiveEnd = current[0].effective_end_date?.slice(0, 10) ?? originalEnd
        const target = params.effectiveEndDate.slice(0, 10)
        if (target < start) {
          throw AppError.validationError(
            'Effective end date cannot precede the Leave Period start.',
          )
        }
        if (target > effectiveEnd) {
          throw AppError.conflict('Force-finish cannot extend an approved Leave Period.')
        }

        const rows = await tx<LeaveRequest[]>`
          UPDATE leave_requests
          SET original_end_date = COALESCE(original_end_date, (date AT TIME ZONE 'Asia/Jakarta')::date),
              effective_end_date = (${target})::date,
              updated_at = NOW()
          WHERE id = ${params.id}
          RETURNING id, user_id, category, description, status,
                    attachment_url, (date AT TIME ZONE 'Asia/Jakarta')::date::text AS date, approval_status,
                    original_end_date::text, effective_end_date::text, duration_days,
                    rejection_reason, rejected_at::text, created_at::text, updated_at::text
        `
        if (!rows[0]) throw AppError.notFound('Leave request')
        await insertAuditLogRow(tx, {
          actor_id: params.actorId,
          action: 'force_finish_leave_request',
          entity_type: 'leave_request',
          entity_id: params.id,
          details: {
            student_user_id: current[0].user_id,
            category: current[0].category,
            requested_start_date: start,
            original_end_date: originalEnd,
            previous_effective_end_date: current[0].effective_end_date,
            effective_end_date: target,
            reason: params.reason,
            actor_name: params.actorName,
            actor_role: params.actorRole,
          },
        })
        return rows[0]
      })

      return enrichLeaveRequest(sql, withLeavePeriod(updated))
    },
  )
}
