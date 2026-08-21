import { z } from 'zod'
import { filePurposeSchema } from '../../providers/types.js'

export const MAX_AVATAR_UPLOAD_SIZE = 5 * 1024 * 1024
export const MAX_PERMIT_UPLOAD_SIZE = 5 * 1024 * 1024
export const MAX_FACE_UPLOAD_SIZE = 2 * 1024 * 1024

export const ALLOWED_AVATAR_MIME = ['image/jpeg', 'image/png', 'image/webp']
export const ALLOWED_PERMIT_MIME = ['image/jpeg', 'image/png', 'application/pdf']
export const ALLOWED_FACE_MIME = ['image/jpeg']

export const RequestUploadIntentSchema = z.object({
  purpose: filePurposeSchema,
  content_type: z.string().min(1, 'content_type is required'),
  size_bytes: z.number().int().positive().optional(),
  filename: z.string().optional(),
})

export type RequestUploadIntentInput = z.infer<typeof RequestUploadIntentSchema>
