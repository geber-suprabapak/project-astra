import { z } from 'zod'
import type { NotificationRecord, UserProfile } from '../../providers/types.js'
import { logger } from '../../lib/logging/logger.js'

export interface NotificationDeliveryResult {
  success: boolean
  recipient?: string
  messageId?: string
  error?: string
}

export interface NotificationTransport {
  sendPush(
    notification: NotificationRecord,
    recipientProfile?: UserProfile | null,
  ): Promise<NotificationDeliveryResult>

  sendEmail(
    notification: NotificationRecord,
    recipientProfile?: UserProfile | null,
  ): Promise<NotificationDeliveryResult>
}

const payloadSchema = z
  .object({
    title: z.string().optional(),
    body: z.string().optional(),
    email: z.string().optional(),
  })
  .passthrough()

export class LoggingNotificationTransport implements NotificationTransport {
  async sendPush(
    notification: NotificationRecord,
    recipientProfile?: UserProfile | null,
  ): Promise<NotificationDeliveryResult> {
    const parsed = payloadSchema.safeParse(notification.payload)
    const title = parsed.success && parsed.data.title ? parsed.data.title : 'Notification'
    const body = parsed.success && parsed.data.body ? parsed.data.body : ''
    const recipient = recipientProfile?.full_name ?? notification.user_id

    logger.info(
      {
        notificationId: notification.id,
        userId: notification.user_id,
        channel: 'push',
        title,
        body,
        recipient,
      },
      'Push notification dispatched',
    )

    return {
      success: true,
      recipient,
      messageId: `push-${notification.id}-${Date.now()}`,
    }
  }

  async sendEmail(
    notification: NotificationRecord,
    recipientProfile?: UserProfile | null,
  ): Promise<NotificationDeliveryResult> {
    const parsed = payloadSchema.safeParse(notification.payload)
    const payloadEmail = parsed.success ? parsed.data.email : undefined
    const email = recipientProfile?.email ?? payloadEmail ?? null
    const title = parsed.success && parsed.data.title ? parsed.data.title : 'Notification'
    const body = parsed.success && parsed.data.body ? parsed.data.body : ''

    if (!email) {
      return {
        success: false,
        error: `No destination email address found for user ${notification.user_id}`,
      }
    }

    logger.info(
      {
        notificationId: notification.id,
        userId: notification.user_id,
        channel: 'email',
        email,
        title,
        body,
      },
      'Email notification dispatched',
    )

    return {
      success: true,
      recipient: email,
      messageId: `email-${notification.id}-${Date.now()}`,
    }
  }
}

export class MockNotificationTransport implements NotificationTransport {
  public deliveredPushes: Array<{ notification: NotificationRecord; recipient?: UserProfile | null }> = []
  public deliveredEmails: Array<{ notification: NotificationRecord; recipient?: UserProfile | null }> = []
  public failureChannel?: 'push' | 'email' | 'all'
  public failureError = 'Simulated transport failure'

  async sendPush(
    notification: NotificationRecord,
    recipientProfile?: UserProfile | null,
  ): Promise<NotificationDeliveryResult> {
    if (this.failureChannel === 'push' || this.failureChannel === 'all') {
      return { success: false, error: this.failureError }
    }
    this.deliveredPushes.push({ notification, recipient: recipientProfile })
    return {
      success: true,
      recipient: recipientProfile?.full_name ?? notification.user_id,
      messageId: `mock-push-${notification.id}`,
    }
  }

  async sendEmail(
    notification: NotificationRecord,
    recipientProfile?: UserProfile | null,
  ): Promise<NotificationDeliveryResult> {
    if (this.failureChannel === 'email' || this.failureChannel === 'all') {
      return { success: false, error: this.failureError }
    }
    this.deliveredEmails.push({ notification, recipient: recipientProfile })
    return {
      success: true,
      recipient: recipientProfile?.email ?? 'mock@example.com',
      messageId: `mock-email-${notification.id}`,
    }
  }

  reset(): void {
    this.deliveredPushes = []
    this.deliveredEmails = []
    this.failureChannel = undefined
  }
}
