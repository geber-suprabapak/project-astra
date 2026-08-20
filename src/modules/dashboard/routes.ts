import { Hono } from 'hono'
import { auth } from '../../middleware/auth.js'
import { rateLimits } from '../../middleware/rate-limit.js'
import { successResponse } from '../../lib/http/responses.js'
import { defaultProviders } from '../../providers/index.js'
import type { AppProviders } from '../../providers/types.js'
import { getDashboard } from './service.js'
import type { AppEnv } from '../../types/context.js'

export interface DashboardRouterDeps {
  providers?: AppProviders
}

export function createDashboardRouter(deps: DashboardRouterDeps = {}) {
  const router = new Hono<AppEnv>()

  router.use('*', auth)
  router.use('*', rateLimits.dashboard)

  router.get('/', async (c) => {
    const userId = c.get('userId')
    const token = c.get('rawToken')
    const requestId = c.get('requestId')
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders

    const data = await getDashboard(userId, token, requestId, providers)
    return successResponse(c, data, 'Dashboard data retrieved.')
  })

  return router
}

export const dashboardRouter = createDashboardRouter()
