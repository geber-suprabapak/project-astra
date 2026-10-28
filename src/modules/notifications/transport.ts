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

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

const expoPushTicketSchema = z.object({
  status: z.enum(['ok', 'error']).optional(),
  id: z.string().optional(),
  message: z.string().optional(),
  details: z.object({ error: z.string().optional() }).optional(),
})
const expoPushResponseSchema = z.object({
  data: z.union([expoPushTicketSchema, z.array(expoPushTicketSchema)]).optional(),
  errors: z
    .array(z.object({ code: z.string().optional(), message: z.string().optional() }))
    .optional(),
})

// shortcut: email stays log-only until an email provider is configured.
export class ExpoPushNotificationTransport extends LoggingNotificationTransport {
  override async sendPush(
    notification: NotificationRecord,
    recipientProfile?: UserProfile | null,
  ): Promise<NotificationDeliveryResult> {
    const token = recipientProfile?.notification_token?.trim()
    if (!token) return { success: false, error: 'No Expo push token registered' }

    const parsed = payloadSchema.safeParse(notification.payload)
    const title = parsed.success && parsed.data.title ? parsed.data.title : 'Notification'
    const body = parsed.success && parsed.data.body ? parsed.data.body : ''
    const headers = new Headers({
      accept: 'application/json',
      'content-type': 'application/json',
    })
    if (process.env.EXPO_ACCESS_TOKEN) {
      headers.set('authorization', `Bearer ${process.env.EXPO_ACCESS_TOKEN}`)
    }

    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          to: token,
          title,
          body,
          channelId: 'skanida-default',
          data: { title, message: body },
        }),
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) {
        return { success: false, error: `Expo Push API returned HTTP ${response.status}` }
      }

      const parsedResult = expoPushResponseSchema.safeParse(await response.json())
      if (!parsedResult.success) {
        return { success: false, error: 'Expo Push API returned an invalid response' }
      }
      const result = parsedResult.data
      const ticket = Array.isArray(result.data) ? result.data[0] : result.data
      if (ticket?.status === 'ok' && ticket.id) {
        return {
          success: true,
          recipient: recipientProfile?.full_name ?? notification.user_id,
          messageId: ticket.id,
        }
      }

      const errorCode = ticket?.details?.error ?? result.errors?.[0]?.code
      const errorMessage = (ticket?.message ?? result.errors?.[0]?.message)?.replaceAll(
        token,
        '[redacted-token]',
      )
      return {
        success: false,
        error:
          [errorCode, errorMessage].filter(Boolean).join(': ') ||
          'Expo Push API rejected the notification',
      }
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Expo Push API request failed',
      }
    }
  }
}

export class MockNotificationTransport implements NotificationTransport {
  public deliveredPushes: Array<{
    notification: NotificationRecord
    recipient?: UserProfile | null
  }> = []
  public deliveredEmails: Array<{
    notification: NotificationRecord
    recipient?: UserProfile | null
  }> = []
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
