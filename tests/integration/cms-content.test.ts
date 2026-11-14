import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../../src/app.js'
import { AppError } from '../../src/lib/errors/app-error.js'
import {
  cmsContentResources,
  type CmsContentInput,
  type CmsContentRow,
} from '../../src/modules/cms/content.js'
import type { CmsProfile } from '../../src/modules/cms/schema.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../src/providers/memory/index.js'
import { cmsAlternateFormFixtures, cmsContentFixture } from '../helpers/cms-content.js'

function environment() {
  const store = new MemoryDomainStore()
  const identityProvider = new MemoryIdentityProvider()
  const objectStorage = new MemoryObjectStorage()
  const department = randomUUID()
  const users = new Map<string, CmsProfile>()
  for (const [subject, role] of [
    ['root', 'super_admin'],
    ['limited', 'admin_jurusan'],
    ['student', 'siswa'],
    ['journalist', 'jurnalistik'],
    ['hubin', 'admin_hubin'],
  ] as const) {
    const profile: CmsProfile = {
      id: randomUUID(),
      logto_subject: subject,
      full_name: `User ${subject}`,
      email: `${subject}@school.example`,
      role,
      jurusan_id: role === 'admin_jurusan' ? department : null,
      jurusan_slug: role === 'admin_jurusan' ? 'pplg' : null,
      authz_version: 1,
      access_enabled: true,
      session_valid_after: null,
    }
    users.set(subject, profile)
    store.cmsProfiles.set(subject, profile)
  }
  vi.spyOn(identityProvider, 'verifyToken').mockImplementation(async (token) => {
    const profile = users.get(token)
    if (!profile) throw AppError.authInvalid('Unknown user.')
    return {
      userId: profile.logto_subject,
      authSource: 'logto',
      issuedAt: Math.floor(Date.now() / 1000) - 10,
      scopes: ['cms:access'],
      roles: [profile.role],
    }
  })
  const app = createApp({ providers: { domainStore: store, identityProvider, objectStorage } })
  function request(path: string, method = 'GET', data?: CmsContentInput, token?: string) {
    const headers = new Headers({ 'X-Astra-Contract-Version': 'v1' })
    if (token) headers.set('Authorization', `Bearer ${token}`)
    if (data) headers.set('Content-Type', 'application/json')
    return app.request('/v1/cms' + path, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
    })
  }
  function seed(resource: string, data: CmsContentInput = {}): CmsContentRow {
    const row = {
      ...cmsContentFixture(resource),
      ...data,
      id: randomUUID(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    let table = store.cmsContent.get(resource)
    if (!table) {
      table = new Map()
      store.cmsContent.set(resource, table)
    }
    table.set(row.id, row)
    return row
  }
  return { store, users, department, request, seed, app }
}

describe('native CMS content API', () => {
  it('supports bounded literal name lookup without changing public field projection', async () => {
    const env = environment()
    const matching = env.seed('guru_staff', {
      name: 'Teacher 100% Match',
      is_published: true,
      nip: 'private',
    })
    env.seed('guru_staff', { name: 'Teacher ordinary', is_published: true })
    env.seed('guru_staff', { name: 'Teacher 100% Draft', is_published: false })
    const response = await env.request('/public/guru_staff?search=100%25&limit=6')
    expect(response.status).toBe(200)
    const result = (await response.json()).data
    expect(result.map((row: CmsContentRow) => row.id)).toEqual([matching.id])
    expect(result[0]).not.toHaveProperty('nip')
    expect((await env.request('/public/guru_staff?search=x')).status).toBe(422)
    expect((await env.request('/public/berita?search=example')).status).toBe(422)
    expect((await env.request('/public/jurusan?limit=1')).status).toBe(200)
  })
  it('imports rows atomically and rolls back audit entries on an invalid later row', async () => {
    const env = environment()
    const valid = cmsContentFixture('agenda')
    const rejected = await env.request(
      '/content/agenda/import',
      'POST',
      { rows: [valid, { ...valid, title: '' }] },
      'root',
    )
    expect(rejected.status).toBe(422)
    expect(env.store.cmsContent.get('agenda')?.size ?? 0).toBe(0)
    expect(env.store.cmsContentAudit).toHaveLength(0)
    const accepted = await env.request(
      '/content/agenda/import',
      'POST',
      { rows: [valid, { ...valid, title: 'Second agenda' }] },
      'root',
    )
    expect(accepted.status).toBe(201)
    expect((await accepted.json()).data.imported).toBe(2)
    expect(env.store.cmsContent.get('agenda')?.size).toBe(2)
    expect(env.store.cmsContentAudit).toHaveLength(2)
  })

  it('upserts Excel news imports by slug while retaining identity and auditing both changes', async () => {
    const env = environment()
    const data = cmsContentFixture('berita')
    const first = await env.request(
      '/content/berita/import',
      'POST',
      { rows: [data], upsert_by_slug: true },
      'root',
    )
    expect(first.status).toBe(201)
    const id = [...env.store.cmsContent.get('berita')!.keys()][0]
    const second = await env.request(
      '/content/berita/import',
      'POST',
      { rows: [{ ...data, title: 'Updated news' }], upsert_by_slug: true },
      'root',
    )
    expect(second.status).toBe(201)
    expect(env.store.cmsContent.get('berita')!.size).toBe(1)
    expect(env.store.cmsContent.get('berita')!.get(id!)?.title).toBe('Updated news')
    expect(env.store.cmsContentAudit.map((row) => row.action)).toEqual(['create', 'update'])
  })

  it.each(cmsAlternateFormFixtures)(
    'accepts actual alternate admin form payload for $resource',
    async (fixture) => {
      const env = environment()
      const response = await env.request(
        '/content/' + fixture.resource,
        'POST',
        fixture.data,
        'root',
      )
      expect(response.status).toBe(201)
      const row = (await response.json()).data
      for (const [field, value] of Object.entries(fixture.data)) expect(row[field]).toEqual(value)
    },
  )

  it('allows PKL administrators staff lookup fields without granting staff mutation', async () => {
    const env = environment(),
      staff = env.seed('guru_staff', { nip: 'Private employee identifier', is_published: false })
    const response = await env.request('/content/guru_staff/' + staff.id, 'GET', undefined, 'hubin')
    expect(response.status).toBe(200)
    expect((await response.json()).data.nip).toBe('Private employee identifier')
    expect(
      (
        await env.request(
          '/content/guru_staff/' + staff.id,
          'PATCH',
          { name: 'Forged edit' },
          'hubin',
        )
      ).status,
    ).toBe(403)
  })
  it('counts only visible data and excludes personal tracer fields from public reads', async () => {
    const env = environment()
    env.seed('agenda', { is_published: true })
    env.seed('agenda', { is_published: false })
    const count = await env.request('/content/agenda/count', 'GET', undefined, 'root')
    expect((await count.json()).data.total).toBe(2)
    const lookup = await env.request('/content/agenda/count', 'GET', undefined, 'limited')
    expect((await lookup.json()).data.total).toBe(1)
    env.seed('tracer_alumni', {
      is_published: true,
      name: 'Private name',
      salary_range: 'Private salary',
      company_or_campus: 'Private employer',
    })
    const publicRows = (await (await env.request('/public/tracer_alumni')).json()).data
    expect(publicRows[0]).not.toHaveProperty('name')
    expect(publicRows[0]).not.toHaveProperty('salary_range')
    expect(publicRows[0]).not.toHaveProperty('company_or_campus')
  })

  it.each([...cmsContentResources.keys()])(
    'creates, reads and audits the declared resource %s',
    async (resource) => {
      const env = environment()
      const response = await env.request(
        '/content/' + resource,
        'POST',
        cmsContentFixture(resource),
        'root',
      )
      expect(response.status).toBe(201)
      const body = await response.json()
      expect(body.data.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(env.store.cmsContentAudit).toHaveLength(1)
      expect(
        (await env.request(`/content/${resource}/${body.data.id}`, 'GET', undefined, 'root'))
          .status,
      ).toBe(200)
    },
  )

  it('never exposes drafts or scheduled news through public reads', async () => {
    const env = environment()
    env.seed('berita', { slug: 'draft', is_published: false, published_at: '2000-01-01T00:00:00Z' })
    env.seed('berita', {
      slug: 'scheduled',
      is_published: true,
      published_at: '2999-01-01T00:00:00Z',
    })
    const published = env.seed('berita', {
      slug: 'published',
      is_published: true,
      published_at: '2000-01-01T00:00:00Z',
    })
    const response = await env.request('/public/berita')
    expect(response.status).toBe(200)
    expect((await response.json()).data.map((row: CmsContentRow) => row.id)).toEqual([published.id])
    const denied = await env.request('/public/berita?is_published=false')
    expect((await denied.json()).data).toEqual([])
  })

  it('projects public staff fields without private identifiers or unregistered future columns', async () => {
    const env = environment()
    env.seed('guru_staff', {
      is_published: true,
      nip: 'private',
      phone: 'private',
      email: 'private',
      future_private: 'private',
    })
    const rows = (await (await env.request('/public/guru_staff')).json()).data
    expect(rows).toHaveLength(1)
    expect(rows[0]).not.toHaveProperty('nip')
    expect(rows[0]).not.toHaveProperty('phone')
    expect(rows[0]).not.toHaveProperty('email')
    expect(rows[0]).not.toHaveProperty('future_private')
  })

  it('enforces department ownership on reads and mutations, including aliases', async () => {
    const env = environment()
    const own = env.seed('jurusan_produk', { jurusan: 'RPL', is_published: true })
    const foreign = env.seed('jurusan_produk', {
      jurusan: 'akl',
      jurusan_id: randomUUID(),
      is_published: true,
    })
    const conflicting = env.seed('jurusan_produk', {
      jurusan: 'pplg',
      jurusan_id: randomUUID(),
      is_published: true,
    })
    const rows = (
      await (await env.request('/content/jurusan_produk', 'GET', undefined, 'limited')).json()
    ).data
    expect(rows.map((row: CmsContentRow) => row.id)).toEqual([own.id])
    for (const row of [foreign, conflicting]) {
      expect(
        (
          await env.request(
            '/content/jurusan_produk/' + row.id,
            'PATCH',
            { title: 'forged' },
            'limited',
          )
        ).status,
      ).toBe(404)
      expect(
        (await env.request('/content/jurusan_produk/' + row.id, 'DELETE', undefined, 'limited'))
          .status,
      ).toBe(404)
    }
    expect(
      (
        await env.request(
          '/content/jurusan_produk/' + own.id,
          'PATCH',
          { title: 'updated' },
          'limited',
        )
      ).status,
    ).toBe(200)
    expect(
      (
        await env.request(
          '/content/jurusan_produk/' + own.id,
          'PATCH',
          { jurusan: 'akl' },
          'limited',
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await env.request(
          '/content/jurusan_produk/' + own.id,
          'PATCH',
          { jurusan_id: null },
          'limited',
        )
      ).status,
    ).toBe(403)
  })

  it('does not let a department administrator create or delete departments', async () => {
    const env = environment()
    expect(
      (await env.request('/content/jurusan', 'POST', cmsContentFixture('jurusan'), 'limited'))
        .status,
    ).toBe(403)
    const row = env.seed('jurusan')
    expect(
      (await env.request('/content/jurusan/' + row.id, 'DELETE', undefined, 'limited')).status,
    ).toBe(403)
  })

  it('provides published lookup data without granting write permissions', async () => {
    const env = environment()
    const row = env.seed('jurusan', { is_published: true })
    env.seed('jurusan', { is_published: false })
    const response = await env.request('/content/jurusan', 'GET', undefined, 'student')
    expect((await response.json()).data.map((item: CmsContentRow) => item.id)).toEqual([row.id])
    expect(
      (await env.request('/content/berita', 'POST', cmsContentFixture('berita'), 'student')).status,
    ).toBe(403)
  })

  it('keeps journalism access limited to general news', async () => {
    const env = environment()
    const general = env.seed('berita', { page: 'umum' })
    const scoped = env.seed('berita', { page: 'pplg' })
    const rows = (
      await (await env.request('/content/berita', 'GET', undefined, 'journalist')).json()
    ).data
    expect(rows.map((row: CmsContentRow) => row.id)).toEqual([general.id])
    expect(
      (
        await env.request(
          '/content/berita/' + scoped.id,
          'PATCH',
          { title: 'forged' },
          'journalist',
        )
      ).status,
    ).toBe(404)
    expect(
      (await env.request('/content/berita/' + general.id, 'PATCH', { page: 'pplg' }, 'journalist'))
        .status,
    ).toBe(403)
  })

  it.each([
    '/public/profiles',
    '/public/constructor',
    '/content/pg_catalog',
    '/public/berita?select=*',
    '/public/berita?sort=role',
    '/public/berita?limit=101',
  ])('rejects undeclared resources/query capabilities %s', async (path) => {
    const env = environment()
    expect((await env.request(path, 'GET', undefined, 'root')).status).toBeGreaterThanOrEqual(400)
  })

  it('rejects immutable/unknown write fields and empty patches before changing data', async () => {
    const env = environment()
    const row = env.seed('berita')
    for (const data of [
      {},
      { id: randomUUID() },
      { created_at: '2000-01-01' },
      { authz_version: 100 },
    ]) {
      expect((await env.request('/content/berita/' + row.id, 'PATCH', data, 'root')).status).toBe(
        422,
      )
    }
    expect(env.store.cmsContentAudit).toHaveLength(0)
  })

  it('does not apply defaults to omitted fields in PATCH requests', async () => {
    const env = environment()
    const row = env.seed('galeri', {
      title: 'original',
      media_type: 'video',
      category: 'existing',
      is_published: true,
    })
    const response = await env.request(
      '/content/galeri/' + row.id,
      'PATCH',
      { title: 'updated' },
      'root',
    )
    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({
      title: 'updated',
      media_type: 'video',
      category: 'existing',
      is_published: true,
    })
    expect(env.store.cmsContentAudit[0].before).toMatchObject({ title: 'original' })
  })

  it('returns stable pagination with an explicit continuation flag', async () => {
    const env = environment()
    const first = env.seed('agenda', { sort_order: 1, is_published: true })
    const second = env.seed('agenda', { sort_order: 2, is_published: true })
    const response = await env.request('/public/agenda?limit=1&sort=created_at')
    const body = await response.json()
    expect(body.data).toHaveLength(1)
    expect(body.meta.pagination).toEqual({ limit: 1, offset: 0, has_more: true })
    const next = (
      await (await env.request('/public/agenda?limit=1&offset=1&sort=created_at')).json()
    ).data
    expect(new Set([body.data[0].id, next[0].id])).toEqual(new Set([first.id, second.id]))
  })

  it('supports multipart file uploads for authorized CMS operators', async () => {
    const env = environment()
    const form = new FormData()
    const validPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])
    const file = new File([validPng], 'sample-slide.png', { type: 'image/png' })
    form.append('file', file)
    form.append('folder', 'hero-slides')

    const response = await env.app.request('/v1/cms/uploads', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer root',
        'X-Astra-Contract-Version': 'v1',
      },
      body: form,
    })

    expect(response.status).toBe(201)
    const json = await response.json()
    expect(json.data.path).toMatch(/^cms\/hero-slides\/\d+-[a-z0-9]+\.png$/)
    expect(json.data.url).toContain(encodeURIComponent(json.data.path))

    // Rejects SVG uploads (XSS vector)
    const svgForm = new FormData()
    svgForm.append(
      'file',
      new File(
        ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
        'xss.svg',
        {
          type: 'image/svg+xml',
        },
      ),
    )
    const svgResponse = await env.app.request('/v1/cms/uploads', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer root',
        'X-Astra-Contract-Version': 'v1',
      },
      body: svgForm,
    })
    expect(svgResponse.status).toBe(422)

    // Rejects MIME spoofing when magic bytes do not match declared content type
    const spoofForm = new FormData()
    spoofForm.append(
      'file',
      new File(['<svg><script>alert(1)</script></svg>'], 'fake.png', { type: 'image/png' }),
    )
    const spoofResponse = await env.app.request('/v1/cms/uploads', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer root',
        'X-Astra-Contract-Version': 'v1',
      },
      body: spoofForm,
    })
    expect(spoofResponse.status).toBe(422)

    // Unauthorized role (e.g. student) is rejected
    const unauthResponse = await env.app.request('/v1/cms/uploads', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer student',
        'X-Astra-Contract-Version': 'v1',
      },
      body: form,
    })
    expect(unauthResponse.status).toBe(403)
  })
})
