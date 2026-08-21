import { z } from 'zod'
import { base64ByteSize } from './mapper.js'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export const PrecheckBodySchema = z.object({
  latitude: z.number({ required_error: 'latitude is required.' }),
  longitude: z.number({ required_error: 'longitude is required.' }),
})

export const SubmitBodySchema = z.object({
  action_type: z.enum(['check_in', 'check_out']),
  image_base64: z.string().refine((b) => base64ByteSize(b) <= MAX_IMAGE_BYTES, {
    message: 'image_base64 exceeds 5MB.',
  }),
  latitude: z.number(),
  longitude: z.number(),
})

export const AttendanceHistoryQuerySchema = z.object({
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
})

export const AttendanceCalendarQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
})

export type PrecheckBody = z.infer<typeof PrecheckBodySchema>
export type SubmitBody = z.infer<typeof SubmitBodySchema>
