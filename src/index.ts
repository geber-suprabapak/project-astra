import { serve } from '@hono/node-server'
import { app } from './app.js'
import { closeRedisClient, ensureRedisReady, isRedisConfigured } from './clients/redis.js'
import { env } from './config/env.js'
import { logger } from './lib/logging/logger.js'

const rateLimitBackend = isRedisConfigured() ? 'redis' : 'memory'

if (isRedisConfigured()) {
  await ensureRedisReady()
}

const server = serve(
  {
    fetch: app.fetch,
    port: env.port,
  },
  (info) => {
    logger.info(
      { port: info.port, tenantKey: env.tenantKey, rate_limit_backend: rateLimitBackend },
      'BFF server started',
    )
  },
)

function shutdown(signal: 'SIGINT' | 'SIGTERM') {
  logger.info({ signal }, 'Shutdown signal received')

  const forceCloseTimer = setTimeout(() => {
    logger.error({ signal }, 'Forced shutdown after timeout')
    process.exit(1)
  }, 10_000)
  forceCloseTimer.unref()

  server.close((err) => {
    clearTimeout(forceCloseTimer)
    if (err) {
      logger.error({ err, signal }, 'Error during server shutdown')
      process.exit(1)
    }
    closeRedisClient()
      .catch((closeErr) => {
        logger.warn({ err: closeErr, signal }, 'Redis shutdown encountered an error')
      })
      .finally(() => {
        logger.info({ signal }, 'Server shutdown complete')
        process.exit(0)
      })
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
