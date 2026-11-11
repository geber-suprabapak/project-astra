import postgres, { type Sql } from 'postgres'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PostgresDomainStore } from '../../src/providers/postgres/domain-store.js'
import {
  cmsContentResources,
  validateCmsContentQuery,
  type CmsContentRow,
} from '../../src/modules/cms/content.js'
import type { CmsSession } from '../../src/modules/cms/schema.js'
import { cmsAlternateFormFixtures, cmsContentFixture } from '../helpers/cms-content.js'

const databaseUrl = process.env.CMS_CONTENT_TEST_DATABASE_URL
if (databaseUrl) {
  const target = new URL(databaseUrl)
  if (target.hostname !== '127.0.0.1' || target.pathname !== '/astra_cms_content_test') {
    throw new Error('CMS content tests require the isolated loopback test database.')
  }
}

describe.skipIf(!databaseUrl)('PostgreSQL CMS content adapter', () => {
  let sql: Sql
  let store: PostgresDomainStore
  const actor: CmsSession = {
    id: randomUUID(),
    full_name: 'Synthetic CMS SQL Actor',
    email: null,
    role: 'super_admin',
    jurusan_id: null,
    jurusan_slug: null,
    authz_version: 1,
  }
  const created: Array<{ resource: string; id: string }> = []
  beforeAll(async () => {
    sql = postgres(databaseUrl!, { max: 2 })
    store = new PostgresDomainStore({ sql })
    await sql`INSERT INTO cms.profiles(id,logto_subject,role,full_name,access_enabled)
      VALUES (${actor.id}, ${actor.id}, 'super_admin', ${actor.full_name}, true)`
  })
  afterAll(async () => {
    if (!sql) return
    for (const row of [...created].reverse())
      await sql`DELETE FROM ${sql('cms.' + row.resource)} WHERE id = ${row.id}`
    await sql`DELETE FROM cms.content_audit WHERE actor_id = ${actor.id}`
    await sql`DELETE FROM cms.profiles WHERE id = ${actor.id}`
    await sql.end()
  })

  it('matches literal case-insensitive name searches and keeps private fields out of public results', async () => {
    const marker = randomUUID()
    const row = await store.mutateCmsContent({
      resource: 'guru_staff',
      action: 'create',
      access: actor,
      data: {
        ...cmsContentFixture('guru_staff'),
        name: marker + ' 100% Match',
        is_published: true,
        nip: 'private',
      },
    })
    created.push({ resource: 'guru_staff', id: row.id })
    const query = validateCmsContentQuery('guru_staff', {
      search: marker.toUpperCase() + ' 100%',
      limit: 6,
    })
    const rows = await store.listCmsContent({ resource: 'guru_staff', access: null, query })
    expect(rows.map((item) => item.id)).toEqual([row.id])
    expect(rows[0]).not.toHaveProperty('nip')
  })
  it('rolls back all imported rows and their audit entries if a later row is invalid', async () => {
    const marker = randomUUID()
    const valid = { ...cmsContentFixture('agenda'), title: marker }
    await expect(
      store.importCmsContent({
        resource: 'agenda',
        access: actor,
        data: [valid, { ...valid, title: '' }],
      }),
    ).rejects.toMatchObject({ httpStatus: 422 })
    const rows = await sql`SELECT id FROM cms.agenda WHERE title = ${marker}`
    expect(rows).toHaveLength(0)
    const audit =
      await sql`SELECT id FROM cms.content_audit WHERE actor_id = ${actor.id} AND after_data ->> 'title' = ${marker}`
    expect(audit).toHaveLength(0)
  })

  it('counts all scoped rows independently of pagination and upserts news atomically by slug', async () => {
    const data = { ...cmsContentFixture('berita'), slug: randomUUID() }
    const first = await store.importCmsContent({
      resource: 'berita',
      access: actor,
      data: [data],
      upsert_by_slug: true,
    })
    const id = first[0]!.id
    created.push({ resource: 'berita', id })
    const second = await store.importCmsContent({
      resource: 'berita',
      access: actor,
      data: [{ ...data, title: 'Updated news' }],
      upsert_by_slug: true,
    })
    expect(second[0]!.id).toBe(id)
    expect(second[0]!.title).toBe('Updated news')
    const query = validateCmsContentQuery('berita', { slug: data.slug, limit: 1, offset: 100 })
    expect(await store.countCmsContent({ resource: 'berita', access: actor, query })).toBe(1)
  })

  it.each(cmsAlternateFormFixtures)(
    'persists actual alternate admin form payload for $resource',
    async (fixture) => {
      const row = await store.mutateCmsContent({
        resource: fixture.resource,
        action: 'create',
        data: fixture.data,
        access: actor,
      })
      created.push({ resource: fixture.resource, id: row.id })
      for (const [field, value] of Object.entries(fixture.data)) expect(row[field]).toEqual(value)
    },
  )

  it.each([...cmsContentResources.keys()])(
    'persists and reads the native relational resource %s',
    async (resource) => {
      const data = cmsContentFixture(resource)
      if (Object.hasOwn(data, 'slug')) data.slug = 'sql-' + randomUUID()
      const row = await store.mutateCmsContent({ resource, action: 'create', data, access: actor })
      created.push({ resource, id: row.id })
      expect(row.id).toMatch(/^[0-9a-f-]{36}$/)
      const records = await store.listCmsContent({
        resource,
        access: actor,
        query: validateCmsContentQuery(resource, { id: row.id }),
      })
      expect(records).toHaveLength(1)
      expect(records[0].id).toBe(row.id)
    },
  )

  it('updates a single field without resetting omitted data, then atomically records deletion', async () => {
    const data = {
      ...cmsContentFixture('galeri'),
      title: 'before',
      category: 'kept',
      is_published: true,
    }
    const row = await store.mutateCmsContent({
      resource: 'galeri',
      action: 'create',
      data,
      access: actor,
    })
    created.push({ resource: 'galeri', id: row.id })
    const updated = await store.mutateCmsContent({
      resource: 'galeri',
      action: 'update',
      id: row.id,
      data: { title: 'after' },
      access: actor,
    })
    expect(updated).toMatchObject({ title: 'after', category: 'kept', is_published: true })
    await store.mutateCmsContent({
      resource: 'galeri',
      action: 'delete',
      id: row.id,
      data: {},
      access: actor,
    })
    const audit = await sql<
      { action: string; before_data: CmsContentRow; after_data: CmsContentRow | null }[]
    >`
      SELECT action, before_data, after_data FROM cms.content_audit WHERE record_id = ${row.id} ORDER BY created_at`
    expect(audit.map((record) => record.action)).toEqual(['create', 'update', 'delete'])
    expect(audit[1].before_data.title).toBe('before')
    expect(audit[1].after_data?.title).toBe('after')
    expect(audit[2].after_data).toBeNull()
  })

  it('projects public data and hides unpublished/scheduled news at the SQL boundary', async () => {
    for (const [published, date] of [
      [false, '2000-01-01T00:00:00Z'],
      [true, '2999-01-01T00:00:00Z'],
      [true, '2000-01-01T00:00:00Z'],
    ] as const) {
      const row = await store.mutateCmsContent({
        resource: 'berita',
        action: 'create',
        access: actor,
        data: {
          ...cmsContentFixture('berita'),
          slug: 'sql-' + randomUUID(),
          is_published: published,
          published_at: date,
        },
      })
      created.push({ resource: 'berita', id: row.id })
      const rows = await store.listCmsContent({
        resource: 'berita',
        access: null,
        query: validateCmsContentQuery('berita', { id: row.id }),
      })
      expect(rows.length).toBe(published && date.startsWith('2000') ? 1 : 0)
    }
    const staff = await store.mutateCmsContent({
      resource: 'guru_staff',
      action: 'create',
      access: actor,
      data: {
        ...cmsContentFixture('guru_staff'),
        is_published: true,
        nip: 'private',
        phone: 'private',
        email: 'private@example.test',
      },
    })
    created.push({ resource: 'guru_staff', id: staff.id })
    const rows = await store.listCmsContent({
      resource: 'guru_staff',
      access: null,
      query: validateCmsContentQuery('guru_staff', { id: staff.id }),
    })
    expect(rows[0]).not.toHaveProperty('nip')
    expect(rows[0]).not.toHaveProperty('phone')
    expect(rows[0]).not.toHaveProperty('email')
  })

  it('rejects a stale or forged authority snapshot inside the write transaction', async () => {
    await expect(
      store.mutateCmsContent({
        resource: 'berita',
        action: 'create',
        data: cmsContentFixture('berita'),
        access: { ...actor, authz_version: actor.authz_version + 1 },
      }),
    ).rejects.toMatchObject({ httpStatus: 403 })
  })
})
