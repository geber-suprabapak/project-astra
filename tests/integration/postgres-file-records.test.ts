import { afterAll, describe, expect, it } from 'vitest'
import postgres, { type Sql } from 'postgres'
import { PostgresDomainStore } from '../../src/providers/postgres/domain-store.js'

describe.skipIf(!process.env.TEST_POSTGRES_URL)('PostgreSQL file-size boundary', () => {
  const sql = postgres(process.env.TEST_POSTGRES_URL ?? '', { max: 1 })

  afterAll(async () => {
    await sql.end()
  })

  it.each([0, 25_391, 5 * 1024 * 1024, null])(
    'returns numeric/null size %s across file creation, read, list and lifecycle update',
    async (sizeBytes) => {
      await sql.begin(async (tx) => {
        await tx`CREATE TEMP TABLE files (LIKE public.files INCLUDING DEFAULTS) ON COMMIT DROP`
        const [namespace] = await tx`
          SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE c.oid='files'::regclass
        `
        expect(namespace.nspname).toMatch(/^pg_temp_/)
        // SAFETY: These adapter methods use the tagged query interface on this pinned transaction.
        const store = new PostgresDomainStore({ sql: tx as Sql })
        const created = await store.createFileRecord({
          userId: 'qa-temporary-file-user',
          purpose: 'permit_attachment',
          objectPath: 'qa-temporary-file-user/note.png',
          contentType: 'image/png',
          sizeBytes: sizeBytes ?? undefined,
          lifecycle: 'pending_upload',
        })
        expect(created.size_bytes).toBe(sizeBytes)
        expect((await store.getFileRecord(created.id))?.size_bytes).toBe(sizeBytes)
        const listed = await store.listFiles({ userId: 'qa-temporary-file-user' })
        expect(listed).toHaveLength(1)
        expect(listed[0].size_bytes).toBe(sizeBytes)
        const available = await store.updateFileLifecycle(created.id, 'available')
        expect(available.size_bytes).toBe(sizeBytes)
        expect(available.lifecycle).toBe('available')
      })
    },
  )
})
