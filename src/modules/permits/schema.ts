import { z } from 'zod'

export const PERMIT_CATEGORIES = ['sakit', 'pergi', 'dispensasi', 'lainnya'] as const
export type PermitCategory = (typeof PERMIT_CATEGORIES)[number]

export const MAX_PERMIT_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024 // 10MB

export const CreatePermitSchema = z.object({
  category: z.enum(PERMIT_CATEGORIES, {
    errorMap: () => ({ message: `Category must be one of: ${PERMIT_CATEGORIES.join(', ')}` }),
  }),
  description: z
    .string()
    .min(10, 'Description must be at least 10 characters.')
    .max(500, 'Description must not exceed 500 characters.'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD format.'),
  file_id: z.string().min(1).optional(),
  fileId: z.string().min(1).optional(),
})

export type CreatePermitInput = z.infer<typeof CreatePermitSchema>

export const CreateLeaveRequestSchema = CreatePermitSchema
export type CreateLeaveRequestInput = CreatePermitInput

export const permitResponseSchema = z.object({
  id: z.string(),
  category: z.string(),
  description: z.string(),
  date: z.string(),
  approval_status: z.enum(['pending', 'approved', 'rejected']),
  attachment_url: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  rejection_reason: z.string().nullable().optional(),
  rejected_at: z.string().nullable().optional(),
})

export type PermitResponse = z.infer<typeof permitResponseSchema>
export const leaveRequestResponseSchema = permitResponseSchema
export type LeaveRequestResponse = PermitResponse
