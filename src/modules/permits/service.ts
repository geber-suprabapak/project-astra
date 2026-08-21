import { defaultProviders } from '../../providers/index.js'
import type { AppProviders, LeaveRequest, Permit } from '../../providers/types.js'
import type { PermitCategory } from './schema.js'
import { AppError } from '../../lib/errors/app-error.js'

export interface PermitResponse {
  id: string
  category: string
  description: string
  date: string
  approval_status: string
  attachment_url: string | null
  created_at: string | undefined
  updated_at?: string | undefined
  rejection_reason: string | null | undefined
  rejected_at: string | null | undefined
}

export type LeaveRequestResponse = PermitResponse

function toPermitResponse(
  permit: Permit | LeaveRequest,
  attachmentUrl: string | null,
): PermitResponse {
  const category = 'kategori_izin' in permit ? permit.kategori_izin : permit.category
  const description = 'deskripsi' in permit ? permit.deskripsi : permit.description
  const date = 'tanggal' in permit ? permit.tanggal : permit.date
  return {
    id: permit.id,
    category,
    description,
    date,
    approval_status: permit.approval_status,
    attachment_url: attachmentUrl,
    created_at: permit.created_at,
    updated_at: permit.updated_at ?? permit.created_at,
    rejection_reason: permit.rejection_reason,
    rejected_at: permit.rejected_at,
  }
}

async function assertApprovedStudent(userId: string, providers: AppProviders): Promise<void> {
  const profile = await providers.domainStore.getUserProfile(userId)
  if (profile.lifecycle_status !== 'approved') {
    throw AppError.forbidden('Only approved students can access leave requests.')
  }
  if (profile.role !== 'student') {
    throw AppError.forbidden('Only students can access mobile leave requests.')
  }
}

export async function listPermits(
  userId: string,
  providers: AppProviders = defaultProviders,
): Promise<PermitResponse[]> {
  await assertApprovedStudent(userId, providers)
  const permits = await providers.domainStore.getPermitHistory(userId)

  return Promise.all(
    permits.map(async (p) => {
      const url = p.link_foto ? await providers.objectStorage.getSignedPermitUrl(p.link_foto) : null
      return toPermitResponse(p, url)
    }),
  )
}

export async function getPermit(
  userId: string,
  permitId: string,
  providers: AppProviders = defaultProviders,
): Promise<PermitResponse> {
  await assertApprovedStudent(userId, providers)
  const leaveRequest = await providers.domainStore.getLeaveRequestById(permitId)
  if (!leaveRequest) {
    throw AppError.notFound('Leave request')
  }

  if (leaveRequest.user_id !== userId) {
    throw AppError.forbidden('Cannot view leave request owned by another student.')
  }

  const attachmentUrl = leaveRequest.attachment_url
    ? await providers.objectStorage.getSignedPermitUrl(leaveRequest.attachment_url)
    : null

  return toPermitResponse(leaveRequest, attachmentUrl)
}

export async function createPermit(params: {
  userId: string
  category: PermitCategory | string
  description: string
  date: string
  fileId?: string | null
  attachment?: { buffer: Buffer; contentType: string } | null
  providers?: AppProviders
}): Promise<PermitResponse> {
  const providers = params.providers ?? defaultProviders
  await assertApprovedStudent(params.userId, providers)

  let storagePath: string | null = null

  if (params.fileId) {
    const fileRecord = await providers.domainStore.getFileRecord(params.fileId)
    if (!fileRecord) {
      throw AppError.notFound('Attachment file')
    }
    if (fileRecord.user_id !== params.userId) {
      throw AppError.forbidden('Cannot attach a file owned by another user.')
    }
    if (fileRecord.purpose !== 'permit_attachment') {
      throw AppError.validationError('File purpose must be permit_attachment.')
    }
    if (fileRecord.lifecycle === 'rejected' || fileRecord.lifecycle === 'deleted') {
      throw AppError.validationError('Attachment file is no longer available.')
    }
    if (fileRecord.lifecycle === 'pending_upload') {
      await providers.domainStore.updateFileLifecycle(fileRecord.id, 'available')
    }
    storagePath = fileRecord.object_path
  } else if (params.attachment) {
    storagePath = await providers.objectStorage.uploadPermitAttachment(
      params.userId,
      params.attachment.buffer,
      params.attachment.contentType,
    )
    await providers.domainStore.createFileRecord({
      userId: params.userId,
      purpose: 'permit_attachment',
      objectPath: storagePath,
      contentType: params.attachment.contentType,
      sizeBytes: params.attachment.buffer.length,
      lifecycle: 'available',
    })
  }

  const permit = await providers.domainStore.insertPermit({
    user_id: params.userId,
    kategori_izin: params.category,
    deskripsi: params.description,
    status: false,
    link_foto: storagePath,
    tanggal: `${params.date}T00:00:00+07:00`,
  })

  const attachmentUrl = storagePath
    ? await providers.objectStorage.getSignedPermitUrl(storagePath)
    : null
  return toPermitResponse(permit, attachmentUrl)
}

export async function deletePermit(
  userId: string,
  permitId: string,
  providers: AppProviders = defaultProviders,
): Promise<void> {
  await assertApprovedStudent(userId, providers)
  const leaveRequest = await providers.domainStore.getLeaveRequestById(permitId)
  if (!leaveRequest) {
    throw AppError.notFound('Leave request')
  }

  if (leaveRequest.user_id !== userId) {
    throw AppError.forbidden('Cannot delete leave request owned by another student.')
  }

  if (leaveRequest.approval_status !== 'pending') {
    throw AppError.conflict('Cannot delete a leave request that has already been processed.')
  }

  if (leaveRequest.attachment_url) {
    const files = await providers.domainStore.listFiles({
      userId,
      purpose: 'permit_attachment',
    })
    const matchedFile = files.find((f) => f.object_path === leaveRequest.attachment_url)
    if (matchedFile) {
      await providers.domainStore.updateFileLifecycle(matchedFile.id, 'deleted')
    }
    if (providers.objectStorage.deletePermitAttachment) {
      await providers.objectStorage.deletePermitAttachment(leaveRequest.attachment_url)
    }
  }

  await providers.domainStore.deleteLeaveRequest(permitId)
}
