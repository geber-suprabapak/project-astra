import { z } from 'zod'
import {
  notificationChannelSchema,
  notificationPayloadSchema,
  notificationStatusSchema,
  type NotificationChannel,
  type NotificationStatus,
} from '../../providers/types.js'

export {
  notificationChannelSchema,
  notificationPayloadSchema,
  notificationStatusSchema,
  type NotificationChannel,
  type NotificationStatus,
}

export const enqueueNotificationSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  channel: notificationChannelSchema,
  payload: notificationPayloadSchema.refine((obj) => Object.keys(obj).length > 0, {
    message: 'Payload cannot be empty',
  }),
  nextRetryAt: z.string().datetime().optional(),
})
export type EnqueueNotificationInput = z.infer<typeof enqueueNotificationSchema>

export const listNotificationsQuerySchema = z.object({
  userId: z.string().optional(),
  channel: notificationChannelSchema.optional(),
  status: notificationStatusSchema.optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
})
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>

export const retryNotificationSchema = z
  .object({
    resetCount: z.boolean().default(true),
  })
  .optional()
export type RetryNotificationInput = z.infer<typeof retryNotificationSchema>
