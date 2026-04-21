import { Hono } from 'hono'
import { getReadiness } from './service.js'
import { successResponse } from '../../lib/http/responses.js'
import type { AppEnv } from '../../types/context.js'

const healthRouter = new Hono<AppEnv>()

// GET /live — process-only, always 200
healthRouter.get('/live', (c) => {
  return c.json({ status: 'ok' })
})

// GET /ready — checks Supabase + Robin
healthRouter.get('/ready', async (c) => {
  const result = await getReadiness()
  return c.json(result, result.healthy ? 200 : 503)
})

// GET /v1/mobile/health — mobile-safe, no internal names
const mobileHealthRouter = new Hono<AppEnv>()
mobileHealthRouter.get('/', async (c) => {
  const result = await getReadiness()
  return successResponse(c, { operational: result.healthy }, 'Health check completed.')
})

export { healthRouter, mobileHealthRouter }
