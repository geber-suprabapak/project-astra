import { describe, expect, it } from 'vitest'
import { SignJWT, type JWTPayload } from 'jose'
import { createApp } from '../../src/app.js'
import { OidcIdentityProvider } from '../../src/providers/identity/oidc-identity.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../src/providers/memory/index.js'
import type { RobinClient } from '../../src/clients/robin/client.js'
import type { IdentityProvider, ProfileLifecycleStatus } from '../../src/providers/types.js'

const robinClient: RobinClient = {
  checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
  getEnrollmentStatus: async () => ({
    status: 'not_enrolled',
    embeddingCount: 0,
    message: 'No enrollment found.',
  }),
  enroll: async () => ({
    status: 'ok',
    userId: 'platform-admin-1',
    samplesReceived: 0,
    embeddingsCreated: 0,
    message: 'Enrollment complete.',
  }),
  identify: async () => ({
    status: 'no_match',
    candidateId: null,
    confidence: 0,
    threshold: 0.7,
    qualityScore: 0,
    processTimeMs: 0,
  }),
  deleteEnrollment: async () => {},
}

function tokenFor(payload: JWTPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${encodedPayload}.signature`
}
const OIDC_SECRET = 'test-secret-at-least-32-chars-long-12345'

async function signedOidcToken(
  claims: JWTPayload,
  audience = 'astra-api',
  expirationTime: string | number = '5m',
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('http://logto.test/oidc')
    .setAudience(audience)
    .setSubject('platform-admin-1')
    .setIssuedAt()
    .setExpirationTime(expirationTime)
    .sign(new TextEncoder().encode(OIDC_SECRET))
}

function createPrivilegedApp(
  lifecycleStatus: ProfileLifecycleStatus = 'approved',
  identityProvider: IdentityProvider = new MemoryIdentityProvider(),
) {
  const domainStore = new MemoryDomainStore()
  domainStore.profiles.set('platform-admin-1', {
    user_id: 'platform-admin-1',
    full_name: 'Platform Admin',
    email: 'admin@school.sch.id',
    role: 'platform_admin',
    lifecycle_status: lifecycleStatus,
    gender: null,
  })

  return createApp({
    providers: {
      domainStore,
      objectStorage: new MemoryObjectStorage(),
      identityProvider,
      robinClient,
    },
  })
}

describe('integration: privileged identity boundary', () => {
  it('denies privileged administration until password change and MFA are complete', async () => {
    const app = createPrivilegedApp()
    const token = tokenFor({
      sub: 'platform-admin-1',
      roles: ['platform_admin'],
      scope: 'openid profile admin:read',
      must_change_password: true,
      mfa_verified: false,
    })

    const response = await app.request('/v1/admin/session', {
      headers: { Authorization: `Bearer ${token}` },
    })
    // SAFETY: error response body conforms to standard error envelope
    const body = (await response.json()) as { error: { code: string } }

    expect(response.status).toBe(403)
    expect(body.error.code).toBe('FORBIDDEN')
  })

  it('denies privileged administration when password state is absent', async () => {
    const app = createPrivilegedApp()
    const token = tokenFor({
      sub: 'platform-admin-1',
      roles: ['platform_admin'],
      scope: 'openid profile admin:read',
      mfa_verified: true,
    })

    const response = await app.request('/v1/admin/session', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(403)
  })

  it('accepts a privileged session only with matching role, approved profile, password, and MFA', async () => {
    const app = createPrivilegedApp()
    const token = tokenFor({
      sub: 'platform-admin-1',
      roles: ['platform_admin'],
      scope: 'openid profile admin:read',
      must_change_password: false,
      mfa_verified: true,
    })

    const response = await app.request('/v1/admin/session', {
      headers: { Authorization: `Bearer ${token}` },
    })
    // SAFETY: privileged session response has a stable success envelope
    const body = (await response.json()) as {
      success: boolean
      data: {
        user_id: string
        role: string | null
        profile_status: string
        mfa_verified: boolean
        must_change_password: boolean
      }
    }

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toEqual({
      user_id: 'platform-admin-1',
      role: 'platform_admin',
      profile_status: 'approved',
      mfa_verified: true,
      must_change_password: false,
    })
  })
  it('validates a signed OIDC token and protected claims at the HTTP boundary', async () => {
    const identityProvider = new OidcIdentityProvider({
      jwtSecret: OIDC_SECRET,
      issuer: 'http://logto.test/oidc',
      audience: 'astra-api',
    })
    const app = createPrivilegedApp('approved', identityProvider)
    const token = await signedOidcToken({
      email: 'admin@school.sch.id',
      roles: ['platform_admin'],
      scope: 'openid profile admin:read',
      mfa_verified: true,
      must_change_password: false,
    })

    const response = await app.request('/v1/admin/session', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(200)
  })

  it('rejects wrong-audience and expired signed tokens at the HTTP boundary', async () => {
    const identityProvider = new OidcIdentityProvider({
      jwtSecret: OIDC_SECRET,
      issuer: 'http://logto.test/oidc',
      audience: 'astra-api',
    })
    const app = createPrivilegedApp('approved', identityProvider)
    const claims = {
      roles: ['platform_admin'],
      scope: 'openid profile admin:read',
      mfa_verified: true,
      must_change_password: false,
    }

    const wrongAudience = await signedOidcToken(claims, 'chronos-api')
    const wrongAudienceResponse = await app.request('/v1/admin/session', {
      headers: { Authorization: `Bearer ${wrongAudience}` },
    })
    expect(wrongAudienceResponse.status).toBe(401)

    const expired = await signedOidcToken(claims, 'astra-api', Math.floor(Date.now() / 1000) - 60)
    const expiredResponse = await app.request('/v1/admin/session', {
      headers: { Authorization: `Bearer ${expired}` },
    })
    expect(expiredResponse.status).toBe(401)
  })

  it('denies a valid identity whose Astra profile is still pending', async () => {
    const app = createPrivilegedApp('pending')
    const token = tokenFor({
      sub: 'platform-admin-1',
      roles: ['platform_admin'],
      scope: 'openid profile admin:read',
      must_change_password: false,
      mfa_verified: true,
    })

    const response = await app.request('/v1/admin/session', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(403)
  })

  it.each(['pending', 'rejected', 'disabled'] as const)(
    'denies %s profiles at the public Astra boundary',
    async (lifecycleStatus) => {
      const app = createPrivilegedApp(lifecycleStatus)
      const token = tokenFor({ sub: 'platform-admin-1', scope: 'openid profile' })

      const response = await app.request('/v1/mobile/time', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(response.status).toBe(403)
    },
  )

  it('denies a token role that does not match the Astra profile role', async () => {
    const app = createPrivilegedApp()
    const token = tokenFor({
      sub: 'platform-admin-1',
      roles: ['teacher'],
      scope: 'openid profile admin:read',
      must_change_password: false,
      mfa_verified: true,
    })

    const response = await app.request('/v1/admin/session', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(403)
  })
})
