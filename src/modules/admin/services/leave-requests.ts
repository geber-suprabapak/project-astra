import { AppError } from '../../../lib/errors/app-error.js'
import type {
  AppProviders,
  IdentityRole,
  LeaveRequest,
  LeaveRequestApprovalStatus,
  LeaveRequestCategory,
  ListLeaveRequestsFilter,
} from '../../../providers/types.js'
import {
  adminLeaveDecisionHistoryEventSchema,
  leaveDecisionHistoryActionSchema,
  type AdminLeaveDecisionHistoryEvent,
  type AdminLeaveRequestResponse,
} from '../schema.js'
import { assertAdminAccess, assertChronosStaffAccess } from './shared.js'

const CHRONOS_STAFF_ROLES: ReadonlySet<IdentityRole> = new Set([
  'platform_admin',
  'school_admin',
  'teacher',
  'staff',
])

async function mapLeaveRequestWithAttachment(
  lr: LeaveRequest,
  providers: AppProviders,
): Promise<AdminLeaveRequestResponse> {
  const attachmentUrl = lr.attachment_url
    ? await providers.objectStorage.getSignedPermitUrl(lr.attachment_url)
    : null

  return {
    id: lr.id,
    user_id: lr.user_id,
    student_name: lr.student_name ?? null,
    student_nis: lr.student_nis ?? null,
    student_class: lr.student_class ?? null,
    absence_number: lr.absence_number ?? null,
    // SAFETY: LeaveRequest category is constrained by leave_requests_category_check in database and leaveRequestCategorySchema
    category: lr.category as AdminLeaveRequestResponse['category'],
    description: lr.description,
    status: lr.status,
    date: lr.date,
    requested_start_date: lr.requested_start_date ?? lr.date.slice(0, 10),
    original_end_date: lr.original_end_date ?? null,
    effective_end_date: lr.effective_end_date ?? null,
    duration_days: lr.duration_days ?? null,
    approval_status: lr.approval_status,
    attachment_url: attachmentUrl,
    rejection_reason: lr.rejection_reason ?? null,
    rejected_at: lr.rejected_at ?? null,
    created_at: lr.created_at,
    updated_at: lr.updated_at,
  }
}

