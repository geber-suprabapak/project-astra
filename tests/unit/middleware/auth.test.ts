import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { auth } from '../../../src/middleware/auth.js'
import { errorHandler } from '../../../src/middleware/error-handler.js'
import { ErrorCode } from '../../../src/lib/errors/codes.js'
import type { AppEnv } from '../../../src/types/context.js'

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
    const body = await res.json() as { error: { code: string } }
    expect(res.status).toBe(401)
    expect(body.error.code).toBe(ErrorCode.AUTH_REQUIRED)
  })

  it('throws AUTH_REQUIRED when Authorization is not Bearer', async () => {
    const app = createAuthApp()
    const res = await app.request('/test', {
      method: 'GET',
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    })
    const body = await res.json() as { error: { code: string } }
    expect(res.status).toBe(401)
    expect(body.error.code).toBe(ErrorCode.AUTH_REQUIRED)
  })

  it('throws AUTH_INVALID for malformed JWT', async () => {
    const app = createAuthApp()
    const res = await app.request('/test', {
      method: 'GET',
      headers: { Authorization: 'Bearer invalid.jwt.token' },
    })
    const body = await res.json() as { error: { code: string } }
    expect(res.status).toBe(401)
    expect(body.error.code).toBe(ErrorCode.AUTH_INVALID)
  })
})