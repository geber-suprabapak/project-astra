import { defaultProviders } from '../../providers/index.js'
import type { AppProviders, FilePurpose, FileRecord } from '../../providers/types.js'
import { AppError } from '../../lib/errors/app-error.js'
import {
  ALLOWED_AVATAR_MIME,
  ALLOWED_PERMIT_MIME,
  ALLOWED_FACE_MIME,
  MAX_AVATAR_UPLOAD_SIZE,
  MAX_PERMIT_UPLOAD_SIZE,
  MAX_FACE_UPLOAD_SIZE,
} from './schema.js'

export interface UploadIntentResult {
  file_id: string
  upload_url: string
  object_path: string
  purpose: FilePurpose
  expires_in_seconds: number
}

function validateFileConstraints(purpose: FilePurpose, contentType: string, sizeBytes?: number) {
  if (purpose === 'avatar') {
    if (!ALLOWED_AVATAR_MIME.includes(contentType)) {
      throw AppError.validationError(
        `Invalid avatar content type. Allowed: ${ALLOWED_AVATAR_MIME.join(', ')}.`,
      )
    }
    if (sizeBytes && sizeBytes > MAX_AVATAR_UPLOAD_SIZE) {
      throw AppError.validationError('Avatar exceeds 5MB size limit.')
    }
  } else if (purpose === 'permit_attachment') {
    if (!ALLOWED_PERMIT_MIME.includes(contentType)) {
      throw AppError.validationError(
        `Invalid permit attachment content type. Allowed: ${ALLOWED_PERMIT_MIME.join(', ')}.`,
      )
    }
    if (sizeBytes && sizeBytes > MAX_PERMIT_UPLOAD_SIZE) {
      throw AppError.validationError('Permit attachment exceeds 5MB size limit.')
    }
  } else if (purpose === 'face_enrollment') {
    if (!ALLOWED_FACE_MIME.includes(contentType)) {
      throw AppError.validationError(
        `Invalid face enrollment content type. Allowed: ${ALLOWED_FACE_MIME.join(', ')}.`,
      )
    }
    if (sizeBytes && sizeBytes > MAX_FACE_UPLOAD_SIZE) {
      throw AppError.validationError('Face enrollment file exceeds 2MB size limit.')
    }
  }
}

function extFromMime(contentType: string): string {
  if (contentType === 'image/png') return 'png'
  if (contentType === 'image/webp') return 'webp'
  if (contentType === 'application/pdf') return 'pdf'
  return 'jpg'
}

export async function createUploadIntent(params: {
  userId: string
  purpose: FilePurpose
  contentType: string
  sizeBytes?: number
  filename?: string
  providers?: AppProviders
}): Promise<UploadIntentResult> {
  const providers = params.providers ?? defaultProviders

  const profile = await providers.domainStore.getUserProfile(params.userId)
  if (profile.lifecycle_status !== 'approved') {
    throw AppError.forbidden('Only approved users can request upload intents.')
  }
  if (params.purpose === 'face_enrollment' && profile.role !== 'student') {
    throw AppError.forbidden('Only students can request face enrollment uploads.')
  }

  validateFileConstraints(params.purpose, params.contentType, params.sizeBytes)

  const ext = extFromMime(params.contentType)
  const objectPath = `${params.userId}/${params.purpose}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`

  const fileRecord = await providers.domainStore.createFileRecord({
    userId: params.userId,
    purpose: params.purpose,
    objectPath,
    contentType: params.contentType,
    sizeBytes: params.sizeBytes,
    lifecycle: 'pending_upload',
  })

  const uploadUrl = providers.objectStorage.getPresignedUploadUrl
    ? await providers.objectStorage.getPresignedUploadUrl({
        key: objectPath,
        contentType: params.contentType,
        expiresInSeconds: 900,
      })
    : `https://storage.local/upload/${encodeURIComponent(objectPath)}`

  return {
    file_id: fileRecord.id,
    upload_url: uploadUrl,
    object_path: objectPath,
    purpose: params.purpose,
    expires_in_seconds: 900,
  }
}

export async function confirmFileUpload(params: {
  userId: string
  fileId: string
  providers?: AppProviders
}): Promise<FileRecord> {
  const providers = params.providers ?? defaultProviders

  const fileRecord = await providers.domainStore.getFileRecord(params.fileId)
  if (!fileRecord) {
    throw AppError.notFound('File')
  }
  if (fileRecord.user_id !== params.userId) {
    throw AppError.forbidden('Cannot confirm files owned by another user.')
  }
  if (fileRecord.lifecycle !== 'pending_upload') {
    return fileRecord
  }

  const updated = await providers.domainStore.updateFileLifecycle(params.fileId, 'available')
  return updated
}

export async function getFile(params: {
  userId: string
  fileId: string
  userRoles?: string[]
  providers?: AppProviders
}): Promise<{ file: FileRecord; download_url: string | null }> {
  const providers = params.providers ?? defaultProviders

  const fileRecord = await providers.domainStore.getFileRecord(params.fileId)
  if (!fileRecord) {
    throw AppError.notFound('File')
  }

  const isOwner = fileRecord.user_id === params.userId
  const isPrivileged = params.userRoles?.some((r) =>
    ['platform_admin', 'school_admin', 'teacher', 'staff'].includes(r),
  )
  if (!isOwner && !isPrivileged) {
    throw AppError.forbidden('You do not have permission to view this file.')
  }

  if (fileRecord.lifecycle === 'deleted' || fileRecord.lifecycle === 'rejected') {
    throw AppError.notFound('File is no longer available.')
  }

  let downloadUrl: string | null = null
  if (fileRecord.purpose === 'avatar') {
    downloadUrl = await providers.objectStorage.getSignedAvatarUrl(fileRecord.object_path)
  } else if (fileRecord.purpose === 'permit_attachment') {
    downloadUrl = await providers.objectStorage.getSignedPermitUrl(fileRecord.object_path)
  } else if (fileRecord.purpose === 'face_enrollment') {
    downloadUrl = await providers.objectStorage.getSignedFaceEnrollmentUrl(fileRecord.object_path)
  }

  return { file: fileRecord, download_url: downloadUrl }
}

export async function deleteFile(params: {
  userId: string
  fileId: string
  userRoles?: string[]
  providers?: AppProviders
}): Promise<void> {
  const providers = params.providers ?? defaultProviders

  const fileRecord = await providers.domainStore.getFileRecord(params.fileId)
  if (!fileRecord) {
    throw AppError.notFound('File')
  }

  const isOwner = fileRecord.user_id === params.userId
  const isPrivileged = params.userRoles?.some((r) => ['platform_admin', 'school_admin'].includes(r))
  if (!isOwner && !isPrivileged) {
    throw AppError.forbidden('You do not have permission to delete this file.')
  }

  await providers.domainStore.deleteFileRecord(params.fileId)
}
