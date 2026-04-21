import { Hono } from 'hono'
import { auth } from '../../middleware/auth.js'
import { rateLimits } from '../../middleware/rate-limit.js'
import { successResponse } from '../../lib/http/responses.js'
import { getDashboard } from './service.js'
import type { AppEnv } from '../../types/context.js'

export const dashboardRouter = new Hono<AppEnv>()

dashboardRouter.use('*', auth)
dashboardRouter.use('*', rateLimits.dashboard)

dashboardRouter.get('/', async (c) => {
  const userId = c.get('userId')
  const token = c.get('rawToken')
  const requestId = c.get('requestId')

  const data = await getDashboard(userId, token, requestId)
  return successResponse(c, data, 'Dashboard data retrieved.')
})
