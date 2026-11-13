import { z } from 'zod'
import { toWibDate, type IdentityRole } from './common.js'
import type { EnqueueNotificationParams } from './files-notifications.js'

export interface Permit {
  id: string
  user_id: string
  kategori_izin: string
  deskripsi: string
  status: boolean
  link_foto: string | null
  tanggal: string
  approval_status: 'pending' | 'approved' | 'rejected'
  created_at?: string
  updated_at?: string
  rejection_reason?: string | null
  rejected_at?: string | null
  requested_start_date?: string
  original_end_date?: string | null
  effective_end_date?: string | null
  duration_days?: number | null
}

export const leaveRequestCategorySchema = z.enum(['sakit', 'pergi', 'dispensasi', 'lainnya'])
export type LeaveRequestCategory = z.infer<typeof leaveRequestCategorySchema>

export const leaveRequestApprovalStatusSchema = z.enum(['pending', 'approved', 'rejected'])
export type LeaveRequestApprovalStatus = z.infer<typeof leaveRequestApprovalStatusSchema>

export interface LeaveRequest {
  id: string
  user_id: string
  category: LeaveRequestCategory | string
  description: string
  status: boolean
  attachment_url: string | null
  date: string
  approval_status: LeaveRequestApprovalStatus
  rejection_reason?: string | null
  rejected_at?: string | null
  created_at?: string
  updated_at?: string
  student_name?: string | null
  student_nis?: string | null
  student_class?: string | null
  absence_number?: string | null
  requested_start_date?: string
  original_end_date?: string | null
  effective_end_date?: string | null
  duration_days?: number | null
}

export interface LeavePeriodFields {
  requested_start_date: string
  original_end_date: string | null
  effective_end_date: string | null
  duration_days: number | null
}

export function getLeavePeriodFields(request: {
  date: string
  approval_status: LeaveRequestApprovalStatus
  original_end_date?: string | null
  effective_end_date?: string | null
  duration_days?: number | null
}): LeavePeriodFields {
  const requestedStart = toWibDate(request.date)
  const originalEnd = request.original_end_date ? toWibDate(request.original_end_date) : null
  const effectiveEnd = request.effective_end_date ? toWibDate(request.effective_end_date) : null

  if (request.approval_status !== 'approved') {
    return {
      requested_start_date: requestedStart,
      original_end_date: originalEnd,
      effective_end_date: effectiveEnd,
      duration_days: request.duration_days ?? null,
    }
  }

  if (originalEnd || effectiveEnd) {
    const resolvedOriginalEnd = originalEnd ?? effectiveEnd
    const resolvedEffectiveEnd = effectiveEnd ?? resolvedOriginalEnd
    const duration =
      request.duration_days ??
      (resolvedOriginalEnd && resolvedOriginalEnd >= requestedStart
        ? Math.round(
            (Date.parse(`${resolvedOriginalEnd}T00:00:00Z`) -
              Date.parse(`${requestedStart}T00:00:00Z`)) /
              86_400_000,
          ) + 1
        : null)
    return {
      requested_start_date: requestedStart,
      original_end_date: resolvedOriginalEnd,
      effective_end_date: resolvedEffectiveEnd,
      duration_days: duration,
    }
  }

  // Legacy approved rows only contain `date`; read them as a one-day period.
  return {
    requested_start_date: requestedStart,
    original_end_date: requestedStart,
    effective_end_date: requestedStart,
    duration_days: 1,
  }
}

export interface ListLeaveRequestsFilter {
  userId?: string
  approvalStatus?: LeaveRequestApprovalStatus
  category?: string
  startDate?: string
  endDate?: string
  limit?: number
  offset?: number
}

export interface UpdateLeaveRequestStatusParams {
  id: string
  approvalStatus: LeaveRequestApprovalStatus
  status?: boolean
  rejectionReason?: string | null
  rejectedAt?: string | null
  durationDays?: number
  audit?: {
    actorId: string
    actorName?: string | null
    actorRole?: IdentityRole | null
    action: 'approve_leave_request' | 'reject_leave_request' | 'reopen_leave_request'
  }
  notification?: EnqueueNotificationParams
}

export interface ForceFinishLeaveRequestParams {
  id: string
  effectiveEndDate: string
  actorId: string
  actorName?: string | null
  actorRole?: IdentityRole | null
  reason: string
}

export interface CreateLeaveRequestData {
  user_id: string
  category: LeaveRequestCategory | string
  description: string
  date: string
  status?: boolean
  attachment_url?: string | null
  approval_status?: LeaveRequestApprovalStatus
}

export interface ActivePermitSummary {
  id: string
  approval_status: 'pending' | 'approved' | 'rejected'
  kategori_izin: string
}

export interface InsertPermitData {
  user_id: string
  kategori_izin: string
  deskripsi: string
  status: boolean
  link_foto: string | null
  tanggal: string
}
