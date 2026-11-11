import postgres, { type Sql } from 'postgres'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  insertCmsAccount,
  listCmsAccounts,
  mutateCmsAccount,
} from '../../src/providers/postgres/cms-accounts.js'
import type { CmsSession } from '../../src/modules/cms/schema.js'
const databaseUrl = process.env.CMS_CONTENT_TEST_DATABASE_URL
if (databaseUrl) {
  const target = new URL(databaseUrl)
  if (target.hostname !== '127.0.0.1' || target.pathname !== '/astra_cms_content_test')
    throw new Error('Account tests require the isolated loopback test database.')
}
describe.skipIf(!databaseUrl)('PostgreSQL CMS account authority', () => {
  let sql: Sql
  const access: CmsSession = {
    id: randomUUID(),
    role: 'super_admin',
    full_name: 'Synthetic account admin',
    email: null,
    jurusan_id: null,
    jurusan_slug: null,
    authz_version: 1,
  }
  const created: string[] = []
  beforeAll(async () => {
    sql = postgres(databaseUrl!, { max: 2 })
    await sql`INSERT INTO cms.profiles(id,logto_subject,role,access_enabled) VALUES (${access.id},${access.id},${access.role},true)`
  })
  afterAll(async () => {
    if (!sql) return
    await sql`DELETE FROM cms.content_audit WHERE actor_id = ${access.id}`
    for (const id of created) await sql`DELETE FROM cms.profiles WHERE id = ${id}`
    await sql`DELETE FROM cms.profiles WHERE id = ${access.id}`
    await sql.end()
  })
  it('keeps new bindings disabled, versions changes and records audit atomically', async () => {
    const account = await insertCmsAccount(sql, {
      access,
      id: randomUUID(),
      subject: randomUUID(),
      data: { email: 'synthetic@example.test', full_name: 'Synthetic', role: 'siswa' },
    })
    created.push(account.id)
    expect(account.access_enabled).toBe(false)
    expect(account.authz_version).toBe(1)
    expect(account.created_at).toBeTruthy()
    const enabled = await mutateCmsAccount(sql, {
      access,
      id: account.id,
      data: { access_enabled: true },
    })
    expect(enabled.authz_version).toBe(2)
    expect(enabled.session_valid_after).toBeTruthy()
    expect(
      await listCmsAccounts(sql, { access, id: account.id, limit: 1, offset: 0 }),
    ).toMatchObject([{ id: account.id, access_enabled: true }])
    await mutateCmsAccount(sql, { access, id: account.id, data: {}, invalidate_sessions: true })
    const audits =
      await sql`SELECT resource, before_data, after_data FROM cms.content_audit WHERE actor_id = ${access.id} AND record_id = ${account.id} ORDER BY created_at`
    expect(audits).toHaveLength(3)
    expect(audits[2]!.resource).toBe('account_password')
  })
  it('rejects stale authority and invalid department changes without an audit write', async () => {
    const account = await insertCmsAccount(sql, {
      access,
      id: randomUUID(),
      subject: randomUUID(),
      data: { email: 'other@example.test', full_name: 'Other', role: 'siswa' },
    })
    created.push(account.id)
    await expect(
      mutateCmsAccount(sql, {
        access: { ...access, authz_version: 100 },
        id: account.id,
        data: { access_enabled: true },
      }),
    ).rejects.toMatchObject({ httpStatus: 403 })
    await expect(
      mutateCmsAccount(sql, {
        access,
        id: account.id,
        data: { role: 'admin_jurusan', jurusan_id: randomUUID(), jurusan_slug: 'pplg' },
      }),
    ).rejects.toMatchObject({ httpStatus: 422 })
    const audits =
      await sql`SELECT id FROM cms.content_audit WHERE actor_id = ${access.id} AND record_id = ${account.id}`
    expect(audits).toHaveLength(1)
    expect(
      (await listCmsAccounts(sql, { access, id: account.id, limit: 1, offset: 0 }))[0],
    ).toMatchObject({ role: 'siswa', access_enabled: false, authz_version: 1 })
  })
})
