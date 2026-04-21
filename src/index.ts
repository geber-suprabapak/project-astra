import { serve } from '@hono/node-server'
import { app } from './app.js'
import { env } from './config/env.js'
import { logger } from './lib/logging/logger.js'

serve(
  {
    fetch: app.fetch,
    port: env.port,
  },
  (info) => {
    logger.info({ port: info.port, tenantKey: env.tenantKey }, 'BFF server started')
  },
)
