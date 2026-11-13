import { z } from 'zod'
import { notificationPayloadSchema } from '../../../providers/types.js'

export const enqueueAdminNotificationSchema = z
  .object({
    user_id: z.string().min(1, 'User ID is required.').optional(),
    userId: z.string().min(1, 'User ID is required.').optional(),
    channel: z.enum(['push', 'email']),
    payload: notificationPayloadSchema.refine((obj) => Object.keys(obj).length > 0, {
      message: 'Payload cannot be empty.',
    }),
    next_retry_at: z.string().datetime().optional(),
    nextRetryAt: z.string().datetime().optional(),
  })
  .refine((data) => Boolean(data.user_id || data.userId), {
    message: 'User ID is required.',
    path: ['user_id'],
  })

export type EnqueueAdminNotificationInput = z.infer<typeof enqueueAdminNotificationSchema>

export const notificationResponseSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  channel: z.enum(['push', 'email']),
  payload: notificationPayloadSchema,
  status: z.enum(['pending', 'processing', 'delivered', 'failed']),
  retry_count: z.number(),
  next_retry_at: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export type NotificationResponse = z.infer<typeof notificationResponseSchema>
