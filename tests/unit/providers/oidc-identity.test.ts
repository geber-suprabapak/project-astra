import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { SignJWT, type JWTPayload } from 'jose'
import {
  getOidcVerificationFailureMetadata,
  OidcIdentityProvider,
} from '../../../src/providers/identity/oidc-identity.js'
import { ErrorCode } from '../../../src/lib/errors/codes.js'

describe('OidcIdentityProvider', () => {
  it('records only an allowlisted failed claim without raw token or error message', () => {
    const error = Object.assign(new Error('token-value-must-not-be-logged'), {
      code: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
      claim: 'aud',
      payload: { scope: 'sensitive-scope-value' },
    })

    expect(getOidcVerificationFailureMetadata(error)).toEqual({
      name: 'Error',
      code: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
      claim: 'aud',
    })
  })

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
        scope: 'openid profile mobile:access admin:read',
        amr: ['pwd', 'mfa'],
        must_change_password: false,
      })

      await expect(provider.verifyToken(token)).resolves.toEqual({
        userId: 'platform-admin-1',
        authSource: 'logto',
        issuedAt: expect.any(Number),
        email: 'admin@school.sch.id',
        roles: ['platform_admin'],
        scopes: ['openid', 'profile', 'mobile:access', 'admin:read'],
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

  describe('verifyLegacyToken', () => {
    const legacySecret = new TextEncoder().encode('legacy-test-secret-at-least-32-chars-long')
    const legacyUserId = 'd2b0ed61-56bf-4d9e-9329-7c1014db6b5c'

    async function createLegacyToken(role = 'siswa', expiresIn = '5m'): Promise<string> {
      return new SignJWT({ app_metadata: { role }, email: 'student@school.sch.id' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('https://supabase.test/auth/v1')
        .setAudience('authenticated')
        .setSubject(legacyUserId)
        .setIssuedAt()
        .setExpirationTime(expiresIn)
        .sign(legacySecret)
    }

    it('accepts only a valid student Supabase token before the fixed bridge expiry', async () => {
      const provider = new OidcIdentityProvider({
        legacyJwtSecret: new TextDecoder().decode(legacySecret),
        legacyIssuer: 'https://supabase.test/auth/v1',
        legacyAudience: 'authenticated',
        legacyBridgeExpiresAt: '2099-01-01T00:00:00.000Z',
      })

      await expect(provider.verifyLegacyToken(await createLegacyToken())).resolves.toEqual({
        userId: legacyUserId,
        legacyUserId,
        authSource: 'legacy_supabase',
        email: 'student@school.sch.id',
        roles: ['student'],
        scopes: ['legacy:mobile'],
        mfaVerified: false,
      })
    })

    it('rejects a non-student legacy token even when it is correctly signed', async () => {
      const provider = new OidcIdentityProvider({
        legacyJwtSecret: new TextDecoder().decode(legacySecret),
        legacyIssuer: 'https://supabase.test/auth/v1',
        legacyBridgeExpiresAt: '2099-01-01T00:00:00.000Z',
      })

      await expect(
        provider.verifyLegacyToken(await createLegacyToken('admin')),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      })
    })

    it('rejects legacy tokens after the configured bridge deadline', async () => {
      const provider = new OidcIdentityProvider({
        legacyJwtSecret: new TextDecoder().decode(legacySecret),
        legacyIssuer: 'https://supabase.test/auth/v1',
        legacyBridgeExpiresAt: '2020-01-01T00:00:00.000Z',
      })

      await expect(provider.verifyLegacyToken(await createLegacyToken())).rejects.toMatchObject({
        code: ErrorCode.AUTH_INVALID,
      })
    })
  })

  describe('unconfigured Logto operations fail strictly without fake success', () => {
    it('session revocation rejects missing management credentials', async () => {
      const provider = new OidcIdentityProvider({
        jwtSecret: 'test-secret-at-least-32-chars-long-12345',
      })
      await expect(provider.revokeUserSessions('user-1')).rejects.toThrow(
        'Identity provider management API is not configured.',
      )
    })
    it('bulk role assignment rejects missing management credentials', async () => {
      const provider = new OidcIdentityProvider({
        jwtSecret: 'test-secret-at-least-32-chars-long-12345',
      })
      await expect(provider.assignRoles('user-1', ['staff'])).rejects.toThrow(
        'Identity provider management API is not configured.',
      )
    })

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
