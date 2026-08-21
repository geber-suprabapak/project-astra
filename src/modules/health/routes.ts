import { Hono } from 'hono'
import { getReadiness, type ReadinessResult } from './service.js'
import { successResponse } from '../../lib/http/responses.js'
import { defaultProviders } from '../../providers/index.js'
import type { AppProviders } from '../../providers/types.js'
import type { AppEnv } from '../../types/context.js'

export interface HealthRouterDeps {
  providers?: AppProviders
  getReadiness?: () => Promise<ReadinessResult>
}

export function createHealthRouter(deps: HealthRouterDeps = {}) {
  const router = new Hono<AppEnv>()

  // GET /live — process-only, always 200
  router.get('/live', (c) => {
    return c.json({ status: 'ok' })
  })

  // GET /ready — checks portable runtime dependencies
  router.get('/ready', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const result = deps.getReadiness ? await deps.getReadiness() : await getReadiness(providers)
    return c.json(result, result.healthy ? 200 : 503)
  })

  return router
}

export function createMobileHealthRouter(deps: HealthRouterDeps = {}) {
  const router = new Hono<AppEnv>()

  // GET /v1/mobile/health — mobile-safe, no internal names
  router.get('/', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const result = deps.getReadiness ? await deps.getReadiness() : await getReadiness(providers)
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
