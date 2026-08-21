import { AppError } from '../../lib/errors/app-error.js'
import type {
  AppProviders,
  IdentityRole,
  ListNotificationsFilter,
  NotificationChannel,
  NotificationPayload,
  NotificationRecord,
} from '../../providers/types.js'

function checkNotificationAdminAccess(role: IdentityRole | null | undefined): void {
  if (!role || !['platform_admin', 'school_admin', 'staff', 'teacher'].includes(role)) {
    throw AppError.forbidden()
  }
}

export async function enqueueNotification(params: {
  userId: string
  channel: NotificationChannel
  payload: NotificationPayload
  nextRetryAt?: string | null
  actorId?: string
  actorRole?: IdentityRole | null
  providers: AppProviders
}): Promise<NotificationRecord> {
  if (params.actorRole) {
    checkNotificationAdminAccess(params.actorRole)
  }

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

  if (params.actorId) {
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
  }

  return notification
}

export async function listAdminNotifications(params: {
  filter?: ListNotificationsFilter
  actorId?: string
  actorRole?: IdentityRole | null
  providers: AppProviders
}): Promise<NotificationRecord[]> {
  checkNotificationAdminAccess(params.actorRole)
  return params.providers.domainStore.listNotifications(params.filter)
}

export async function getAdminNotification(params: {
  id: string
  actorId?: string
  actorRole?: IdentityRole | null
  providers: AppProviders
}): Promise<NotificationRecord> {
  checkNotificationAdminAccess(params.actorRole)
  const notification = await params.providers.domainStore.getNotificationById(params.id)
  if (!notification) {
    throw AppError.notFound('Notification')
  }
  return notification
}

export async function retryAdminNotification(params: {
  id: string
  resetCount?: boolean
  actorId?: string
  actorRole?: IdentityRole | null
  providers: AppProviders
}): Promise<NotificationRecord> {
  checkNotificationAdminAccess(params.actorRole)
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

  if (params.actorId) {
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
  }

  return updated
}

export async function deleteAdminNotification(params: {
  id: string
  actorId?: string
  actorRole?: IdentityRole | null
  providers: AppProviders
}): Promise<void> {
  checkNotificationAdminAccess(params.actorRole)
  const existing = await params.providers.domainStore.getNotificationById(params.id)
  if (!existing) {
    throw AppError.notFound('Notification')
  }

  await params.providers.domainStore.deleteNotification(params.id)

  if (params.actorId) {
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
}
