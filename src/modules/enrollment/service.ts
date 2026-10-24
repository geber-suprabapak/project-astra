import { defaultProviders } from '../../providers/index.js'
import type { AppProviders } from '../../providers/types.js'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
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

  if (!userId) {
    return providers.robinClient.enroll(files, token, requestId)
  }

  // Recoverable replacement ordering (A07): Robin is re-enrolled FIRST. Only
  // after Robin confirms the new embeddings are Astra file records replaced and
  // the enrollment state saved. A failure at any boundary therefore leaves the
  // previous enrollment intact (Robin enroll / object write failure), or an
  // explicit state a retry completes and reconciles (cleanup / state / audit
  // failure after Robin confirmed). A new `enrolled` state is never saved
  // without Robin support.
  //
  // Disclosed limitation: object paths are deterministic per user and index, so
  // once an upload begins the previous objects are overwritten in place. If a
  // later object/metadata write fails after Robin confirmed, the surviving
  // previous records can reference objects whose content was (partially)
  // replaced — their size_bytes metadata may mismatch the stored object until
  // the retry completes. This is benign for the enrollment claim: Robin holds
  // the new embeddings and Astra never re-reads enrollment objects for
  // recognition.
  const previousRecords = (
    await providers.domainStore.listFiles({ userId, purpose: 'face_enrollment' })
  ).filter((file) => file.lifecycle !== 'deleted')

  const result = await providers.robinClient.enroll(files, token, requestId)

  const createdRecordIds: string[] = []
  try {
    // Store new files in object storage and register metadata in files table.
    // Object paths are deterministic per user and index, so replacement
    // uploads overwrite the previous objects in place.
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const objectPath = await providers.objectStorage.uploadFaceEnrollmentImage(
        userId,
        i + 1,
        file.buffer,
        file.contentType,
      )
      const record = await providers.domainStore.createFileRecord({
        userId,
        purpose: 'face_enrollment',
        objectPath,
        contentType: file.contentType,
        sizeBytes: file.size,
        lifecycle: 'available',
      })
      createdRecordIds.push(record.id)
    }
  } catch (err) {
    // Best-effort rollback of this attempt's records: every rollback delete is
    // attempted, a rollback failure is logged and never masks the original
    // error. Leftover records (from a failed rollback or a partially completed
    // rollback) stay reconcilable — a retry snapshots them as pre-existing and
    // retires them after Robin confirms.
    for (const recordId of createdRecordIds) {
      try {
        await providers.domainStore.deleteFileRecord(recordId)
      } catch (rollbackErr) {
        logger.warn(
          { err: rollbackErr, recordId },
          'Face enrollment replacement rollback left a record in place; a retry will reconcile it',
        )
      }
    }
    throw err
  }

  // Robin confirmed the replacement: retire the pre-existing records that were
  // snapshotted before this attempt (including leftovers from earlier failed
  // attempts), then commit the Astra enrollment state.
  for (const record of previousRecords) {
    await providers.domainStore.deleteFileRecord(record.id)
  }

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
  if (
    actorId === params.userId &&
    (profile.lifecycle_status !== 'approved' || profile.role !== 'student')
  ) {
    throw AppError.forbidden('Only approved students can manage face enrollment.')
  }

  // Recoverable deletion ordering (A07): Robin is deleted FIRST and delete
  // failures propagate (the client no longer swallows them), so Astra never
  // clears its records or reports a deletion Robin did not perform. A failure
  // after Robin confirmed leaves the Astra state explicitly stale; a retry
  // completes because Robin delete is idempotent (404 counts as deleted).
  await providers.robinClient.deleteEnrollment(params.token, params.requestId, params.userId)
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
