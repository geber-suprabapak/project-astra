import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { requestId } from './middleware/request-id.js'
import { errorHandler } from './middleware/error-handler.js'
import { healthRouter } from './modules/health/routes.js'
import { v1Mobile } from './routes/v1-mobile.js'
import { env } from './config/env.js'
import { logger } from './lib/logging/logger.js'
import type { AppEnv } from './types/context.js'

const app = new Hono<AppEnv>()

// Global middleware
app.use('*', requestId)

app.use(
  '*',
  cors({
    origin: env.corsAllowedOrigins.length > 0 ? env.corsAllowedOrigins : '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposeHeaders: ['X-Request-ID'],
    maxAge: 3600,
  }),
)

// Basic security headers for API responses
app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Referrer-Policy', 'no-referrer')
  c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
})

// Request logging
app.use('*', async (c, next) => {
  const start = Date.now()
  await next()
  const ms = Date.now() - start
  logger.info(
    {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: ms,
      requestId: c.get('requestId'),
    },
    'request',
  )
})

// Root health probes (no auth, no /v1 prefix)
app.route('/', healthRouter)

// API routes
app.route('/v1/mobile', v1Mobile)

// Error handler (must be last)
app.onError(errorHandler)

// 404 fallback
app.notFound((c) =>
  c.json({ success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Route not found.' } }, 404),
)

export { app }
