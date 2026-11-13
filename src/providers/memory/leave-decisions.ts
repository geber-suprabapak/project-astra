import { AppError } from '../../lib/errors/app-error.js'
import {
  toWibDate,
  type AuditLog,
  type AuditLogDetails,
  type ForceFinishLeaveRequestParams,
  type LeaveRequest,
  type Permit,
  type UpdateLeaveRequestStatusParams,
} from '../types.js'
import {
  addCalendarDays,
  effectiveLeavePeriod,
  isPhysicalAttendance,
  rollBackAuditLogs,
  rollBackNotifications,
  type MemoryDomainState,
} from './domain-state.js'
import { toLeaveRequest } from './leave-requests.js'

function validateLeaveApproval(
  store: MemoryDomainState,
  permit: Permit,
  params: UpdateLeaveRequestStatusParams,
): void {
  if (params.approvalStatus === 'approved') {
    if (permit.approval_status !== 'pending') {
      throw AppError.conflict('Leave request is no longer pending.')
    }
    const durationDays = params.durationDays ?? 1
    const start = toWibDate(permit.tanggal)
    const end = addCalendarDays(start, durationDays - 1)
    const overlapping = store.permits
      .filter((candidate) => {
        if (
          candidate.id === permit.id ||
          candidate.user_id !== permit.user_id ||
          candidate.approval_status !== 'approved'
        ) {
          return false
        }
        const period = effectiveLeavePeriod(candidate)
        return start <= period.end && end >= period.start
      })
      .sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.id.localeCompare(b.id))[0]
    if (overlapping) {
      const period = effectiveLeavePeriod(overlapping)
      throw AppError.leavePeriodOverlap({
        overlapping_request_id: overlapping.id,
        overlapping_start_date: period.start,
        overlapping_end_date: period.end,
        requested_start_date: start,
        requested_end_date: end,
      })
    }
    const conflictDates = new Set<string>()
    for (const attendance of store.attendancesList) {
      if (
        attendance.user_id === permit.user_id &&
        isPhysicalAttendance(attendance.status, attendance.action_type) &&
        attendance.date.slice(0, 10) >= start &&
        attendance.date.slice(0, 10) <= end
      ) {
        conflictDates.add(attendance.date.slice(0, 10))
      }
    }
    for (const absence of store.absences) {
      if (
        absence.user_id === permit.user_id &&
        isPhysicalAttendance(absence.status) &&
        (absence.date ?? absence.created_at).slice(0, 10) >= start &&
        (absence.date ?? absence.created_at).slice(0, 10) <= end
      ) {
        conflictDates.add((absence.date ?? absence.created_at).slice(0, 10))
      }
    }
    if (conflictDates.size > 0) {
      throw AppError.leaveApprovalConflict({
        conflicting_dates: [...conflictDates].sort(),
        requested_start_date: start,
        requested_end_date: end,
      })
    }
    return
  }

  if (permit.approval_status === 'approved') {
    throw AppError.conflict('Approved Leave Period cannot be edited or extended.')
  }
  if (params.approvalStatus === 'pending') {
    const pending = store.permits
      .filter(
        (candidate) =>
          candidate.id !== permit.id &&
          candidate.user_id === permit.user_id &&
          candidate.approval_status === 'pending',
      )
      .sort(
        (a, b) =>
          (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id),
      )[0]
    if (pending) {
      throw AppError.leaveRequestPending({
        pending_request_id: pending.id,
        requested_start_date: toWibDate(permit.tanggal),
      })
    }
  }
}

