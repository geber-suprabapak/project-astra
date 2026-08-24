import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { auth } from '../../../src/middleware/auth.js'
import { errorHandler } from '../../../src/middleware/error-handler.js'
import { ErrorCode } from '../../../src/lib/errors/codes.js'
import type { AppEnv } from '../../../src/types/context.js'
import type { AppProviders, IdentityUser } from '../../../src/providers/types.js'
import { AppError } from '../../../src/lib/errors/app-error.js'

function createAuthApp() {
  const app = new Hono<AppEnv>()
  app.onError(errorHandler)
  app.use('*', auth)
  app.get('/test', (c) => c.json({ ok: true }))
  return app
}

describe('auth middleware', () => {
  it('throws AUTH_REQUIRED when no Authorization header', async () => {
    const app = createAuthApp()
    const res = await app.request('/test', { method: 'GET' })
    // SAFETY: error response body conforms to standard error envelope
    const body = (await res.json()) as { error: { code: string } }
    expect(res.status).toBe(401)
    expect(body.error.code).toBe(ErrorCode.AUTH_REQUIRED)
  })

  it('throws AUTH_REQUIRED when Authorization is not Bearer', async () => {
    const app = createAuthApp()
    const res = await app.request('/test', {
      method: 'GET',
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    })
    // SAFETY: error response body conforms to standard error envelope
    const body = (await res.json()) as { error: { code: string } }
    expect(res.status).toBe(401)
    expect(body.error.code).toBe(ErrorCode.AUTH_REQUIRED)
  })

  it('throws AUTH_INVALID for malformed JWT', async () => {
    const app = createAuthApp()
    const res = await app.request('/test', {
      method: 'GET',
      headers: { Authorization: 'Bearer invalid.jwt.token' },
    })
    // SAFETY: error response body conforms to standard error envelope
    const body = (await res.json()) as { error: { code: string } }
    expect(res.status).toBe(401)
    expect(body.error.code).toBe(ErrorCode.AUTH_INVALID)
  })

  it('uses legacy verification only for the mobile route and resolves its mapped target user', async () => {
    const legacyIdentity: IdentityUser = {
      userId: 'legacy-user-id',
      legacyUserId: 'legacy-user-id',
      authSource: 'legacy_supabase',
      roles: ['student'],
      scopes: ['legacy:mobile'],
    }
    const verifyLegacyToken = vi.fn().mockResolvedValue(legacyIdentity)
    // SAFETY: this middleware test exercises only the supplied identity and domain-store members.
    const providers = {
      identityProvider: {
        verifyToken: vi.fn().mockRejectedValue(AppError.authInvalid()),
        verifyLegacyToken,
      },
      domainStore: {
        resolveLegacyUserId: vi.fn().mockResolvedValue('logto-user-id'),
        isSessionRevoked: vi.fn().mockResolvedValue(false),
        getUserProfile: vi.fn().mockResolvedValue({
          user_id: 'logto-user-id',
          role: 'student',
          lifecycle_status: 'approved',
        }),
        getUserRoles: vi.fn().mockResolvedValue(['student']),
      },
    } as AppProviders
    const app = new Hono<AppEnv>()
    app.onError(errorHandler)
    app.use('*', async (c, next) => {
      c.set('providers', providers)
      await next()
    })
    app.use('*', auth)
    app.get('/v1/mobile/dashboard', (c) => c.json({ userId: c.get('userId') }))
    app.get('/v1/admin/users', (c) => c.json({ userId: c.get('userId') }))

    const mobileResponse = await app.request('/v1/mobile/dashboard', {
      headers: { Authorization: 'Bearer legacy-token' },
    })
    expect(mobileResponse.status).toBe(200)
    await expect(mobileResponse.json()).resolves.toEqual({ userId: 'logto-user-id' })

    const adminResponse = await app.request('/v1/admin/users', {
      headers: { Authorization: 'Bearer legacy-token' },
    })
    expect(adminResponse.status).toBe(401)
    expect(verifyLegacyToken).toHaveBeenCalledTimes(1)
  })
})
