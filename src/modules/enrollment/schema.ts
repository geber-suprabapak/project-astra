import { z } from 'zod'

export const REQUIRED_ENROLLMENT_FILES = 10
export const MAX_ENROLLMENT_FILE_SIZE_BYTES = 2 * 1024 * 1024 // 2MB per file
export const ALLOWED_ENROLLMENT_CONTENT_TYPE = 'image/jpeg'

export const EnrollFilesSchema = z
  .array(z.any())
  .length(REQUIRED_ENROLLMENT_FILES, `Exactly ${REQUIRED_ENROLLMENT_FILES} JPEG files are required.`)
