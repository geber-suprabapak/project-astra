import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../../src/app.js'
import { AppError } from '../../src/lib/errors/app-error.js'
import type { CmsProfile } from '../../src/modules/cms/schema.js'
import { cmsRoleSchema } from '../../src/modules/cms/schema.js'
import { MemoryDomainStore, MemoryIdentityProvider } from '../../src/providers/memory/index.js'
import type { IdentityUser } from '../../src/providers/types.js'

function environment() {
  const store = new MemoryDomainStore()
  const identityProvider = new MemoryIdentityProvider()
  const identity: IdentityUser = {
    userId: 'logto-cms-user',
    authSource: 'logto',
    issuedAt: Math.floor(Date.now() / 1000) - 10,
    scopes: ['cms:access'],
    roles: ['platform_admin'],
  }
  const profile: CmsProfile = {
    id: 'b1000000-0000-4000-8000-000000000001',
    logto_subject: identity.userId,
    full_name: 'Synthetic CMS User',
    email: 'cms@example.test',
    role: 'siswa',
    jurusan_id: null,
    jurusan_slug: null,
    authz_version: 1,
    access_enabled: true,
    session_valid_after: null,
  }
  store.cmsProfiles.set(identity.userId, profile)
  const verifyToken = vi
    .spyOn(identityProvider, 'verifyToken')
    .mockImplementation(async () => identity)
  const legacy = vi.fn()
  Object.assign(identityProvider, { verifyLegacyToken: legacy })
  const app = createApp({ providers: { domainStore: store, identityProvider } })
  function request(authorization: string | null = 'Bearer test-token') {
    const headers = new Headers({ 'X-Astra-Contract-Version': 'v1' })
    if (authorization !== null) headers.set('Authorization', authorization)
    return app.request('/v1/cms/session', { headers })
  }
  return { store, identity, profile, verifyToken, legacy, request, app }
}

describe('CMS identity/session boundary', () => {
  it('uses the explicitly bound CMS role without granting Logto platform_admin permissions', async () => {
    const env = environment()
    const response = await env.request()
    expect(response.status).toBe(200)
    expect(response.headers.get('x-astra-contract-version')).toBe('v1')
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await response.json()
    expect(body.data).toEqual({
      id: env.profile.id,
      full_name: env.profile.full_name,
      email: env.profile.email,
      role: 'siswa',
      jurusan_id: null,
      jurusan_slug: null,
      authz_version: 1,
    })
    expect(env.store.profiles.size).toBe(0)
    expect(env.legacy).not.toHaveBeenCalled()
  })

  it.each([null, 'Basic credentials', 'Bearer '])(
    'rejects missing/invalid bearer authorization %s',
    async (header) => {
      const env = environment()
      expect((await env.request(header)).status).toBe(401)
      expect(env.verifyToken).not.toHaveBeenCalled()
    },
  )

  it('does not fall back to Supabase token verification', async () => {
    const env = environment()
    env.verifyToken.mockRejectedValue(AppError.authInvalid())
    expect((await env.request()).status).toBe(401)
    expect(env.legacy).not.toHaveBeenCalled()
  })

  it.each(['legacy_supabase', undefined] as const)(
    'rejects untrusted identity source %s',
    async (source) => {
      const env = environment()
      env.identity.authSource = source
      expect((await env.request()).status).toBe(401)
    },
  )

  it.each([[], ['mobile:access', 'admin:read']])(
    'does not accept unrelated scopes %j',
    async (scopes) => {
      const env = environment()
      env.identity.scopes = scopes
      const lookup = vi.spyOn(env.store, 'getCmsProfileBySubject')
      expect((await env.request()).status).toBe(403)
      expect(lookup).not.toHaveBeenCalled()
    },
  )

  it.each([undefined, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER])(
    'rejects invalid token iat %s',
    async (iat) => {
      const env = environment()
      env.identity.issuedAt = iat
      expect((await env.request()).status).toBe(401)
    },
  )

  it('requires an explicit identity binding; matching display email grants nothing', async () => {
    const env = environment()
    env.store.cmsProfiles.clear()
    env.identity.email = env.profile.email
    expect((await env.request()).status).toBe(403)
    expect(env.store.cmsProfiles.size).toBe(0)
  })

  it('rejects a profile returned for a different identity', async () => {
    const env = environment()
    env.profile.logto_subject = 'other-subject'
    expect((await env.request()).status).toBe(403)
  })

  it('reads current authority so disablement takes effect without waiting for token expiry', async () => {
    const env = environment()
    expect((await env.request()).status).toBe(200)
    env.profile.access_enabled = false
    expect((await env.request()).status).toBe(403)
  })

  it('honors global session revocation by verified Logto subject', async () => {
    const env = environment()
    env.store.revokedSessions.set(env.identity.userId, Date.now())
    expect((await env.request()).status).toBe(401)
  })

  it('rejects revoked sessions, including tokens issued in the same second', async () => {
    const env = environment()
    env.profile.session_valid_after = new Date(env.identity.issuedAt! * 1000).toISOString()
    expect((await env.request()).status).toBe(401)
    env.profile.session_valid_after = new Date(env.identity.issuedAt! * 1000 + 250).toISOString()
    expect((await env.request()).status).toBe(401)
    env.profile.session_valid_after = new Date(env.identity.issuedAt! * 1000 - 1).toISOString()
    expect((await env.request()).status).toBe(200)
  })

  it('fails closed for an admin_jurusan without both protected department bindings', async () => {
    const env = environment()
    env.profile.role = 'admin_jurusan'
    expect((await env.request()).status).toBe(403)
    env.profile.jurusan_slug = 'pplg'
    expect((await env.request()).status).toBe(403)
    env.profile.jurusan_id = 'b1000000-0000-4000-8000-000000000002'
    expect((await env.request()).status).toBe(200)
  })

  it.each(cmsRoleSchema.options)('preserves supported CMS role %s', async (role) => {
    const env = environment()
    env.profile.role = role
    env.profile.jurusan_slug = 'pplg'
    env.profile.jurusan_id = 'b1000000-0000-4000-8000-000000000002'
    const response = await env.request()
    expect(response.status).toBe(200)
    expect((await response.json()).data.role).toBe(role)
  })

  it('rejects unsupported contract versions before verifying identity', async () => {
    const env = environment()
    const response = await env.app.request('/v1/cms/session', {
      headers: { Authorization: 'Bearer test', 'X-Astra-Contract-Version': 'v2' },
    })
    expect(response.status).toBe(426)
    expect(env.verifyToken).not.toHaveBeenCalled()
  })
})
