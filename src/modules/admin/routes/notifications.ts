import type { Context, Hono } from 'hono'
import { successResponse } from '../../../lib/http/responses.js'
import { notificationChannelSchema, notificationStatusSchema } from '../../../providers/types.js'
import type { AppEnv } from '../../../types/context.js'
import { enqueueAdminNotificationSchema } from '../schema.js'
import {
  deleteAdminNotification,
  enqueueAdminNotification,
  getAdminNotification,
  listAdminNotifications,
  retryAdminNotification,
} from '../service.js'
import {
  type AdminRouterDeps,
  parseJsonBodyOrEmpty,
  requireRouteParam,
  resolveAdminProviders,
} from './shared.js'

export function registerNotificationRoutes(router: Hono<AppEnv>, deps: AdminRouterDeps): void {
  // GET /v1/admin/notifications & /v1/admin/notifications/outbox
  const handleListNotifications = async (c: Context<AppEnv>) => {
    const providers = resolveAdminProviders(c, deps)
    const userId = c.req.query('userId') || c.req.query('user_id')
    const channelParam = c.req.query('channel')
    const statusParam = c.req.query('status')
    const limitParam = c.req.query('limit')
    const offsetParam = c.req.query('offset')

    const channelParsed = channelParam
      ? notificationChannelSchema.safeParse(channelParam)
      : undefined
    const statusParsed = statusParam ? notificationStatusSchema.safeParse(statusParam) : undefined

    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined
    const offset = offsetParam ? Number.parseInt(offsetParam, 10) : undefined

    const notifications = await listAdminNotifications({
      filter: {
        userId: userId || undefined,
        channel: channelParsed?.success ? channelParsed.data : undefined,
        status: statusParsed?.success ? statusParsed.data : undefined,
        limit,
        offset,
      },
      actorRole: c.get('profileRole'),
      actorId: c.get('userId'),
      providers,
    })

    return successResponse(c, notifications, 'Notifications retrieved successfully.')
  }

  router.get('/notifications', handleListNotifications)
  router.get('/notifications/outbox', handleListNotifications)

  // GET /v1/admin/notifications/:id
  const handleGetNotification = async (c: Context<AppEnv>) => {
    const providers = resolveAdminProviders(c, deps)
    const id = requireRouteParam(c, 'id')
    const notification = await getAdminNotification({
      id,
      actorRole: c.get('profileRole'),
      actorId: c.get('userId'),
      providers,
    })
    return successResponse(c, notification, 'Notification retrieved successfully.')
  }

  router.get('/notifications/:id', handleGetNotification)

  // POST /v1/admin/notifications & /v1/admin/notifications/enqueue
  const handleEnqueueNotification = async (c: Context<AppEnv>) => {
    const providers = resolveAdminProviders(c, deps)
    const data = await parseJsonBodyOrEmpty(c, enqueueAdminNotificationSchema)

    const userId = data.user_id || data.userId || ''
    const nextRetryAt = data.next_retry_at || data.nextRetryAt

    const notification = await enqueueAdminNotification({
      userId,
      channel: data.channel,
      payload: data.payload,
      nextRetryAt: nextRetryAt ?? null,
      actorRole: c.get('profileRole'),
      actorId: c.get('userId'),
      providers,
    })

    return successResponse(c, notification, 'Notification enqueued successfully.')
  }

  router.post('/notifications', handleEnqueueNotification)
  router.post('/notifications/enqueue', handleEnqueueNotification)

  // POST|PATCH /v1/admin/notifications/:id/retry
  const handleRetryNotification = async (c: Context<AppEnv>) => {
    const providers = resolveAdminProviders(c, deps)
    const id = requireRouteParam(c, 'id')
    const body = await c.req.json().catch(() => ({}))

    const retried = await retryAdminNotification({
      id,
      resetCount: body.reset_count !== false && body.resetCount !== false,
      actorRole: c.get('profileRole'),
      actorId: c.get('userId'),
      providers,
    })

    return successResponse(c, retried, 'Notification retry scheduled successfully.')
  }

  router.post('/notifications/:id/retry', handleRetryNotification)
  router.patch('/notifications/:id/retry', handleRetryNotification)

  // DELETE /v1/admin/notifications/:id
  const handleDeleteNotification = async (c: Context<AppEnv>) => {
    const providers = resolveAdminProviders(c, deps)
    const id = requireRouteParam(c, 'id')
    await deleteAdminNotification({
      id,
      actorRole: c.get('profileRole'),
      actorId: c.get('userId'),
      providers,
    })
    return successResponse(c, { id }, 'Notification deleted successfully.')
  }

  router.delete('/notifications/:id', handleDeleteNotification)
}
