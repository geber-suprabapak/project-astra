import type { Sql } from 'postgres'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  checkInPkl,
  checkOutPkl,
  countPklRecords,
  importPklRecords,
  mutatePklRecord,
} from '../../src/providers/postgres/pkl.js'
import { validatePklQuery, type PklRow } from '../../src/modules/pkl/resources.js'
import {
  cleanupPostgresPklSuite,
  createPostgresPklActors,
  getPostgresPklTestDatabaseUrl,
  makePostgresPklHelpers,
  seedPostgresPklSuite,
} from './helpers/postgres-pkl-fixture.js'

const databaseUrl = getPostgresPklTestDatabaseUrl()
describe.skipIf(!databaseUrl)('PostgreSQL native PKL domain', () => {
  let sql: Sql
  const actors = createPostgresPklActors()
  const { admin, student, otherStudent, teacher, industryUser, monitor } = actors
  const created: { resource: string; id: string }[] = []
  let year: PklRow,
    industry: PklRow,
    pupil: PklRow,
    otherPupil: PklRow,
    internship: PklRow,
    otherInternship: PklRow,
    indicator: PklRow
  const { create, list } = makePostgresPklHelpers(() => sql, admin, created)
  beforeAll(async () => {
    const seeded = await seedPostgresPklSuite(databaseUrl!, actors, created)
    ;({ sql, year, industry, pupil, otherPupil, internship, otherInternship, indicator } = seeded)
  })
  afterAll(async () => {
    await cleanupPostgresPklSuite(sql, pupil, otherPupil, created, actors.all)
  })
  it.each([student, teacher, industryUser])(
    'reads only the explicitly related internship for $role',
    async (access) => {
      const rows = await list('internships', access)
      expect(rows.map((row) => row.id)).toEqual([internship.id])
      expect(rows[0]?.student).toMatchObject({ id: pupil.id, name: 'Synthetic student' })
      expect(rows[0]?.industry).toMatchObject({ id: industry.id })
      expect(await list('internships', access, { id: otherInternship.id })).toHaveLength(0)
    },
  )
  it('combines exact NIS lookup with student ownership rather than bypassing it', async () => {
    expect(
      (await list('students', student, { nis: String(pupil.nis) })).map((row) => row.id),
    ).toEqual([pupil.id])
    expect(await list('students', student, { nis: String(otherPupil.nis) })).toHaveLength(0)
    expect(
      (await list('students', admin, { nis: String(otherPupil.nis) })).map((row) => row.id),
    ).toEqual([otherPupil.id])
  })
  it('keeps monitoring read-only and counts independently of pagination', async () => {
    const query = validatePklQuery('internships', {
      academic_year_id: year.id,
      limit: 1,
      offset: 100,
    })
    expect(await countPklRecords(sql, { resource: 'internships', access: monitor, query })).toBe(2)
    await expect(
      mutatePklRecord(sql, {
        resource: 'internships',
        action: 'update',
        id: internship.id,
        data: { notes: 'forged' },
        access: monitor,
      }),
    ).rejects.toMatchObject({ httpStatus: 403 })
  })
  it('records student-owned attendance idempotently and prevents another student checking it out', async () => {
    const first = await checkInPkl(sql, {
      internship_id: internship.id,
      lat: 0,
      lng: 0,
      access: student,
    })
    const repeat = await checkInPkl(sql, {
      internship_id: internship.id,
      lat: -7.5,
      lng: 110,
      access: student,
    })
    expect(repeat.id).toBe(first.id)
    expect(repeat.check_in_at).toBe(first.check_in_at)
    expect(repeat.check_in_lat).toBe(0)
    await expect(checkOutPkl(sql, { id: first.id, access: otherStudent })).rejects.toMatchObject({
      httpStatus: 403,
    })
    await expect(checkOutPkl(sql, { id: first.id, access: student })).resolves.toMatchObject({
      id: first.id,
    })
  })
  it('rolls back a batch and all audit entries after a later invalid row', async () => {
    const name = randomUUID()
    await expect(
      importPklRecords(sql, {
        resource: 'academic_years',
        access: admin,
        rows: [
          { name, is_active: false },
          { name: '', is_active: false },
        ],
      }),
    ).rejects.toMatchObject({ httpStatus: 422 })
    expect(await sql`SELECT id FROM pkl.academic_years WHERE name = ${name}`).toHaveLength(0)
    expect(
      await sql`SELECT id FROM pkl.audit WHERE actor_id = ${admin.id} AND after_data ->> 'name' = ${name}`,
    ).toHaveLength(0)
  })
  it('allows own contact changes while rejecting identity and foreign record changes', async () => {
    await expect(
      mutatePklRecord(sql, {
        resource: 'students',
        action: 'update',
        id: pupil.id,
        data: { phone: '08123456789' },
        access: student,
      }),
    ).resolves.toMatchObject({ phone: '08123456789' })
    await expect(
      mutatePklRecord(sql, {
        resource: 'students',
        action: 'update',
        id: pupil.id,
        data: { profile_id: otherStudent.id },
        access: student,
      }),
    ).rejects.toMatchObject({ httpStatus: 403 })
    await expect(
      mutatePklRecord(sql, {
        resource: 'students',
        action: 'update',
        id: otherPupil.id,
        data: { phone: 'forged' },
        access: student,
      }),
    ).rejects.toMatchObject({ httpStatus: 404 })
  })
  it('protects journal approval and prevents post-approval student edits', async () => {
    const journal = await create(
      'daily_journals',
      {
        internship_id: internship.id,
        date: '2026-11-04',
        description: 'Daily learning',
        status: 'pending',
      },
      student,
    )
    expect(journal.created_by).toBe(student.id)
    await expect(
      mutatePklRecord(sql, {
        resource: 'daily_journals',
        action: 'update',
        id: journal.id,
        data: { status: 'approved' },
        access: student,
      }),
    ).rejects.toMatchObject({ httpStatus: 403 })
    await expect(
      mutatePklRecord(sql, {
        resource: 'daily_journals',
        action: 'update',
        id: journal.id,
        data: { status: 'approved', supervisor_notes: 'Reviewed' },
        access: teacher,
      }),
    ).resolves.toMatchObject({ status: 'approved', verification_status: 'approved' })
    await expect(
      mutatePklRecord(sql, {
        resource: 'daily_journals',
        action: 'update',
        id: journal.id,
        data: { description: 'overwrite' },
        access: student,
      }),
    ).rejects.toMatchObject({ httpStatus: 409 })
  })
  it('computes final assessment from separate teacher/industry authority', async () => {
    const score = await create(
      'assessment_scores',
      { internship_id: internship.id, indicator_id: indicator.id, score_school: 80 },
      teacher,
    )
    await expect(
      mutatePklRecord(sql, {
        resource: 'assessment_scores',
        action: 'update',
        id: score.id,
        data: { score_industry: 90 },
        access: teacher,
      }),
    ).rejects.toMatchObject({ httpStatus: 403 })
    const result = await mutatePklRecord(sql, {
      resource: 'assessment_scores',
      action: 'update',
      id: score.id,
      data: { score_industry: 90 },
      access: industryUser,
    })
    expect(result.final_score).toBe(85)
  })
})
