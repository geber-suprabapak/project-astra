import { Hono } from 'hono'
import { auth } from '../../middleware/auth.js'
import { privilegedAuth } from '../../middleware/privileged-auth.js'
import { rateLimits } from '../../middleware/rate-limit.js'
import { successResponse } from '../../lib/http/responses.js'
import type { AppEnv } from '../../types/context.js'
import { getPrivilegedSession } from './service.js'

export const adminRouter = new Hono<AppEnv>()

adminRouter.use('*', auth)
adminRouter.use('*', privilegedAuth)
adminRouter.use('*', rateLimits.adminSession)

adminRouter.get('/session', (c) =>
  successResponse(
    c,
    getPrivilegedSession({
      userId: c.get('userId'),
      profileRole: c.get('profileRole'),
      profileStatus: c.get('profileLifecycleStatus'),
      identityUser: c.get('identityUser'),
    }),
    'Privileged session is active.',
  ),
)
