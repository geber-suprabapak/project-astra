import { afterEach, describe, expect, it, vi } from 'vitest'
import { OidcIdentityProvider } from '../../src/providers/identity/oidc-identity.js'
const options = {
  logtoEndpoint: 'https://identity.example.test',
  logtoAppId: 'synthetic',
  logtoAppSecret: 'synthetic',
  logtoCmsAccessRoleName: 'cms-access-only',
}
afterEach(() => vi.unstubAllGlobals())
describe('CMS Logto provisioning boundary', () => {
  it('creates suspended identities and adds only the operator-configured CMS access role', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ access_token: 'synthetic-management-token', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(Response.json([{ id: 'cms-role', name: 'cms-access-only' }]))
      .mockResolvedValueOnce(Response.json({ id: 'new-subject' }))
      .mockResolvedValueOnce(Response.json({ roleIds: ['cms-role'] }, { status: 201 }))
    vi.stubGlobal('fetch', fetch)
    const identity = new OidcIdentityProvider(options)
    expect(
      await identity.createCmsIdentity({
        email: 'synthetic@example.test',
        fullName: 'Synthetic',
        password: 'Synthetic123!',
      }),
    ).toEqual({ userId: 'new-subject' })
    const created = fetch.mock.calls[2]
    expect(created[0]).toBe('https://identity.example.test/api/users')
    expect(JSON.parse(created[1].body)).toEqual({
      primaryEmail: 'synthetic@example.test',
      name: 'Synthetic',
      password: 'Synthetic123!',
      isSuspended: true,
    })
    expect(fetch.mock.calls[3][0]).toBe('https://identity.example.test/api/users/new-subject/roles')
    expect(fetch.mock.calls[3][1].method).toBe('POST')
    expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({ roleIds: ['cms-role'] })
  })
  it('never returns a fabricated identity without management configuration', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const identity = new OidcIdentityProvider({
      logtoEndpoint: undefined,
      logtoAppId: undefined,
      logtoAppSecret: undefined,
    })
    await expect(
      identity.createCmsIdentity({
        email: 'synthetic@example.test',
        fullName: 'Synthetic',
        password: 'Synthetic123!',
      }),
    ).rejects.toMatchObject({ httpStatus: 503 })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not search for or overwrite an existing identity on creation conflict', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'synthetic-management-token' }))
      .mockResolvedValueOnce(Response.json([{ id: 'cms-role', name: 'cms-access-only' }]))
      .mockResolvedValueOnce(Response.json({}, { status: 409 }))
    vi.stubGlobal('fetch', fetch)
    await expect(
      new OidcIdentityProvider(options).createCmsIdentity({
        email: 'synthetic@example.test',
        fullName: 'Synthetic',
        password: 'Synthetic123!',
      }),
    ).rejects.toMatchObject({ httpStatus: 409 })
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})