export async function updateMemoryLeaveRequestStatus(
  store: MemoryDomainState,
  params: UpdateLeaveRequestStatusParams,
): Promise<LeaveRequest> {
  const p = store.permits.find((item) => item.id === params.id)
  if (!p) {
    throw AppError.notFound('Leave request')
  }

  validateLeaveApproval(store, p, params)

  const startDate = toWibDate(p.tanggal)
  const durationDays = params.durationDays ?? 1
  const endDate =
    params.approvalStatus === 'approved' ? addCalendarDays(startDate, durationDays - 1) : undefined
  const rejectedAt =
    params.approvalStatus === 'rejected'
      ? (params.rejectedAt ?? new Date().toISOString())
      : params.approvalStatus === 'pending'
        ? (params.rejectedAt ?? null)
        : params.rejectedAt

  const previousPermit = { ...p }
  const existingAuditIds = new Set(store.auditLogs.map((item) => item.id))
  let auditWrite: Promise<AuditLog> | undefined
  const audit = params.audit
  if (audit) {
    const details: AuditLogDetails = {
      previous_status: p.approval_status,
      student_user_id: p.user_id,
      category: p.kategori_izin,
      date: startDate,
      actor_name: audit.actorName,
      actor_role: audit.actorRole,
    }
    if (params.approvalStatus === 'approved') {
      details['duration_days'] = durationDays
      details['requested_start_date'] = startDate
      details['original_end_date'] = endDate
      details['effective_end_date'] = endDate
    }
    if (params.approvalStatus === 'rejected') {
      details['rejection_reason'] = params.rejectionReason ?? null
    }
    auditWrite = store.insertAuditLog({
      actor_id: audit.actorId,
      action: audit.action,
      entity_type: 'leave_request',
      entity_id: params.id,
      details,
    })
  }

  p.approval_status = params.approvalStatus
  p.status = params.status !== undefined ? params.status : params.approvalStatus === 'approved'
  if (params.rejectionReason !== undefined) {
    p.rejection_reason = params.rejectionReason
  } else if (params.approvalStatus === 'pending') {
    p.rejection_reason = null
  }
  if (params.approvalStatus === 'rejected') {
    p.rejected_at = rejectedAt
  } else if (params.approvalStatus === 'pending') {
    p.rejected_at = rejectedAt
  } else if (params.rejectedAt !== undefined) {
    p.rejected_at = params.rejectedAt
  }
  p.updated_at = new Date().toISOString()

  if (params.approvalStatus === 'approved') {
    p.original_end_date = endDate
    p.effective_end_date = endDate
    p.duration_days = durationDays
  } else {
    p.original_end_date = undefined
    p.effective_end_date = undefined
    p.duration_days = undefined
  }

  if (audit && auditWrite) {
    try {
      await auditWrite
    } catch (err) {
      Object.assign(p, previousPermit)
      // SAFETY: an overridden insertAuditLog may persist rows before failing; a failed
      // decision write must leave neither the state change nor partial audit rows behind.
      // Every row newly persisted for this entity during the failed write is discarded.
      rollBackAuditLogs(
        store.auditLogs,
        existingAuditIds,
        audit.actorId,
        'leave_request',
        params.id,
      )
      throw err
    }
  }

  if (params.notification) {
    const existingNotifIds = new Set(store.notifications.keys())
    try {
      await store.enqueueNotification(params.notification)
    } catch (err) {
      Object.assign(p, previousPermit)
      if (audit) {
        rollBackAuditLogs(
          store.auditLogs,
          existingAuditIds,
          audit.actorId,
          'leave_request',
          params.id,
        )
      }
      rollBackNotifications(store.notifications, existingNotifIds)
      throw err
    }
  }

  return toLeaveRequest(store, p)
}

export async function forceFinishMemoryLeaveRequest(
  store: MemoryDomainState,
  params: ForceFinishLeaveRequestParams,
): Promise<LeaveRequest> {
  const permit = store.permits.find((item) => item.id === params.id)
  if (!permit) throw AppError.notFound('Leave request')
  if (permit.approval_status !== 'approved') {
    throw AppError.conflict('Only an approved Leave Period can be force-finished.')
  }

  const period = effectiveLeavePeriod(permit)
  const effectiveEndDate = params.effectiveEndDate.slice(0, 10)
  if (effectiveEndDate < period.start) {
    throw AppError.validationError('Effective end date cannot precede the Leave Period start.')
  }
  if (effectiveEndDate > period.end) {
    throw AppError.conflict('Force-finish cannot extend an approved Leave Period.')
  }

  const originalEndDate = permit.original_end_date ?? period.end
  const previousEffectiveEndDate = permit.effective_end_date ?? null
  await store.insertAuditLog({
    actor_id: params.actorId,
    action: 'force_finish_leave_request',
    entity_type: 'leave_request',
    entity_id: params.id,
    details: {
      student_user_id: permit.user_id,
      category: permit.kategori_izin,
      requested_start_date: period.start,
      original_end_date: originalEndDate,
      previous_effective_end_date: previousEffectiveEndDate,
      effective_end_date: effectiveEndDate,
      reason: params.reason,
      actor_name: params.actorName,
      actor_role: params.actorRole,
    },
  })
  permit.original_end_date = originalEndDate
  permit.effective_end_date = effectiveEndDate
  permit.updated_at = new Date().toISOString()
  return toLeaveRequest(store, permit)
}
