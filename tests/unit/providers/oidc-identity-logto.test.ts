import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { OidcIdentityProvider } from '../../../src/providers/identity/oidc-identity.js'
import { AppError } from '../../../src/lib/errors/app-error.js'
import { ErrorCode } from '../../../src/lib/errors/codes.js'

describe('OidcIdentityProvider — configured Logto operations', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  const configuredProvider = new OidcIdentityProvider({
    logtoEndpoint: 'http://localhost:3001',
    logtoAppId: 'test-app-id',
    logtoAppSecret: 'test-app-secret',
    jwtSecret: 'test-secret-at-least-32-chars-long-12345',
  })

  it.each([204, 404])(
    'revokes each session by UID and all associated grants, accepting HTTP %i',
    async (status) => {
      const mock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
        if (url.endsWith('/oidc/token')) return Response.json({ access_token: 'm2m-test-token' })
        if (url.endsWith('/sessions') && !options?.method)
          return Response.json({
            sessions: [
              { payload: { uid: 'session/one', jti: 'not-the-session-uid' } },
              { payload: { uid: 'session-two' } },
            ],
          })
        if (options?.method === 'DELETE' && url.includes('revokeGrantsTarget=all'))
          return new Response(null, { status })
        return new Response(null, { status: 404 })
      })
      globalThis.fetch = mock
      await expect(configuredProvider.revokeUserSessions('user-1')).resolves.toBeUndefined()
      expect(mock).toHaveBeenCalledWith(
        'http://localhost:3001/api/users/user-1/sessions/session%2Fone?revokeGrantsTarget=all',
        expect.objectContaining({ method: 'DELETE' }),
      )
      expect(mock.mock.calls.filter(([, options]) => options?.method === 'DELETE')).toHaveLength(2)
    },
  )

  it.each(['list', 'delete', 'malformed'])(
    'propagates session revocation %s failure rather than reporting success',
    async (stage) => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
        if (url.endsWith('/oidc/token')) return Response.json({ access_token: 'm2m-test-token' })
        if (options?.method === 'DELETE') return new Response(null, { status: 503 })
        return stage === 'list'
          ? new Response(null, { status: 503 })
          : Response.json(
              stage === 'malformed' ? {} : { sessions: [{ payload: { uid: 'session-one' } }] },
            )
      })
      await expect(configuredProvider.revokeUserSessions('user-1')).rejects.toThrow()
    },
  )

  it.each(['assignUserRole', 'revokeUserRole'] as const)(
    '%s resolves names to Logto role IDs',
    async (operation) => {
      const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
        if (url.endsWith('/oidc/token')) return Response.json({ access_token: 'm2m-test-token' })
        if (url.includes('/api/roles?'))
          return Response.json([{ id: 'opaque-student-id', name: 'student' }])
        if (
          operation === 'assignUserRole' &&
          options?.body === JSON.stringify({ roleIds: ['opaque-student-id'] })
        ) {
          return new Response(null, { status: 201 })
        }
        if (operation === 'revokeUserRole' && url.endsWith('/roles/opaque-student-id')) {
          return new Response(null, { status: 204 })
        }
        return new Response(null, { status: 400 })
      })
      globalThis.fetch = fetchMock
      await expect(configuredProvider[operation]('user-1', 'student')).resolves.toBeUndefined()
    },
  )

  it('does not mutate user roles when the requested role is missing', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/oidc/token')) return Response.json({ access_token: 'm2m-test-token' })
      return Response.json([])
    })
    globalThis.fetch = fetchMock
    await expect(configuredProvider.assignUserRole('user-1', 'student')).rejects.toThrow()
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('/api/users/'))).toBe(true)
  })

  it('creates student identities and assigns IDs through the supported roles endpoint', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/oidc/token')) return Response.json({ access_token: 'm2m-test-token' })
      if (url.includes('/api/roles?')) return Response.json([{ id: 'student-id', name: 'student' }])
      if (url.endsWith('/api/users')) return Response.json({ id: 'new-user' })
      if (
        url.endsWith('/api/users/new-user/roles') &&
        options?.body === JSON.stringify({ roleIds: ['student-id'] })
      ) {
        return new Response(null, { status: 204 })
      }
      return new Response(null, { status: 400 })
    })
    globalThis.fetch = fetchMock
    await expect(
      configuredProvider.createStudentIdentity({
        username: '24002',
        email: 'dummy@example.test',
        password: 'test-password',
        name: 'Dummy',
        roles: ['student'],
      }),
    ).resolves.toEqual({ userId: 'new-user' })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/users',
      expect.objectContaining({
        body: expect.not.stringContaining('roleNames'),
      }),
    )
  })

  it('reports bulk role assignment failure rather than returning success', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/oidc/token')) return Response.json({ access_token: 'm2m-test-token' })
      if (url.includes('/api/roles?')) return Response.json([{ id: 'student-id', name: 'student' }])
      return new Response(null, { status: 500 })
    })
    await expect(configuredProvider.assignRoles('user-1', ['student'])).rejects.toThrow(
      'Failed to assign roles',
    )
  })

  it('resolves a role on a later result page', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/oidc/token')) return Response.json({ access_token: 'm2m-test-token' })
      if (url.endsWith('&page=1'))
        return Response.json(
          Array.from({ length: 100 }, (_, i) => ({ id: `role-${i}`, name: `other-${i}` })),
        )
      if (url.endsWith('&page=2')) return Response.json([{ id: 'student-id', name: 'student' }])
      return new Response(null, { status: 201 })
    })
    await expect(configuredProvider.assignUserRole('user-1', 'student')).resolves.toBeUndefined()
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

  it('updatePassword succeeds and sends Authorization header', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL) => {
      if (String(url).endsWith('/oidc/token')) {
        return new Response(JSON.stringify({ access_token: 'm2m-test-token', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(null, { status: 200 })
    })
    globalThis.fetch = fetchMock

    await expect(configuredProvider.updatePassword('user-1', 'new-pass')).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/users/user-1/password',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          Authorization: 'Bearer m2m-test-token',
        }),
      }),
    )
  })

  it('updatePassword throws internal AppError when Logto returns non-200', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      if (String(url).endsWith('/oidc/token')) {
        return new Response(JSON.stringify({ access_token: 'm2m-test-token', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('Error', { status: 500 })
    })

    await expect(configuredProvider.updatePassword('user-1', 'new-pass')).rejects.toThrow(
      'Failed to update password in identity provider.',
    )
  })

  it('updateUserMetadata succeeds and sends Authorization header with wrapped customData', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL) => {
      if (String(url).endsWith('/oidc/token')) {
        return new Response(JSON.stringify({ access_token: 'm2m-test-token', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    })
    globalThis.fetch = fetchMock

    await expect(
      configuredProvider.updateUserMetadata('user-1', { avatar_url: 'avatar.jpg' }),
    ).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/users/user-1/custom-data',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          Authorization: 'Bearer m2m-test-token',
        }),
        body: JSON.stringify({ customData: { avatar_url: 'avatar.jpg' } }),
      }),
    )
  })

  it('updateUserMetadata throws internal AppError when Logto returns non-200', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      if (String(url).endsWith('/oidc/token')) {
        return new Response(JSON.stringify({ access_token: 'm2m-test-token', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('Error', { status: 500 })
    })

    await expect(
      configuredProvider.updateUserMetadata('user-1', { role: 'admin' }),
    ).rejects.toThrow('Failed to update user metadata in identity provider.')
  })
})
