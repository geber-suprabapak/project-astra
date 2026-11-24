import { Hono } from 'hono'
import {
  getCoreReadiness,
  getReadiness,
  type CoreReadinessResult,
  type ReadinessResult,
} from './service.js'
import { successResponse } from '../../lib/http/responses.js'
import { defaultProviders } from '../../providers/index.js'
import type { AppProviders } from '../../providers/types.js'
import type { AppEnv } from '../../types/context.js'

export interface HealthRouterDeps {
  providers?: AppProviders
  getReadiness?: () => Promise<ReadinessResult>
  getCoreReadiness?: () => Promise<CoreReadinessResult>
}

export function createHealthRouter(deps: HealthRouterDeps = {}) {
  const router = new Hono<AppEnv>()

  // GET /live — process-only, always 200
  router.get('/live', (c) => {
    return c.json({ status: 'ok' })
  })

  // GET /ready — checks all runtime dependencies including ML service
  router.get('/ready', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const result = deps.getReadiness ? await deps.getReadiness() : await getReadiness(providers)
    return c.json(result, result.healthy ? 200 : 503)
  })

  // GET /ready/core — checks core dependencies excluding optional ML service
  router.get('/ready/core', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const result = deps.getCoreReadiness
      ? await deps.getCoreReadiness()
      : await getCoreReadiness(providers)
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
    // SAFETY: the human-readable message must agree with the machine status so
    // Mobile never sees a healthy message for an unhealthy service.
    return successResponse(
      c,
      { status: result.healthy ? 'healthy' : 'unhealthy' },
      result.healthy ? 'Service healthy.' : 'Service unhealthy.',
    )
  })

  return router
}

const healthRouter = createHealthRouter()
const mobileHealthRouter = createMobileHealthRouter()

export { healthRouter, mobileHealthRouter }
