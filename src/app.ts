import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { requestId } from './middleware/request-id.js'
import { errorHandler } from './middleware/error-handler.js'
import {
  createHealthRouter,
  createMobileHealthRouter,
  healthRouter,
} from './modules/health/routes.js'
import { type ReadinessResult } from './modules/health/service.js'
import { createV1Mobile, v1Mobile } from './routes/v1-mobile.js'
import { createAdminRouter, adminRouter } from './modules/admin/routes.js'
import { createPasswordRouter, createStudentAuthRouter, passwordRouter, studentAuthRouter } from './modules/auth/routes.js'
import { defaultProviders } from './providers/index.js'
import type { AppProviders } from './providers/types.js'
import { env } from './config/env.js'
import { logger } from './lib/logging/logger.js'
import type { AppEnv } from './types/context.js'
const API_CONTRACT_VERSION = 'v1'

export interface AppDeps {
  providers?: Partial<AppProviders>
  getReadiness?: () => Promise<ReadinessResult>
  v1Mobile?: Hono<AppEnv>
  adminRouter?: Hono<AppEnv>
  passwordRouter?: Hono<AppEnv>
  healthRouter?: Hono<AppEnv>
  studentAuthRouter?: Hono<AppEnv>
}

export function createApp(deps: AppDeps = {}) {
  const app = new Hono<AppEnv>()

  const resolvedProviders: AppProviders = {
    domainStore: deps.providers?.domainStore ?? defaultProviders.domainStore,
    objectStorage: deps.providers?.objectStorage ?? defaultProviders.objectStorage,
    identityProvider: deps.providers?.identityProvider ?? defaultProviders.identityProvider,
    robinClient: deps.providers?.robinClient ?? defaultProviders.robinClient,
  }

  // Global middleware
  app.use('*', requestId)

  // Attach providers to context
  app.use('*', async (c, next) => {
    c.set('providers', resolvedProviders)
    await next()
  })

  app.use(
    '*',
    cors({
      origin: env.corsAllowedOrigins.length > 0 ? env.corsAllowedOrigins : '*',
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Astra-Contract-Version'],
      exposeHeaders: ['X-Request-ID', 'X-Astra-Contract-Version'],
      maxAge: 3600,
    }),
  )

  // Basic security headers for API responses
  app.use('*', async (c, next) => {
    await next()
    c.header('X-Astra-Contract-Version', API_CONTRACT_VERSION)
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

  const rootHealth =
    deps.healthRouter ??
    (deps.providers || deps.getReadiness
      ? createHealthRouter({
          providers: resolvedProviders,
          getReadiness: deps.getReadiness,
        })
      : healthRouter)

  const mobileRouter =
    deps.v1Mobile ??
    (deps.providers || deps.getReadiness
      ? createV1Mobile({
          providers: resolvedProviders,
          mobileHealthRouter: deps.getReadiness
            ? createMobileHealthRouter({
                providers: resolvedProviders,
                getReadiness: deps.getReadiness,
              })
            : undefined,
        })
      : v1Mobile)

  // Root health probes (no auth, no /v1 prefix)
  app.route('/', rootHealth)

  // Platform administration routes require an approved profile, matching role, and protected identity context.
  const resolvedAdminRouter =
    deps.adminRouter ??
    (deps.providers ? createAdminRouter({ providers: resolvedProviders }) : adminRouter)
  app.route('/v1/admin', resolvedAdminRouter)

  // Public Student Authentication routes
  const resolvedStudentAuthRouter =
    deps.studentAuthRouter ??
    (deps.providers ? createStudentAuthRouter({ providers: resolvedProviders }) : studentAuthRouter)
  app.route('/v1/auth/student', resolvedStudentAuthRouter)
 
  const resolvedPasswordRouter =
    deps.passwordRouter ??
    (deps.providers ? createPasswordRouter({ providers: resolvedProviders }) : passwordRouter)
  app.route('/v1/auth/password', resolvedPasswordRouter)

  // Mobile API routes
  app.route('/v1/mobile', mobileRouter)

  // Error handler (must be last)
  app.onError(errorHandler)

  // 404 fallback
  app.notFound((c) =>
    c.json(
      { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Route not found.' } },
      404,
    ),
  )

  return app
}

const app = createApp()

export { app }
