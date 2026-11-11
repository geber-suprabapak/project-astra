import postgres, { type Sql } from 'postgres'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  assignPklIndustrySupervisor,
  verifyPklCertificate,
  savePklAssessment,
  importPklRecords,
  checkInPkl,
  checkOutPkl,
  listPklRecords,
  countPklRecords,
  mutatePklRecord,
  transitionPklRegistration,
} from '../../src/providers/postgres/pkl.js'
import { validatePklQuery, type PklRow } from '../../src/modules/pkl/resources.js'
import type { CmsSession } from '../../src/modules/cms/schema.js'

const databaseUrl = process.env.CMS_CONTENT_TEST_DATABASE_URL
if (databaseUrl) {
  const target = new URL(databaseUrl)
  if (target.hostname !== '127.0.0.1' || target.pathname !== '/astra_cms_content_test')
    throw new Error('PKL tests require the isolated loopback test database.')
}
describe.skipIf(!databaseUrl)('PostgreSQL native PKL domain', () => {
  let sql: Sql
  const actor = (role: CmsSession['role']): CmsSession => ({
    id: randomUUID(),
    role,
    full_name: 'Synthetic PKL actor',
    email: null,
    jurusan_id: null,
    jurusan_slug: null,
    authz_version: 1,
  })
  const admin = actor('admin_hubin'),
    student = actor('siswa'),
    otherStudent = actor('siswa'),
    teacher = actor('guru'),
    industryUser = actor('industri'),
    monitor = actor('monitoring_sipkl')
  const actors = [admin, student, otherStudent, teacher, industryUser, monitor]
  const created: { resource: string; id: string }[] = []
  let year: PklRow,
    industry: PklRow,
    pupil: PklRow,
    otherPupil: PklRow,
    supervisor: PklRow,
    internship: PklRow,
    otherInternship: PklRow,
    indicator: PklRow
  async function create(
    resource: string,
    data: Record<string, string | number | boolean | null>,
    access = admin,
  ) {
    const row = await mutatePklRecord(sql, { resource, action: 'create', data, access })
    created.push({ resource, id: row.id })
    return row
  }
  const list = (
    resource: string,
    access: CmsSession,
    query: Record<string, string | number> = {},
  ) => listPklRecords(sql, { resource, access, query: validatePklQuery(resource, query) })
  beforeAll(async () => {
    sql = postgres(databaseUrl!, { max: 3 })
    for (const access of actors)
      await sql`INSERT INTO cms.profiles(id,logto_subject,full_name,role,access_enabled) VALUES (${access.id},${access.id},${access.full_name},${access.role},true)`
    year = await create('academic_years', {
      name: '2026/2027',
      start_date: '2026-07-01',
      end_date: '2027-06-30',
      is_active: true,
      is_published: true,
    })
    industry = await create('industries', {
      name: 'Synthetic industry',
      profile_id: industryUser.id,
      is_published: true,
    })
    pupil = await create('students', {
      name: 'Synthetic student',
      nis: randomUUID(),
      jurusan: 'pplg',
      profile_id: student.id,
      is_published: false,
    })
    otherPupil = await create('students', {
      name: 'Other student',
      nis: randomUUID(),
      jurusan: 'akl',
      profile_id: otherStudent.id,
      is_published: false,
    })
    supervisor = await create('supervisors', {
      name: 'Synthetic teacher',
      profile_id: teacher.id,
      is_published: true,
    })
    internship = await create('internships', {
      student_id: pupil.id,
      industry_id: industry.id,
      supervisor_id: supervisor.id,
      academic_year_id: year.id,
      status: 'active',
    })
    const otherIndustry = await create('industries', { name: 'Other industry', is_published: true })
    otherInternship = await create('internships', {
      student_id: otherPupil.id,
      industry_id: otherIndustry.id,
      academic_year_id: year.id,
      status: 'active',
    })
    indicator = await create('assessment_indicators', {
      name: 'Competence',
      max_score: 100,
      weight: 1,
      sort_order: 0,
      is_published: true,
    })
  })
  afterAll(async () => {
    if (!sql) return
    await sql`DELETE FROM pkl.attendance WHERE student_id = ${pupil.id} OR student_id = ${otherPupil.id}`
    for (const item of [...created].reverse()) {
      if (item.resource === 'registrations')
        await sql`DELETE FROM pkl.status_history WHERE registration_id = ${item.id}`
      await sql`DELETE FROM ${sql('pkl.' + item.resource)} WHERE id = ${item.id}`
    }
    for (const access of actors) {
      await sql`DELETE FROM pkl.audit WHERE actor_id = ${access.id}`
      await sql`DELETE FROM cms.profiles WHERE id = ${access.id}`
    }
    await sql.end()
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
