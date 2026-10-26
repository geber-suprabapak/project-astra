import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { PostgresDomainStore } from '../../src/providers/postgres/domain-store.js'

// Use a direct PostgreSQL connection: the temporary table must stay on one session.
describe.skipIf(!process.env.TEST_POSTGRES_URL)('PostgreSQL roster JSON round trip', () => {
  const sql = postgres(process.env.TEST_POSTGRES_URL ?? '', { max: 1 })
  const store = new PostgresDomainStore({ sql })
  const rosterRows = [{ nis: 'test-1001', full_name: 'Dummy Student', class_name: 'X Test' }]

  beforeAll(async () => {
    await sql`
      CREATE TEMP TABLE roster_reports (
        id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
        school_id text, academic_period_id text,
        total_rows int, valid_rows int, rejected_rows int,
        status text, review_state text, rows jsonb, rejected_items jsonb,
        accepted_at timestamptz, accepted_by text,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
      )
    `
    await sql`CREATE TEMP TABLE classes (LIKE public.classes INCLUDING DEFAULTS INCLUDING INDEXES)`
    await sql`CREATE TEMP TABLE students (LIKE public.students INCLUDING DEFAULTS INCLUDING INDEXES)`
    await sql`CREATE TEMP TABLE class_enrollments (LIKE public.class_enrollments INCLUDING DEFAULTS INCLUDING INDEXES)`
  })

  afterAll(async () => {
    await sql.end()
  })

  it('stores arrays rather than JSON string scalars', async () => {
    const report = await store.stageRosterReport({
      totalRows: 1,
      validRows: 1,
      rejectedRows: 0,
      status: 'staged',
      reviewState: 'pending',
      rows: rosterRows,
      rejectedItems: [],
    })
    expect(report.rows).toEqual(rosterRows)
    expect(report.rejected_items).toEqual([])
    const [stored] = await sql`
      SELECT jsonb_typeof(rows) AS rows_type, jsonb_typeof(rejected_items) AS rejected_type
      FROM roster_reports WHERE id = ${report.id}
    `
    expect(stored).toEqual({ rows_type: 'array', rejected_type: 'array' })
    expect((await store.getRosterReport(report.id))?.rows).toEqual(rosterRows)
  })

  it('reads legacy double-encoded arrays without rewriting stored data', async () => {
    await sql`
      INSERT INTO roster_reports (id, rows, rejected_items)
      VALUES ('legacy', ${sql.json(JSON.stringify(rosterRows))}, ${sql.json('[]')})
    `
    const report = await store.getRosterReport('legacy')
    expect(report?.rows).toEqual(rosterRows)
    expect(report?.rejected_items).toEqual([])
    const [stored] =
      await sql`SELECT jsonb_typeof(rows) AS type FROM roster_reports WHERE id = 'legacy'`
    expect(stored?.type).toBe('string')
  })

  it.each([false, true])(
    'accepts roster and commits canonical records (legacy=%s)',
    async (legacy) => {
      const school = await store.getSchool()
      const period = await store.getActiveAcademicPeriod()
      expect(school).not.toBeNull()
      expect(period).not.toBeNull()
      const [classRoom] = await sql`
      INSERT INTO classes (school_id, academic_period_id, name, grade)
      VALUES (${school!.id}, ${period!.id}, ${`Test ${legacy}`}, 10) RETURNING id
    `
      const nis = legacy ? '90012' : '90011'
      const rows = [
        {
          nis,
          full_name: 'Temporary Dummy',
          class_name: `Test ${legacy}`,
          class_id: classRoom!.id,
          gender: 'L',
          absence_number: '1',
        },
      ]
      const report = await store.stageRosterReport({
        schoolId: school!.id,
        academicPeriodId: period!.id,
        totalRows: 1,
        validRows: 1,
        rejectedRows: 0,
        status: 'staged',
        reviewState: 'pending',
        rows,
        rejectedItems: [],
      })
      if (legacy)
        await sql`
      UPDATE roster_reports SET rows = ${sql.json(JSON.stringify(rows))}, rejected_items = ${sql.json('[]')}
      WHERE id = ${report.id}
    `
      const accepted = await store.acceptRosterReport(report.id, 'dummy-admin')
      expect(accepted.status).toBe('accepted')
      expect(accepted.rows).toEqual(rows)
      expect(accepted.rejected_items).toEqual([])
      const [student] = await sql`SELECT id FROM students WHERE nis = ${nis}`
      const [enrollment] =
        await sql`SELECT class_id FROM class_enrollments WHERE student_id = ${student!.id}`
      expect(enrollment?.class_id).toBe(classRoom!.id)
      expect((await store.getBootstrapStatus()).latest_roster_report?.rejected_items).toEqual([])
    },
  )
})
