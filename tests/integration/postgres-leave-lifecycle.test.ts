import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { PostgresDomainStore } from '../../src/providers/postgres/domain-store.js'

describe.skipIf(!process.env.TEST_POSTGRES_URL)('PostgreSQL leave lifecycle', () => {
  const sql = postgres(process.env.TEST_POSTGRES_URL ?? '', { max: 1 })
  const store = new PostgresDomainStore({ sql })

  beforeAll(async () => {
    await sql`CREATE TEMP TABLE leave_requests (LIKE public.leave_requests INCLUDING DEFAULTS)`
    await sql`CREATE TEMP TABLE audit_logs (LIKE public.audit_logs INCLUDING DEFAULTS)`
    await sql`CREATE TEMP TABLE attendances (LIKE public.attendances INCLUDING DEFAULTS)`
    await sql`CREATE TEMP TABLE profiles (LIKE public.profiles INCLUDING DEFAULTS)`
    await sql`CREATE TEMP TABLE notification_outbox (LIKE public.notification_outbox INCLUDING DEFAULTS)`
  })

  afterAll(async () => {
    await sql.end()
  })

  async function pending() {
    const id = randomUUID()
    await sql`
      INSERT INTO leave_requests (id, user_id, category, description, status, date, approval_status)
      VALUES (${id}, 'qa-temporary-student', 'sakit', 'Temporary QA leave request', false,
              '2035-01-15T00:00:00+07:00', 'pending')
    `
    return id
  }

  it('rejects and reopens a pending request with typed null period fields and audit', async () => {
    const id = await pending()
    const rejected = await store.updateLeaveRequestStatus({
      id,
      approvalStatus: 'rejected',
      rejectionReason: 'Temporary QA rejection',
      audit: { actorId: 'qa-temporary-admin', action: 'reject_leave_request' },
    })
    expect(rejected).toMatchObject({ approval_status: 'rejected', duration_days: null })
    const reopened = await store.updateLeaveRequestStatus({
      id,
      approvalStatus: 'pending',
      rejectionReason: null,
      rejectedAt: null,
      audit: { actorId: 'qa-temporary-admin', action: 'reopen_leave_request' },
    })
    expect(reopened).toMatchObject({
      approval_status: 'pending',
      status: false,
      duration_days: null,
      original_end_date: null,
      effective_end_date: null,
      rejection_reason: null,
      rejected_at: null,
    })
    const [{ count }] =
      await sql`SELECT count(*)::int AS count FROM audit_logs WHERE entity_id = ${id}`
    expect(count).toBe(2)
  })

  it('approves an explicit three-day period using the WIB start date', async () => {
    const id = await pending()
    const approved = await store.updateLeaveRequestStatus({
      id,
      approvalStatus: 'approved',
      durationDays: 3,
    })
    expect(approved).toMatchObject({
      approval_status: 'approved',
      status: true,
      duration_days: 3,
      original_end_date: '2035-01-17',
      effective_end_date: '2035-01-17',
    })
  })

  it('round trips JSONB audit details and notification payloads, including legacy strings', async () => {
    const details = { result: 'completed', counts: { rows: 2 }, note: 'QA "dummy"' }
    const audit = await store.insertAuditLog({
      actor_id: 'qa-temporary-admin',
      action: 'qa_json',
      entity_type: 'qa',
      entity_id: 'json',
      details,
    })
    expect(audit.details).toEqual(details)
    const payload = { title: 'QA notification', body: 'Dummy payload', type: 'qa_json' }
    const notification = await store.enqueueNotification({
      userId: 'qa-temporary-student',
      channel: 'push',
      payload,
    })
    expect(notification.payload).toEqual(payload)
    const [stored] =
      await sql`SELECT jsonb_typeof(payload) AS kind FROM notification_outbox WHERE id = ${notification.id}`
    expect(stored.kind).toBe('object')

    await sql`UPDATE audit_logs SET details = ${sql.json(JSON.stringify(details))} WHERE id = ${audit.id}`
    await sql`UPDATE notification_outbox SET payload = ${sql.json(JSON.stringify(payload))} WHERE id = ${notification.id}`
    for (const args of [[], ['qa'], ['qa', 'json']] as const) {
      const rows = await store.getAuditLogs(...args)
      expect(rows.find((row) => row.id === audit.id)?.details).toEqual(details)
    }
    expect((await store.getNotificationById(notification.id))?.payload).toEqual(payload)
    const [legacy] =
      await sql`SELECT jsonb_typeof(payload) AS kind FROM notification_outbox WHERE id = ${notification.id}`
    expect(legacy.kind).toBe('string')
  })

  it('rolls back a rejection if its required audit insert fails', async () => {
    const id = await pending()
    await sql`ALTER TABLE audit_logs ADD CONSTRAINT qa_audit_failure CHECK (action <> 'reject_leave_request') NOT VALID`
    try {
      await expect(
        store.updateLeaveRequestStatus({
          id,
          approvalStatus: 'rejected',
          audit: { actorId: 'qa-temporary-admin', action: 'reject_leave_request' },
        }),
      ).rejects.toThrow()
      const [row] = await sql`SELECT approval_status FROM leave_requests WHERE id = ${id}`
      expect(row.approval_status).toBe('pending')
      const [{ count }] =
        await sql`SELECT count(*)::int AS count FROM audit_logs WHERE entity_id = ${id}`
      expect(count).toBe(0)
    } finally {
      await sql`ALTER TABLE audit_logs DROP CONSTRAINT qa_audit_failure`
    }
  })
})
