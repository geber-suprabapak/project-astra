import { AppError } from '../../../lib/errors/app-error.js'
import type {
  AppProviders,
  IdentityRole,
  ListNotificationsFilter,
  NotificationChannel,
  NotificationPayload,
  NotificationRecord,
} from '../../../providers/types.js'
import { assertAdminAccess, assertChronosStaffAccess } from './shared.js'

export async function listAdminNotifications(params: {
  filter?: ListNotificationsFilter
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<NotificationRecord[]> {
  assertChronosStaffAccess(params.actorRole)
  return params.providers.domainStore.listNotifications(params.filter)
}

export async function getAdminNotification(params: {
  id: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<NotificationRecord> {
  assertChronosStaffAccess(params.actorRole)
  const notif = await params.providers.domainStore.getNotificationById(params.id)
  if (!notif) {
    throw AppError.notFound('Notification')
  }
  return notif
}

export async function enqueueAdminNotification(params: {
  userId: string
  channel: NotificationChannel
  payload: NotificationPayload
  nextRetryAt?: string | null
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<NotificationRecord> {
  assertChronosStaffAccess(params.actorRole)

  const user = await params.providers.domainStore.getUserProfile(params.userId).catch(() => null)
  if (!user) {
    throw AppError.notFound('User profile')
  }

  const notification = await params.providers.domainStore.enqueueNotification({
    userId: params.userId,
    channel: params.channel,
    payload: params.payload,
    nextRetryAt: params.nextRetryAt ?? null,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'enqueue_notification',
    entity_type: 'notification',
    entity_id: notification.id,
    details: {
      user_id: params.userId,
      channel: params.channel,
    },
  })

  return notification
}

export async function retryAdminNotification(params: {
  id: string
  resetCount?: boolean
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<NotificationRecord> {
  assertChronosStaffAccess(params.actorRole)

  const existing = await params.providers.domainStore.getNotificationById(params.id)
  if (!existing) {
    throw AppError.notFound('Notification')
  }

  const updated = await params.providers.domainStore.updateNotificationStatus({
    id: params.id,
    status: 'pending',
    retryCount: params.resetCount !== false ? 0 : existing.retry_count,
    nextRetryAt: null,
    errorMessage: null,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'retry_notification',
    entity_type: 'notification',
    entity_id: params.id,
    details: {
      previous_status: existing.status,
      previous_retries: existing.retry_count,
    },
  })

  return updated
}

export async function deleteAdminNotification(params: {
  id: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<void> {
  assertAdminAccess(params.actorRole)

  const existing = await params.providers.domainStore.getNotificationById(params.id)
  if (!existing) {
    throw AppError.notFound('Notification')
  }

  await params.providers.domainStore.deleteNotification(params.id)

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'delete_notification',
    entity_type: 'notification',
    entity_id: params.id,
    details: {
      channel: existing.channel,
      user_id: existing.user_id,
    },
  })
}
