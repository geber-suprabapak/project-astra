import { Hono } from 'hono'
import { auth } from '../../middleware/auth.js'
import { rateLimits } from '../../middleware/rate-limit.js'
import { getServerTime } from './service.js'
import { successResponse } from '../../lib/http/responses.js'
import type { AppEnv } from '../../types/context.js'

export const timeRouter = new Hono<AppEnv>()

timeRouter.use('*', auth)
timeRouter.use('*', rateLimits.time)

timeRouter.get('/', (c) => {
  return successResponse(c, getServerTime(), 'Current server time.')
})
