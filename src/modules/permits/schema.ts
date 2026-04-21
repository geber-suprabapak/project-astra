import { z } from 'zod'

export const PERMIT_CATEGORIES = ['sakit', 'pergi'] as const
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
})
