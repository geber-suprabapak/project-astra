import type { Sql } from 'postgres'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  assignPklIndustrySupervisor,
  mutatePklRecord,
  savePklAssessment,
  transitionPklRegistration,
  verifyPklCertificate,
} from '../../src/providers/postgres/pkl.js'
import type { PklRow } from '../../src/modules/pkl/resources.js'
import type { CmsSession } from '../../src/modules/cms/schema.js'
import {
  cleanupPostgresPklSuite,
  createPostgresPklActors,
  getPostgresPklTestDatabaseUrl,
  makePostgresPklHelpers,
  seedPostgresPklSuite,
} from './helpers/postgres-pkl-fixture.js'

const databaseUrl = getPostgresPklTestDatabaseUrl()
describe.skipIf(!databaseUrl)('PostgreSQL native PKL workflows and audits', () => {
  let sql: Sql
  const actors = createPostgresPklActors()
  const { admin, student, teacher, industryUser } = actors
  const created: { resource: string; id: string }[] = []
  let year: PklRow,
    industry: PklRow,
    pupil: PklRow,
    otherPupil: PklRow,
    supervisor: PklRow,
    internship: PklRow,
    otherInternship: PklRow,
    indicator: PklRow
  const { create, list } = makePostgresPklHelpers(() => sql, admin, created)
  beforeAll(async () => {
    const seeded = await seedPostgresPklSuite(databaseUrl!, actors, created)
    ;({
      sql,
      year,
      industry,
      pupil,
      otherPupil,
      supervisor,
      internship,
      otherInternship,
      indicator,
    } = seeded)
  })
  afterAll(async () => {
    await cleanupPostgresPklSuite(sql, pupil, otherPupil, created, actors.all)
  })
  it('saves assessments and dependent totals in one transaction, including audit rollback', async () => {
    const certificate = await create('certificates', {
      internship_id: internship.id,
      certificate_number: randomUUID(),
      issue_date: '2026-11-01',
    })
    const second = await create('assessment_indicators', {
      name: 'Bounded competence',
      sort_order: 1,
      category: 'combined',
      max_score: 10,
      weight: 1,
      is_published: true,
    })
    const result = await savePklAssessment(sql, {
      id: internship.id,
      access: teacher,
      scores: [{ indicator_id: indicator.id, score_school: 80 }],
      notes: 'Teacher review',
    })
    expect(result).toMatchObject({ final_score: 85, grade: 'B' })
    expect((await list('internships', student, { id: internship.id }))[0]?.scores).toEqual([
      expect.objectContaining({
        score_school: 80,
        score_industry: 90,
        indicator: expect.objectContaining({ id: indicator.id }),
      }),
    ])
    expect((await list('internships', teacher, { id: internship.id }))[0]).toMatchObject({
      final_score: 85,
      notes: 'Teacher review',
    })
    expect((await list('certificates', student, { id: certificate.id }))[0]).toMatchObject({
      final_score: 85,
      grade: 'B',
    })
    const audits = await sql`SELECT id FROM pkl.audit WHERE actor_id = ${teacher.id}`
    await expect(
      savePklAssessment(sql, {
        id: internship.id,
        access: teacher,
        scores: [
          { indicator_id: indicator.id, score_school: 20 },
          { indicator_id: second.id, score_school: 11 },
        ],
        notes: 'Must roll back',
      }),
    ).rejects.toMatchObject({ httpStatus: 422 })
    expect(
      (
        await list('assessment_scores', teacher, {
          internship_id: internship.id,
          indicator_id: indicator.id,
        })
      )[0],
    ).toMatchObject({ score_school: 80, final_score: 85 })
    expect(
      await sql`SELECT id FROM pkl.assessment_scores WHERE internship_id = ${internship.id} AND indicator_id = ${second.id}`,
    ).toHaveLength(0)
    expect(await sql`SELECT id FROM pkl.audit WHERE actor_id = ${teacher.id}`).toHaveLength(
      audits.length,
    )
    expect((await list('internships', teacher, { id: internship.id }))[0]?.notes).toBe(
      'Teacher review',
    )
    await expect(
      savePklAssessment(sql, {
        id: internship.id,
        access: teacher,
        scores: [{ indicator_id: indicator.id, score_industry: 100 }],
      }),
    ).rejects.toMatchObject({ httpStatus: 403 })
    await expect(
      savePklAssessment(sql, {
        id: otherInternship.id,
        access: teacher,
        scores: [{ indicator_id: indicator.id, score_school: 100 }],
      }),
    ).rejects.toMatchObject({ httpStatus: 403 })
  })
  it('verifies issued certificates without exposing private school or identity fields', async () => {
    const certificate = await create('certificates', {
      internship_id: internship.id,
      certificate_number: randomUUID(),
      issue_date: '2026-11-01',
    })
    const code = String(certificate.validation_code)
    expect(await verifyPklCertificate(sql, code)).toBeNull()
    await mutatePklRecord(sql, {
      resource: 'certificates',
      action: 'update',
      id: certificate.id,
      access: admin,
      data: { status: 'issued' },
    })
    const publicRecord = await verifyPklCertificate(sql, code)
    expect(publicRecord).toMatchObject({
      id: certificate.id,
      internship: { student: { name: 'Synthetic student' } },
    })
    expect(Object.keys(publicRecord!.internship.student).sort()).toEqual(
      ['name', 'nis', 'jurusan'].sort(),
    )
    expect(Object.keys(publicRecord!.internship.industry).sort()).toEqual(['name', 'city'].sort())
    expect(publicRecord).not.toHaveProperty('validation_code')
    await mutatePklRecord(sql, {
      resource: 'certificates',
      action: 'update',
      id: certificate.id,
      access: admin,
      data: { status: 'revoked' },
    })
    expect(await verifyPklCertificate(sql, code)).toBeNull()
    expect(await verifyPklCertificate(sql, 'invalid-code')).toBeNull()
    expect(await verifyPklCertificate(sql, randomUUID())).toBeNull()
  })
  it('rejects mismatched document ownership before storing any record', async () => {
    await expect(
      create(
        'documents',
        {
          student_id: pupil.id,
          internship_id: otherInternship.id,
          doc_type: 'laporan',
          title: 'Report',
          file_url: 'https://example.test/report.pdf',
        },
        student,
      ),
    ).rejects.toMatchObject({ httpStatus: 422 })
  })
  it('locks workflow transitions and appends immutable history atomically', async () => {
    const registration = await create(
      'registrations',
      { student_id: pupil.id, academic_year_id: year.id },
      student,
    )
    const transition = (
      expected_status:
        | 'BELUM_DAFTAR'
        | 'PENDING_APPROVAL'
        | 'MENCARI_INDUSTRI'
        | 'MENUNGGU_INDUSTRI',
      status: 'PENDING_APPROVAL' | 'MENCARI_INDUSTRI' | 'MENUNGGU_INDUSTRI' | 'DITERIMA',
      access: CmsSession,
      industry_id?: string,
    ) =>
      transitionPklRegistration(sql, {
        id: registration.id,
        expected_status,
        status,
        access,
        industry_id,
      })
    await transition('BELUM_DAFTAR', 'PENDING_APPROVAL', student)
    await expect(transition('PENDING_APPROVAL', 'MENCARI_INDUSTRI', student)).rejects.toMatchObject(
      { httpStatus: 403 },
    )
    await transition('PENDING_APPROVAL', 'MENCARI_INDUSTRI', admin)
    await transition('MENCARI_INDUSTRI', 'MENUNGGU_INDUSTRI', student, industry.id)
    const accepted = await transition('MENUNGGU_INDUSTRI', 'DITERIMA', industryUser)
    expect(accepted.accepted_by).toBe(industryUser.id)
    await expect(transition('MENUNGGU_INDUSTRI', 'DITERIMA', industryUser)).rejects.toMatchObject({
      httpStatus: 409,
    })
    const history = await list('status_history', student, {
      registration_id: registration.id,
      sort: 'changed_at',
      direction: 'asc',
    })
    expect(history.map((row) => row.to_status)).toEqual([
      'BELUM_DAFTAR',
      'PENDING_APPROVAL',
      'MENCARI_INDUSTRI',
      'MENUNGGU_INDUSTRI',
      'DITERIMA',
    ])
  })
  it('persists the industry teacher and fills only completely unassigned placements', async () => {
    const next = await create('supervisors', {
      name: 'Default industry teacher',
      is_published: true,
    })
    try {
      await mutatePklRecord(sql, {
        resource: 'internships',
        action: 'update',
        id: otherInternship.id,
        access: admin,
        data: { industry_id: industry.id },
      })
      await expect(
        assignPklIndustrySupervisor(sql, {
          id: industry.id,
          supervisor_id: next.id,
          access: student,
        }),
      ).rejects.toMatchObject({ httpStatus: 403 })
      expect(
        await assignPklIndustrySupervisor(sql, {
          id: industry.id,
          supervisor_id: next.id,
          access: admin,
        }),
      ).toMatchObject({ supervisor_id: next.id })
      expect((await list('internships', admin, { id: internship.id }))[0]?.supervisor_id).toBe(
        supervisor.id,
      )
      expect((await list('internships', admin, { id: otherInternship.id }))[0]).toMatchObject({
        supervisor_id: next.id,
        supervisor_guru_id: next.id,
      })
      const audits =
        await sql`SELECT id FROM pkl.audit WHERE actor_id = ${admin.id} AND record_id = ${otherInternship.id} AND after_data->>'supervisor_id' = ${next.id}`
      expect(audits).toHaveLength(1)
    } finally {
      await mutatePklRecord(sql, {
        resource: 'industries',
        action: 'update',
        id: industry.id,
        access: admin,
        data: { supervisor_id: null },
      })
      await mutatePklRecord(sql, {
        resource: 'internships',
        action: 'update',
        id: otherInternship.id,
        access: admin,
        data: {
          industry_id: String(otherInternship.industry_id),
          supervisor_id: null,
          supervisor_guru_id: null,
        },
      })
    }
  })
  it('archives records without erasing transactional audit evidence', async () => {
    const row = await create('academic_years', {
      name: 'Archive example',
      is_active: false,
      is_published: false,
    })
    await mutatePklRecord(sql, {
      resource: 'academic_years',
      action: 'delete',
      id: row.id,
      data: {},
      access: admin,
    })
    expect(await list('academic_years', admin, { id: row.id })).toHaveLength(0)
    const audit = await sql`SELECT action FROM pkl.audit WHERE record_id = ${row.id}`
    expect(audit.map((row) => row.action).sort()).toEqual(['create', 'delete'])
  })
})
