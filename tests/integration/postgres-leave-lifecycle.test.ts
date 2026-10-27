import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { PostgresDomainStore } from '../../src/providers/postgres/domain-store.js'

describe.skipIf(!process.env.TEST_POSTGRES_URL)('PostgreSQL leave lifecycle', () => {
  const queries: string[] = []
  const sql = postgres(process.env.TEST_POSTGRES_URL ?? '', {
    max: 1,
    debug: (_connection, query) => {
      queries.push(query)
    },
  })
  const store = new PostgresDomainStore({ sql })

  beforeAll(async () => {
    await sql`CREATE TEMP TABLE leave_requests (LIKE public.leave_requests INCLUDING DEFAULTS)`
    await sql`CREATE TEMP TABLE audit_logs (LIKE public.audit_logs INCLUDING DEFAULTS)`
    await sql`CREATE TEMP TABLE attendances (LIKE public.attendances INCLUDING DEFAULTS)`
    await sql`CREATE TEMP TABLE profiles (LIKE public.profiles INCLUDING DEFAULTS)`
    await sql`CREATE TEMP TABLE notification_outbox (LIKE public.notification_outbox INCLUDING DEFAULTS)`
    for (const table of ['students', 'student_bindings', 'class_enrollments', 'classes']) {
      await sql.unsafe(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS)`)
    }
    const [namespace] =
      await sql`SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid='leave_requests'::regclass`
    expect(namespace.nspname).toMatch(/^pg_temp_/)
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

  it('projects canonical bound student fields in one query per read, preserving write status and legacy fallback', async () => {
    const uid = 'qa-canonical-leave-user',
      nis = '73001',
      studentId = randomUUID(),
      classId = randomUUID(),
      periodId = randomUUID()
    await sql`INSERT INTO profiles (user_id,full_name,nis,class_name,absence_number,role,lifecycle_status) VALUES (${uid},'Legacy Name',${nis},'Legacy Class','9','student','approved')`
    await sql`INSERT INTO students (id,nis,full_name,gender) VALUES (${studentId},${nis},'Canonical Name','P')`
    await sql`INSERT INTO student_bindings (student_id,user_id) VALUES (${studentId},${uid})`
    await sql`INSERT INTO classes (id,school_id,academic_period_id,name) VALUES (${classId},${randomUUID()},${periodId},'Canonical Class')`
    await sql`INSERT INTO class_enrollments (student_id,user_id,class_id,academic_period_id,absence_number,status,created_at) VALUES (${studentId},${uid},${classId},${randomUUID()},'8','active','2034-07-01T00:00:00Z'),(${studentId},${uid},${classId},${periodId},'2','active','2034-08-01T00:00:00Z')`
    const created = await store.createLeaveRequest({
      user_id: uid,
      category: 'sakit',
      description: 'Temporary canonical projection',
      date: '2035-02-01',
    })
    let start = queries.length
    const detail = await store.getLeaveRequestById(created.id)
    expect(queries.length - start).toBe(1)
    start = queries.length
    const collection = await store.listLeaveRequests({ userId: uid })
    expect(queries.length - start).toBe(1)
    expect(collection).toHaveLength(1)
    for (const row of [created, detail, ...collection]) {
      expect(row).toMatchObject({
        student_name: 'Canonical Name',
        student_class: 'Canonical Class',
        student_nis: nis,
        absence_number: '2',
      })
    }
    const updated = await store.updateLeaveRequestStatus({
      id: created.id,
      approvalStatus: 'rejected',
      rejectionReason: 'Temporary QA rejection',
    })
    expect(updated).toMatchObject({
      approval_status: 'rejected',
      status: false,
      absence_number: '2',
    })
    await sql`INSERT INTO profiles (user_id,full_name,nis,role,lifecycle_status) VALUES ('qa-other-user','Other Student','73002','student','approved')`
    await sql`UPDATE student_bindings SET user_id='qa-other-user' WHERE student_id=${studentId}`
    expect(await store.getLeaveRequestById(created.id)).toMatchObject({
      student_name: 'Legacy Name',
      student_class: 'Legacy Class',
      absence_number: '9',
    })
    await sql`UPDATE student_bindings SET user_id=${uid} WHERE student_id=${studentId}`
    await sql`UPDATE class_enrollments SET status='archived' WHERE student_id=${studentId}`
    expect(await store.getLeaveRequestById(created.id)).toMatchObject({
      student_name: 'Canonical Name',
      student_class: null,
      absence_number: null,
    })
    const [profile] =
      await sql`SELECT full_name,class_name,absence_number FROM profiles WHERE user_id=${uid}`
    expect(profile).toEqual({
      full_name: 'Legacy Name',
      class_name: 'Legacy Class',
      absence_number: '9',
    })
  })

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
