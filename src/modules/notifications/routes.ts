import { Hono } from 'hono'
import { auth } from '../../middleware/auth.js'
import { AppError } from '../../lib/errors/app-error.js'
import { successResponse } from '../../lib/http/responses.js'
import { defaultProviders } from '../../providers/index.js'
import type { AppProviders } from '../../providers/types.js'
import type { AppEnv } from '../../types/context.js'
import { z } from 'zod'

const notificationTokenSchema = z.object({ token: z.string().trim().min(1).max(4096).nullable() })

export interface NotificationRouterDeps {
  providers?: AppProviders
}

export function createNotificationRouter(deps: NotificationRouterDeps = {}) {
  const router = new Hono<AppEnv>()
  router.use('*', auth)

  router.get('/token', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const profile = await providers.domainStore.getUserProfile(c.get('userId'))
    return successResponse(c, { notification_token: profile.notification_token ?? null }, 'Notification token retrieved.')
  })

  router.patch('/token', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const parsed = notificationTokenSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw AppError.validationError(parsed.error.flatten())
    await providers.domainStore.updateUserProfile(c.get('userId'), {
      notification_token: parsed.data.token,
    })
    return successResponse(c, { notification_token: parsed.data.token }, 'Notification token updated.')
  })

  return router
}

export const notificationRouter = createNotificationRouter()