async function getLeaveDecisionActorSnapshot(params: {
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<{ actorName: string | null; actorRole: IdentityRole | null }> {
  try {
    const profile = await params.providers.domainStore.getUserProfile(params.actorId)
    return { actorName: profile.full_name, actorRole: profile.role ?? params.actorRole }
  } catch (error) {
    if (error instanceof AppError && error.code === 'RESOURCE_NOT_FOUND') {
      return { actorName: null, actorRole: params.actorRole }
    }
    throw error
  }
}

async function getModifiableLeaveRequest(
  providers: AppProviders,
  id: string,
): Promise<LeaveRequest> {
  const lr = await providers.domainStore.getLeaveRequestById(id)
  if (!lr) {
    throw AppError.notFound('Leave request')
  }
  if (lr.approval_status === 'approved') {
    throw AppError.conflict('Approved Leave Period cannot be edited or extended.')
  }
  return lr
}

export async function createAdminLeaveRequest(params: {
  userId: string
  category: LeaveRequestCategory | string
  description: string
  date: string
  fileId?: string | null
  approvalStatus?: LeaveRequestApprovalStatus
  actorRole: IdentityRole | null
  actorId: string
  providers: AppProviders
}): Promise<AdminLeaveRequestResponse> {
  const isChronosUser = params.actorRole !== null && CHRONOS_STAFF_ROLES.has(params.actorRole)
  if (!isChronosUser && (params.actorRole !== 'student' || params.userId !== params.actorId)) {
    throw AppError.forbidden('Cannot submit a leave request for this student.')
  }

  const targetProfile = await params.providers.domainStore.getUserProfile(params.userId)
  if (targetProfile.role !== 'student' || targetProfile.lifecycle_status !== 'approved') {
    throw AppError.forbidden('Leave requests require an approved student.')
  }

  let storagePath: string | null = null
  if (params.fileId) {
    const fileRecord = await params.providers.domainStore.getFileRecord(params.fileId)
    if (!fileRecord) {
      throw AppError.notFound('Attachment file')
    }
    if (fileRecord.user_id !== params.actorId) {
      throw AppError.forbidden('Cannot attach a file owned by another user.')
    }
    if (fileRecord.purpose !== 'permit_attachment') {
      throw AppError.validationError('File purpose must be permit_attachment.')
    }
    if (fileRecord.lifecycle === 'rejected' || fileRecord.lifecycle === 'deleted') {
      throw AppError.validationError('Attachment file is no longer available.')
    }
    if (fileRecord.lifecycle === 'pending_upload') {
      await params.providers.domainStore.updateFileLifecycle(fileRecord.id, 'available')
    }
    storagePath = fileRecord.object_path
  }

  const approvalStatus: LeaveRequestApprovalStatus = params.approvalStatus ?? 'pending'
  if (approvalStatus !== 'pending') {
    throw AppError.validationError(
      'Admin-created leave requests must start pending; use the approval or rejection endpoint for status transitions.',
    )
  }
  const status = false
  const dateValue = params.date.includes('T') ? params.date : `${params.date}T00:00:00+07:00`

  const created = await params.providers.domainStore.createLeaveRequest({
    user_id: params.userId,
    category: params.category,
    description: params.description,
    date: dateValue,
    status,
    attachment_url: storagePath,
    approval_status: approvalStatus,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'create_admin_leave_request',
    entity_type: 'leave_request',
    entity_id: created.id,
    details: {
      user_id: params.userId,
      category: params.category,
      date: params.date,
      approval_status: approvalStatus,
    },
  })

  return mapLeaveRequestWithAttachment(created, params.providers)
}

export async function listAdminLeaveRequests(params: {
  filter?: ListLeaveRequestsFilter
  actorRole: IdentityRole | null
  actorId: string
  providers: AppProviders
}): Promise<AdminLeaveRequestResponse[]> {
  assertChronosStaffAccess(params.actorRole)

  const items = await params.providers.domainStore.listLeaveRequests(params.filter)
  return Promise.all(items.map((lr) => mapLeaveRequestWithAttachment(lr, params.providers)))
}

export async function getAdminLeaveRequest(params: {
  id: string
  actorRole: IdentityRole | null
  actorId: string
  providers: AppProviders
}): Promise<AdminLeaveRequestResponse> {
  assertChronosStaffAccess(params.actorRole)

  const lr = await params.providers.domainStore.getLeaveRequestById(params.id)
  if (!lr) {
    throw AppError.notFound('Leave request')
  }

  return mapLeaveRequestWithAttachment(lr, params.providers)
}

export async function getAdminLeaveRequestHistory(params: {
  id: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<AdminLeaveDecisionHistoryEvent[]> {
  assertChronosStaffAccess(params.actorRole)

  const leaveRequest = await params.providers.domainStore.getLeaveRequestById(params.id)
  if (!leaveRequest) throw AppError.notFound('Leave request')

  const history = (
    await params.providers.domainStore.getAuditLogs('leave_request', params.id)
  ).flatMap((log) => {
    if (!leaveDecisionHistoryActionSchema.safeParse(log.action).success) return []
    const details = log.details ?? {}
    const event = adminLeaveDecisionHistoryEventSchema.safeParse({
      action: log.action,
      occurred_at: log.created_at,
      actor_name: details['actor_name'],
      actor_role: details['actor_role'],
    })
    return event.success ? [event.data] : []
  })

  return history.sort((left, right) => Date.parse(left.occurred_at) - Date.parse(right.occurred_at))
}

export async function approveLeaveRequest(params: {
  id: string
  durationDays?: number
  actorRole: IdentityRole | null
  actorId: string
  providers: AppProviders
}): Promise<AdminLeaveRequestResponse> {
  assertChronosStaffAccess(params.actorRole)

  const lr = await getModifiableLeaveRequest(params.providers, params.id)

  const durationDays = params.durationDays
  if (
    durationDays === undefined ||
    !Number.isInteger(durationDays) ||
    durationDays < 1 ||
    durationDays > 30
  ) {
    throw AppError.validationError({
      duration_days: ['Duration must be explicitly provided between 1 and 30 days.'],
    })
  }

  const actor = await getLeaveDecisionActorSnapshot(params)

  const updated = await params.providers.domainStore.updateLeaveRequestStatus({
    id: params.id,
    approvalStatus: 'approved',
    status: true,
    durationDays,
    audit: {
      actorId: params.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      action: 'approve_leave_request',
    },
    notification: {
      userId: lr.user_id,
      channel: 'push',
      eventKey: `leave_approved:${lr.id}`,
      payload: {
        title: 'Pengajuan Izin Disetujui',
        body: `Pengajuan izin Anda untuk tanggal ${lr.date} telah disetujui.`,
        category: lr.category,
        date: lr.date,
        leave_request_id: lr.id,
        type: 'leave_approved',
      },
    },
  })

  return mapLeaveRequestWithAttachment(updated, params.providers)
}

export async function forceFinishLeaveRequest(params: {
  id: string
  effectiveEndDate: string
  reason: string
  actorRole: IdentityRole | null
  actorId: string
  providers: AppProviders
}): Promise<AdminLeaveRequestResponse> {
  assertChronosStaffAccess(params.actorRole)

  const actor = await getLeaveDecisionActorSnapshot(params)

  const updated = await params.providers.domainStore.forceFinishLeaveRequest({
    id: params.id,
    effectiveEndDate: params.effectiveEndDate,
    actorId: params.actorId,
    actorName: actor.actorName,
    actorRole: actor.actorRole,
    reason: params.reason,
  })

  return mapLeaveRequestWithAttachment(updated, params.providers)
}

export async function rejectLeaveRequest(params: {
  id: string
  reason?: string | null
  actorRole: IdentityRole | null
  actorId: string
  providers: AppProviders
}): Promise<AdminLeaveRequestResponse> {
  assertChronosStaffAccess(params.actorRole)

  const lr = await getModifiableLeaveRequest(params.providers, params.id)
  const actor = await getLeaveDecisionActorSnapshot(params)

  const updated = await params.providers.domainStore.updateLeaveRequestStatus({
    id: params.id,
    approvalStatus: 'rejected',
    status: false,
    rejectionReason: params.reason ?? null,
    rejectedAt: new Date().toISOString(),
    audit: {
      actorId: params.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      action: 'reject_leave_request',
    },
    notification: {
      userId: lr.user_id,
      channel: 'push',
      eventKey: `leave_rejected:${lr.id}`,
      payload: {
        title: 'Pengajuan Izin Ditolak',
        body: `Pengajuan izin Anda untuk tanggal ${lr.date} ditolak.${params.reason ? ` Alasan: ${params.reason}` : ''}`,
        category: lr.category,
        date: lr.date,
        leave_request_id: lr.id,
        rejection_reason: params.reason ?? null,
        type: 'leave_rejected',
      },
    },
  })

  return mapLeaveRequestWithAttachment(updated, params.providers)
}

export async function reopenLeaveRequest(params: {
  id: string
  actorRole: IdentityRole | null
  actorId: string
  providers: AppProviders
}): Promise<AdminLeaveRequestResponse> {
  assertChronosStaffAccess(params.actorRole)

  const lr = await getModifiableLeaveRequest(params.providers, params.id)
  const actor = await getLeaveDecisionActorSnapshot(params)

  const updated = await params.providers.domainStore.updateLeaveRequestStatus({
    id: params.id,
    approvalStatus: 'pending',
    status: false,
    rejectionReason: null,
    rejectedAt: null,
    audit: {
      actorId: params.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      action: 'reopen_leave_request',
    },
    notification: {
      userId: lr.user_id,
      channel: 'push',
      eventKey: `leave_reopened:${lr.id}`,
      payload: {
        title: 'Pengajuan Izin Dibuka Kembali',
        body: `Pengajuan izin Anda untuk tanggal ${lr.date} telah dibuka kembali untuk ditinjau ulang.`,
        category: lr.category,
        date: lr.date,
        leave_request_id: lr.id,
        type: 'leave_reopened',
      },
    },
  })

  return mapLeaveRequestWithAttachment(updated, params.providers)
}

export async function deleteAdminLeaveRequest(params: {
  id: string
  actorRole: IdentityRole | null
  actorId: string
  providers: AppProviders
}): Promise<void> {
  assertAdminAccess(params.actorRole)

  const lr = await params.providers.domainStore.getLeaveRequestById(params.id)
  if (!lr) {
    throw AppError.notFound('Leave request')
  }

  if (lr.attachment_url) {
    const files = await params.providers.domainStore.listFiles({
      userId: lr.user_id,
      purpose: 'permit_attachment',
    })
    const matchedFile = files.find((f) => f.object_path === lr.attachment_url)
    if (matchedFile) {
      await params.providers.domainStore.updateFileLifecycle(matchedFile.id, 'deleted')
    }
    if (params.providers.objectStorage.deletePermitAttachment) {
      await params.providers.objectStorage.deletePermitAttachment(lr.attachment_url)
    }
  }

  await params.providers.domainStore.deleteLeaveRequest(params.id)

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'delete_leave_request',
    entity_type: 'leave_request',
    entity_id: params.id,
    details: {
      student_user_id: lr.user_id,
      category: lr.category,
      date: lr.date,
    },
  })
}
