import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../../src/app.js'
import { AppError } from '../../src/lib/errors/app-error.js'
import { MemoryDomainStore, MemoryIdentityProvider } from '../../src/providers/memory/index.js'
import type { CmsProfile } from '../../src/modules/cms/schema.js'
type CmsAccountPayload = {
  email?: string
  password?: string
  full_name?: string
  role?: string
  jurusan_id?: string | null
  jurusan_slug?: string | null
  access_enabled?: boolean
  logto_subject?: string
}

function environment() {
  const store = new MemoryDomainStore(),
    identityProvider = new MemoryIdentityProvider()
  for (const [subject, role] of [
    ['root', 'super_admin'],
    ['admin', 'admin'],
    ['hubin', 'admin_hubin'],
    ['student', 'siswa'],
  ] as const) {
    store.cmsProfiles.set(subject, {
      id: randomUUID(),
      logto_subject: subject,
      role,
      full_name: subject,
      email: `${subject}@example.test`,
      jurusan_id: null,
      jurusan_slug: null,
      authz_version: 1,
      access_enabled: true,
      session_valid_after: null,
    })
  }
  vi.spyOn(identityProvider, 'verifyToken').mockImplementation(async (token) => {
    if (!store.cmsProfiles.has(token)) throw AppError.authInvalid()
    return {
      userId: token,
      authSource: 'logto',
      issuedAt: Math.floor(Date.now() / 1000),
      scopes: ['cms:access'],
    }
  })
  const app = createApp({ providers: { domainStore: store, identityProvider } })
  const request = (path: string, token?: string, method = 'GET', data?: CmsAccountPayload) => {
    const headers = new Headers({ 'X-Astra-Contract-Version': 'v1' })
    if (token) headers.set('Authorization', `Bearer ${token}`)
    if (data) headers.set('Content-Type', 'application/json')
    return app.request('/v1/cms/accounts' + path, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
    })
  }
  return { store, identityProvider, request }
}
const input = {
  email: 'synthetic@example.test',
  password: 'Synthetic123!',
  full_name: 'Synthetic account',
  role: 'siswa',
}
describe('CMS native account lifecycle', () => {
  it('requires authentication and current account management authority', async () => {
    const env = environment()
    expect((await env.request('')).status).toBe(401)
    expect((await env.request('', 'student')).status).toBe(403)
    const created = vi.spyOn(env.identityProvider, 'createCmsIdentity')
    expect((await env.request('', 'student', 'POST', input)).status).toBe(403)
    expect(created).not.toHaveBeenCalled()
  })
  it('creates an explicit binding without storing a password or granting mobile authority', async () => {
    const env = environment()
    const response = await env.request('', 'root', 'POST', input)
    expect(response.status).toBe(201)
    const result = (await response.json()).data
    expect(result).toMatchObject({
      role: 'siswa',
      access_enabled: true,
      full_name: input.full_name,
    })
    expect(result).not.toHaveProperty('logto_subject')
    const profile = [...env.store.cmsProfiles.values()].find((row) => row.id === result.id)!
    expect(profile.logto_subject).not.toBe(profile.id)
    expect(env.identityProvider.users.get(profile.logto_subject)?.scopes).toEqual(['cms:access'])
    expect(env.identityProvider.suspendedUsers.has(profile.logto_subject)).toBe(false)
    expect(JSON.stringify([...env.store.cmsProfiles.values()])).not.toContain(input.password)
    expect(JSON.stringify(env.store.cmsContentAudit)).not.toContain(input.password)
    expect(
      (await env.request('', 'root', 'POST', { ...input, full_name: 'Must not overwrite' })).status,
    ).toBe(409)
    expect(env.store.cmsProfiles.get(profile.logto_subject)?.full_name).toBe(input.full_name)
  })
  it('leaves the identity and binding disabled when provisioning cannot finish', async () => {
    const env = environment()
    vi.spyOn(env.identityProvider, 'setUserSuspended').mockImplementation(async (id, suspended) => {
      if (!suspended) throw AppError.dependencyUnavailable('identity')
      env.identityProvider.suspendedUsers.add(id)
    })
    expect((await env.request('', 'root', 'POST', input)).status).toBe(503)
    const profile = [...env.store.cmsProfiles.values()].find((row) => row.email === input.email)!
    expect(profile.access_enabled).toBe(false)
    expect(env.identityProvider.suspendedUsers.has(profile.logto_subject)).toBe(true)
  })
  it('limits PKL administrators to operational accounts and denies privilege escalation', async () => {
    const env = environment()
    const response = await env.request('', 'hubin')
    expect((await response.json()).data.map((row: CmsProfile) => row.role)).toEqual(['siswa'])
    const create = vi.spyOn(env.identityProvider, 'createCmsIdentity')
    expect((await env.request('', 'hubin', 'POST', { ...input, role: 'super_admin' })).status).toBe(
      403,
    )
    expect((await env.request('', 'admin', 'POST', { ...input, role: 'super_admin' })).status).toBe(
      403,
    )
    expect(create).not.toHaveBeenCalled()
    const root = env.store.cmsProfiles.get('root')!
    expect(
      (await env.request(`/${root.id}`, 'hubin', 'PATCH', { access_enabled: false })).status,
    ).toBe(403)
    expect(
      (await env.request(`/${root.id}`, 'root', 'PATCH', { access_enabled: false })).status,
    ).toBe(409)
  })
  it('audits password reset attempts, revokes old sessions and never trusts an email lookup', async () => {
    const env = environment(),
      target = env.store.cmsProfiles.get('student')!
    const password = vi.spyOn(env.identityProvider, 'updatePassword').mockResolvedValue()
    const root = env.store.cmsProfiles.get('root')!
    expect(
      (await env.request(`/${root.id}/password`, 'hubin', 'POST', { password: input.password }))
        .status,
    ).toBe(404)
    expect(password).not.toHaveBeenCalled()
    const response = await env.request(`/${target.id}/password`, 'hubin', 'POST', {
      password: input.password,
    })
    expect(response.status).toBe(200)
    expect(password).toHaveBeenCalledWith('student', input.password)
    expect(await env.store.isSessionRevoked('student', Math.floor(Date.now() / 1000))).toBe(true)
    expect(env.store.cmsContentAudit.at(-1)).toMatchObject({
      resource: 'account_password',
      actor_id: env.store.cmsProfiles.get('hubin')!.id,
    })
    expect(JSON.stringify(env.store.cmsContentAudit)).not.toContain(input.password)
  })
  it('rejects unsupported roles without silently granting administrator privileges', async () => {
    const env = environment(),
      created = vi.spyOn(env.identityProvider, 'createCmsIdentity')
    expect(
      (await env.request('', 'root', 'POST', { ...input, role: 'read_only_reports' })).status,
    ).toBe(422)
    expect(created).not.toHaveBeenCalled()
  })
  it('bumps authority and keeps protected fields inaccessible to direct input', async () => {
    const env = environment(),
      target = env.store.cmsProfiles.get('student')!
    expect(
      (await env.request(`/${target.id}`, 'root', 'PATCH', { logto_subject: 'root' })).status,
    ).toBe(422)
    const response = await env.request(`/${target.id}`, 'root', 'PATCH', { access_enabled: false })
    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({ access_enabled: false, authz_version: 2 })
    expect(
      (await env.request('', 'root', 'POST', { ...input, role: 'admin_jurusan' })).status,
    ).toBe(422)
  })
})
