import { defaultProviders } from '../../providers/index.js'
import type { AppProviders } from '../../providers/types.js'
import { AppError } from '../../lib/errors/app-error.js'
import type { RobinEnrollResult, RobinEnrollStatus } from '../../clients/robin/schemas.js'
import {
  ALLOWED_ENROLLMENT_CONTENT_TYPE,
  MAX_ENROLLMENT_FILE_SIZE_BYTES,
  REQUIRED_ENROLLMENT_FILES,
} from './schema.js'

export interface EnrollmentFile {
  buffer: Buffer
  contentType: string
  filename: string
  size: number
}

export async function getEnrollmentStatus(
  token: string,
  requestId: string,
  providers: AppProviders = defaultProviders,
  userId?: string,
): Promise<RobinEnrollStatus> {
  if (userId) {
    const profile = await providers.domainStore.getUserProfile(userId)
    if (profile.lifecycle_status !== 'approved') {
      throw AppError.forbidden('Only approved students can access face enrollment.')
    }
    if (profile.role !== 'student') {
      throw AppError.forbidden('Only students can access face enrollment.')
    }

    const astraEnrollment = await providers.domainStore.getFaceEnrollment(userId)
    if (astraEnrollment && astraEnrollment.status === 'not_enrolled') {
      return { status: 'not_enrolled', embeddingCount: 0, message: 'Not enrolled.' }
    }
  }

  const robinStatus = await providers.robinClient.getEnrollmentStatus(token, requestId)

  if (userId && robinStatus.status === 'enrolled') {
    const astraEnrollment = await providers.domainStore.getFaceEnrollment(userId)
    if (!astraEnrollment || astraEnrollment.status !== 'enrolled') {
      await providers.domainStore.saveFaceEnrollment({
        userId,
        status: 'enrolled',
        sampleCount: robinStatus.embeddingCount || REQUIRED_ENROLLMENT_FILES,
      })
    }
  }

  return robinStatus
}

export async function enrollFace(
  files: EnrollmentFile[],
  token: string,
  requestId: string,
  providers: AppProviders = defaultProviders,
  userId?: string,
): Promise<RobinEnrollResult> {
  if (userId) {
    const profile = await providers.domainStore.getUserProfile(userId)
    if (profile.lifecycle_status !== 'approved') {
      throw AppError.forbidden('Only approved students can enroll face.')
    }
    if (profile.role !== 'student') {
      throw AppError.forbidden('Only students can enroll face.')
    }
  }

  if (files.length !== REQUIRED_ENROLLMENT_FILES) {
    throw AppError.validationError(
      `Exactly ${REQUIRED_ENROLLMENT_FILES} files are required. Got ${files.length}.`,
    )
  }

  for (const file of files) {
    if (file.contentType !== ALLOWED_ENROLLMENT_CONTENT_TYPE) {
      throw AppError.validationError(`All files must be JPEG. Got: ${file.contentType}.`)
    }
    if (file.size > MAX_ENROLLMENT_FILE_SIZE_BYTES) {
      throw AppError.validationError(
        `Each file must be under 2MB. "${file.filename}" is too large.`,
      )
    }
  }

  if (userId) {
    // Idempotent replacement: clean up any existing face enrollment files and objects
    await providers.domainStore.deleteFaceEnrollmentFiles(userId)
    await providers.objectStorage.deleteFaceEnrollmentImages(userId)

    // Store new files in object storage and register metadata in files table
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const objectPath = await providers.objectStorage.uploadFaceEnrollmentImage(
        userId,
        i + 1,
        file.buffer,
        file.contentType,
      )
      await providers.domainStore.createFileRecord({
        userId,
        purpose: 'face_enrollment',
        objectPath,
        contentType: file.contentType,
        sizeBytes: file.size,
        lifecycle: 'available',
      })
    }
  }

  const result = await providers.robinClient.enroll(files, token, requestId)

  if (userId) {
    await providers.domainStore.saveFaceEnrollment({
      userId,
      status: 'enrolled',
      sampleCount: result.totalEmbeddings || files.length,
    })

    await providers.domainStore.insertAuditLog({
      actor_id: userId,
      action: 'face_enrollment:enrolled',
      entity_type: 'face_enrollment',
      entity_id: userId,
      details: {
        samples_count: files.length,
        embeddings_created: result.totalEmbeddings || files.length,
      },
    })
  }

  return result
}

export async function deleteEnrollment(params: {
  userId: string
  token?: string
  requestId?: string
  actorId?: string
  providers?: AppProviders
}): Promise<void> {
  const providers = params.providers ?? defaultProviders
  const actorId = params.actorId ?? params.userId

  const profile = await providers.domainStore.getUserProfile(params.userId)
  if (actorId === params.userId && (profile.lifecycle_status !== 'approved' || profile.role !== 'student')) {
    throw AppError.forbidden('Only approved students can manage face enrollment.')
  }

  await providers.robinClient.deleteEnrollment(params.token, params.requestId)
  await providers.objectStorage.deleteFaceEnrollmentImages(params.userId)
  await providers.domainStore.deleteFaceEnrollmentFiles(params.userId)
  await providers.domainStore.deleteFaceEnrollment(params.userId)

  await providers.domainStore.insertAuditLog({
    actor_id: actorId,
    action: 'face_enrollment:deleted',
    entity_type: 'face_enrollment',
    entity_id: params.userId,
    details: {
      reason: 'Face enrollment removed.',
    },
  })
}

