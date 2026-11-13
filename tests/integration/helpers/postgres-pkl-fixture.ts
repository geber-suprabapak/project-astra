import postgres, { type Sql } from 'postgres'
import { randomUUID } from 'node:crypto'
import { listPklRecords, mutatePklRecord } from '../../../src/providers/postgres/pkl.js'
import { validatePklQuery, type PklRow } from '../../../src/modules/pkl/resources.js'
import type { CmsSession } from '../../../src/modules/cms/schema.js'

export function getPostgresPklTestDatabaseUrl(): string | undefined {
  const databaseUrl = process.env.CMS_CONTENT_TEST_DATABASE_URL
  if (databaseUrl) {
    const target = new URL(databaseUrl)
    if (target.hostname !== '127.0.0.1' || target.pathname !== '/astra_cms_content_test')
      throw new Error('PKL tests require the isolated loopback test database.')
  }
  return databaseUrl
}

const actor = (role: CmsSession['role']): CmsSession => ({
  id: randomUUID(),
  role,
  full_name: 'Synthetic PKL actor',
  email: null,
  jurusan_id: null,
  jurusan_slug: null,
  authz_version: 1,
})

export function createPostgresPklActors() {
  const admin = actor('admin_hubin')
  const student = actor('siswa')
  const otherStudent = actor('siswa')
  const teacher = actor('guru')
  const industryUser = actor('industri')
  const monitor = actor('monitoring_sipkl')
  return {
    admin,
    student,
    otherStudent,
    teacher,
    industryUser,
    monitor,
    all: [admin, student, otherStudent, teacher, industryUser, monitor],
  }
}

export async function seedPostgresPklSuite(
  databaseUrl: string,
  actors: ReturnType<typeof createPostgresPklActors>,
  created: { resource: string; id: string }[],
) {
  const sql = postgres(databaseUrl, { max: 3 })
  for (const access of actors.all)
    await sql`INSERT INTO cms.profiles(id,logto_subject,full_name,role,access_enabled) VALUES (${access.id},${access.id},${access.full_name},${access.role},true)`
  const create = async (
    resource: string,
    data: Record<string, string | number | boolean | null>,
    access = actors.admin,
  ) => {
    const row = await mutatePklRecord(sql, { resource, action: 'create', data, access })
    created.push({ resource, id: row.id })
    return row
  }
  const year = await create('academic_years', {
    name: '2026/2027',
    start_date: '2026-07-01',
    end_date: '2027-06-30',
    is_active: true,
    is_published: true,
  })
  const industry = await create('industries', {
    name: 'Synthetic industry',
    profile_id: actors.industryUser.id,
    is_published: true,
  })
  const pupil = await create('students', {
    name: 'Synthetic student',
    nis: randomUUID(),
    jurusan: 'pplg',
    profile_id: actors.student.id,
    is_published: false,
  })
  const otherPupil = await create('students', {
    name: 'Other student',
    nis: randomUUID(),
    jurusan: 'akl',
    profile_id: actors.otherStudent.id,
    is_published: false,
  })
  const supervisor = await create('supervisors', {
    name: 'Synthetic teacher',
    profile_id: actors.teacher.id,
    is_published: true,
  })
  const internship = await create('internships', {
    student_id: pupil.id,
    industry_id: industry.id,
    supervisor_id: supervisor.id,
    academic_year_id: year.id,
    status: 'active',
  })
  const otherIndustry = await create('industries', { name: 'Other industry', is_published: true })
  const otherInternship = await create('internships', {
    student_id: otherPupil.id,
    industry_id: otherIndustry.id,
    academic_year_id: year.id,
    status: 'active',
  })
  const indicator = await create('assessment_indicators', {
    name: 'Competence',
    max_score: 100,
    weight: 1,
    sort_order: 0,
    is_published: true,
  })
  return {
    sql,
    year,
    industry,
    pupil,
    otherPupil,
    supervisor,
    internship,
    otherInternship,
    indicator,
  }
}

export async function cleanupPostgresPklSuite(
  sql: Sql | undefined,
  pupil: PklRow | undefined,
  otherPupil: PklRow | undefined,
  created: { resource: string; id: string }[],
  actors: CmsSession[],
) {
  if (!sql) return
  if (pupil && otherPupil) {
    await sql`DELETE FROM pkl.attendance WHERE student_id = ${pupil.id} OR student_id = ${otherPupil.id}`
  }
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
}

export function makePostgresPklHelpers(
  getSql: () => Sql,
  admin: CmsSession,
  created: { resource: string; id: string }[],
) {
  const create = async (
    resource: string,
    data: Record<string, string | number | boolean | null>,
    access = admin,
  ) => {
    const row = await mutatePklRecord(getSql(), { resource, action: 'create', data, access })
    created.push({ resource, id: row.id })
    return row
  }
  const list = (
    resource: string,
    access: CmsSession,
    query: Record<string, string | number> = {},
  ) => listPklRecords(getSql(), { resource, access, query: validatePklQuery(resource, query) })
  return { create, list }
}
