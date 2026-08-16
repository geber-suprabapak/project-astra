import { Hono } from 'hono'
import { getReadiness, type ReadinessResult } from './service.js'
import { successResponse } from '../../lib/http/responses.js'
import type { AppEnv } from '../../types/context.js'

export interface HealthRouterDeps {
  getReadiness?: () => Promise<ReadinessResult>
}

export function createHealthRouter(deps: HealthRouterDeps = {}) {
  const getReadinessFn = deps.getReadiness ?? getReadiness
  const router = new Hono<AppEnv>()

  // GET /live — process-only, always 200
  router.get('/live', (c) => {
    return c.json({ status: 'ok' })
  })

  // GET /ready — checks Supabase + Robin
  router.get('/ready', async (c) => {
    const result = await getReadinessFn()
    return c.json(result, result.healthy ? 200 : 503)
  })

  return router
}

export function createMobileHealthRouter(deps: HealthRouterDeps = {}) {
  const getReadinessFn = deps.getReadiness ?? getReadiness
  const router = new Hono<AppEnv>()

  // GET /v1/mobile/health — mobile-safe, no internal names
  router.get('/', async (c) => {
    const result = await getReadinessFn()
    return successResponse(
      c,
      { status: result.healthy ? 'healthy' : 'unhealthy' },
      'Service healthy.',
    )
  })

  return router
}

const healthRouter = createHealthRouter()
const mobileHealthRouter = createMobileHealthRouter()

export { healthRouter, mobileHealthRouter }
