import { robinClient, type RobinClient } from '../../clients/robin/client.js'
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
  client: RobinClient = robinClient,
): Promise<RobinEnrollStatus> {
  return client.getEnrollmentStatus(token, requestId)
}

export async function enrollFace(
  files: EnrollmentFile[],
  token: string,
  requestId: string,
  client: RobinClient = robinClient,
): Promise<RobinEnrollResult> {
  if (files.length !== REQUIRED_ENROLLMENT_FILES) {
    throw AppError.validationError(
      `Exactly ${REQUIRED_ENROLLMENT_FILES} files are required. Got ${files.length}.`,
    )
  }

  for (const file of files) {
    if (file.contentType !== ALLOWED_ENROLLMENT_CONTENT_TYPE) {
      throw AppError.validationError(
        `All files must be JPEG. Got: ${file.contentType}.`,
      )
    }
    if (file.size > MAX_ENROLLMENT_FILE_SIZE_BYTES) {
      throw AppError.validationError(
        `Each file must be under 2MB. "${file.filename}" is too large.`,
      )
    }
  }

  return client.enroll(files, token, requestId)
}
