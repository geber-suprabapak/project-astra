import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { SignJWT, type JWTPayload } from 'jose'
import { OidcIdentityProvider } from '../../../src/providers/identity/oidc-identity.js'
import { AppError } from '../../../src/lib/errors/app-error.js'
import { ErrorCode } from '../../../src/lib/errors/codes.js'

describe('OidcIdentityProvider', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('verifyToken', () => {
    const secret = new TextEncoder().encode('test-secret-at-least-32-chars-long-12345')

    async function createToken(claims: JWTPayload, audience = 'astra-api'): Promise<string> {
      return new SignJWT(claims)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('http://logto.test/oidc')
        .setAudience(audience)
        .setSubject('platform-admin-1')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(secret)
    }

    it('returns protected identity claims after issuer and audience verification', async () => {
      const provider = new OidcIdentityProvider({
        jwtSecret: new TextDecoder().decode(secret),
        issuer: 'http://logto.test/oidc',
        audience: 'astra-api',
      })
      const token = await createToken({
        email: 'admin@school.sch.id',
        roles: ['platform_admin'],
        scope: 'openid profile admin:read',
        amr: ['pwd', 'mfa'],
        must_change_password: false,
      })

      await expect(provider.verifyToken(token)).resolves.toEqual({
        userId: 'platform-admin-1',
        email: 'admin@school.sch.id',
        roles: ['platform_admin'],
        scopes: ['openid', 'profile', 'admin:read'],
        mfaVerified: true,
        mustChangePassword: false,
      })
    })
    it('does not infer MFA from a second-factor claim without password authentication', async () => {
      const provider = new OidcIdentityProvider({
        jwtSecret: new TextDecoder().decode(secret),
        issuer: 'http://logto.test/oidc',
        audience: 'astra-api',
      })
      const token = await createToken({
        roles: ['platform_admin'],
        scope: 'openid profile admin:read',
        amr: ['otp'],
        must_change_password: false,
      })

      const identity = await provider.verifyToken(token)

      expect(identity.mfaVerified).toBe(false)
    })

    it('rejects a signed token with the wrong audience', async () => {
      const provider = new OidcIdentityProvider({
        jwtSecret: new TextDecoder().decode(secret),
        issuer: 'http://logto.test/oidc',
        audience: 'astra-api',
      })
      const token = await createToken({}, 'chronos-api')

      await expect(provider.verifyToken(token)).rejects.toMatchObject({
        code: ErrorCode.AUTH_INVALID,
      })
    })
    it('rejects a token without a scope claim', async () => {
      const provider = new OidcIdentityProvider({
        jwtSecret: new TextDecoder().decode(secret),
        issuer: 'http://logto.test/oidc',
        audience: 'astra-api',
      })
      const token = await createToken({})

      await expect(provider.verifyToken(token)).rejects.toMatchObject({
        code: ErrorCode.AUTH_INVALID,
      })
    })
  })

  describe('unconfigured Logto operations fail strictly without fake success', () => {
    it('verifyPassword throws internal AppError when Logto is not configured', async () => {
      const provider = new OidcIdentityProvider({
        jwtSecret: 'test-secret-at-least-32-chars-long-12345',
      })

      await expect(provider.verifyPassword('student@school.sch.id', 'password123')).rejects.toThrow(
        'Identity provider management API is not configured.',
      )
    })

    it('updatePassword throws internal AppError when Logto is not configured', async () => {
      const provider = new OidcIdentityProvider({
        jwtSecret: 'test-secret-at-least-32-chars-long-12345',
      })

      await expect(provider.updatePassword('user-1', 'new-password123')).rejects.toThrow(
        'Identity provider management API is not configured.',
      )
    })

    it('updateUserMetadata throws internal AppError when Logto is not configured', async () => {
      const provider = new OidcIdentityProvider({
        jwtSecret: 'test-secret-at-least-32-chars-long-12345',
      })

      await expect(
        provider.updateUserMetadata('user-1', { avatar_url: 'avatar.jpg' }),
      ).rejects.toThrow('Identity provider management API is not configured.')
    })
  })

  describe('configured Logto operations', () => {
    const configuredProvider = new OidcIdentityProvider({
      logtoEndpoint: 'http://localhost:3001',
      logtoAppId: 'test-app-id',
      logtoAppSecret: 'test-app-secret',
      jwtSecret: 'test-secret-at-least-32-chars-long-12345',
    })

    it('verifyPassword succeeds when Logto verification endpoint returns 200', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))

      await expect(
        configuredProvider.verifyPassword('student@school.sch.id', 'correct-password'),
      ).resolves.toBeUndefined()
    })

    it('verifyPassword throws authInvalid 401 when Logto returns non-200', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(new Response('Invalid credentials', { status: 400 }))

      try {
        await configuredProvider.verifyPassword('student@school.sch.id', 'wrong-password')
        expect.unreachable()
      } catch (err) {
        expect(err).toBeInstanceOf(AppError)
        // SAFETY: err is verified as AppError by expect(err).toBeInstanceOf(AppError)
        const appErr = err as AppError
        expect(appErr.code).toBe(ErrorCode.AUTH_INVALID)
        expect(appErr.httpStatus).toBe(401)
      }
    })

    it('updatePassword throws internal AppError when Logto returns non-200', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('Error', { status: 500 }))

      await expect(configuredProvider.updatePassword('user-1', 'new-pass')).rejects.toThrow(
        'Failed to update password in identity provider.',
      )
    })

    it('updateUserMetadata throws internal AppError when Logto returns non-200', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('Error', { status: 500 }))

      await expect(
        configuredProvider.updateUserMetadata('user-1', { role: 'admin' }),
      ).rejects.toThrow('Failed to update user metadata in identity provider.')
    })
  })

  describe('checkHealth', () => {
    it('returns true when jwtSecret is configured', async () => {
      const provider = new OidcIdentityProvider({
        jwtSecret: 'test-secret-at-least-32-chars-long-12345',
      })

      const healthy = await provider.checkHealth()
      expect(healthy).toBe(true)
    })

    it('returns true when jwksUrl responds with 200 OK', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ keys: [] }), { status: 200 }))
      const provider = new OidcIdentityProvider({
        jwksUrl: 'http://localhost:3001/oidc/jwks',
      })

      const healthy = await provider.checkHealth()
      expect(healthy).toBe(true)
    })

    it('returns false when jwksUrl responds with non-200 or fails', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(new Response('Service Unavailable', { status: 503 }))
      const provider = new OidcIdentityProvider({
        jwksUrl: 'http://localhost:3001/oidc/jwks',
      })

      const healthy = await provider.checkHealth()
      expect(healthy).toBe(false)
    })

    it('returns false when jwksUrl fetch throws network error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'))
      const provider = new OidcIdentityProvider({
        jwksUrl: 'http://localhost:3001/oidc/jwks',
      })

      const healthy = await provider.checkHealth()
      expect(healthy).toBe(false)
    })

    it('returns false when neither jwksUrl nor jwtSecret is configured', async () => {
      const provider = new OidcIdentityProvider({
        jwtSecret: undefined,
        jwksUrl: undefined,
      })

      const healthy = await provider.checkHealth()
      expect(healthy).toBe(false)
    })
  })
})
