import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { PostgresDomainStore } from '../../src/providers/postgres/domain-store.js'

describe.skipIf(!process.env.TEST_POSTGRES_URL)('PostgreSQL Manual Attendance transaction', () => {
  const sql = postgres(process.env.TEST_POSTGRES_URL ?? '', { max: 1 })
  const store = new PostgresDomainStore({ sql })

  beforeAll(async () => {
    await sql`CREATE TEMP TABLE leave_requests (LIKE public.leave_requests INCLUDING DEFAULTS)`
    await sql`CREATE TEMP TABLE attendances (LIKE public.attendances INCLUDING DEFAULTS)`
    await sql`CREATE TEMP TABLE audit_logs (LIKE public.audit_logs INCLUDING DEFAULTS)`
  })

  afterAll(async () => {
    await sql.end()
  })

  it('commits Attendance with its audit and rolls both back when the audit insert fails', async () => {
    const successfulUserId = randomUUID()
    const successful = await store.createManualAttendance({
      userId: successfulUserId,
      actionType: 'check_in',
      status: 'Hadir',
      date: '2035-01-15',
      reason: 'Disposable PostgreSQL transaction check',
      attemptId: 'qa-attempt-success',
      actorId: 'qa-temporary-admin',
    })

    const successfulAudit = await sql`
      SELECT count(*)::int AS count FROM audit_logs
      WHERE action = 'create_manual_attendance' AND entity_id = ${successful.id}
    `
    expect(successfulAudit[0].count).toBe(1)

    await sql`ALTER TABLE audit_logs ADD CONSTRAINT qa_manual_attendance_audit_failure
      CHECK (action <> 'create_manual_attendance') NOT VALID`

    const failedUserId = randomUUID()
    await expect(
      store.createManualAttendance({
        userId: failedUserId,
        actionType: 'check_in',
        status: 'Hadir',
        date: '2035-01-15',
        reason: 'Disposable PostgreSQL rollback check',
        attemptId: 'qa-attempt-failure',
        actorId: 'qa-temporary-admin',
      }),
    ).rejects.toThrow('An unexpected database error occurred.')

    const failedAttendance = await sql`
      SELECT count(*)::int AS count FROM attendances WHERE user_id = ${failedUserId}
    `
    const auditCount = await sql`
      SELECT count(*)::int AS count FROM audit_logs WHERE action = 'create_manual_attendance'
    `
    expect(failedAttendance[0].count).toBe(0)
    expect(auditCount[0].count).toBe(1)
  })
})
