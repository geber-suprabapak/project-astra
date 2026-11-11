import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../../src/app.js'
import { AppError } from '../../src/lib/errors/app-error.js'
import { MemoryDomainStore, MemoryIdentityProvider } from '../../src/providers/memory/index.js'
import type { CmsProfile } from '../../src/modules/cms/schema.js'
import { pklResources, type PklInput } from '../../src/modules/pkl/resources.js'

async function environment() {
  const store = new MemoryDomainStore(),
    identityProvider = new MemoryIdentityProvider()
  const profiles = new Map<string, CmsProfile>()
  for (const [subject, role] of [
    ['admin', 'admin_hubin'],
    ['student', 'siswa'],
    ['other', 'siswa'],
    ['teacher', 'guru'],
    ['industry', 'industri'],
    ['monitor', 'monitoring_sipkl'],
  ] as const) {
    const profile: CmsProfile = {
      id: randomUUID(),
      logto_subject: subject,
      role,
      full_name: 'Synthetic PKL user',
      email: null,
      jurusan_id: null,
      jurusan_slug: null,
      authz_version: 1,
      access_enabled: true,
      session_valid_after: null,
    }
    profiles.set(subject, profile)
    store.cmsProfiles.set(subject, profile)
  }
  vi.spyOn(identityProvider, 'verifyToken').mockImplementation(async (token) => {
    if (!profiles.has(token)) throw AppError.authInvalid()
    return {
      userId: token,
      authSource: 'logto',
      issuedAt: Math.floor(Date.now() / 1000),
      scopes: ['cms:access'],
    }
  })
  const app = createApp({ providers: { domainStore: store, identityProvider } })
  const access = (subject: string) => profiles.get(subject)!
  const create = (resource: string, data: PklInput) =>
    store.mutatePklRecord({ resource, action: 'create', data, access: access('admin') })
  const year = await create('academic_years', {
    name: '2026/2027',
    is_active: true,
    is_published: true,
  })
  const industry = await create('industries', {
    name: 'Synthetic industry',
    is_published: true,
    profile_id: access('industry').id,
  })
  const student = await create('students', {
    name: 'Synthetic student',
    nis: '001',
    jurusan: 'pplg',
    is_published: false,
    profile_id: access('student').id,
  })
  const other = await create('students', {
    name: 'Other student',
    nis: '002',
    jurusan: 'akl',
    is_published: false,
    profile_id: access('other').id,
  })
  const teacher = await create('supervisors', {
    name: 'Synthetic teacher',
    is_published: true,
    profile_id: access('teacher').id,
  })
  const internship = await create('internships', {
    student_id: student.id,
    industry_id: industry.id,
    academic_year_id: year.id,
    supervisor_id: teacher.id,
    status: 'active',
  })
  const otherIndustry = await create('industries', { name: 'Other industry', is_published: true })
  await create('internships', {
    student_id: other.id,
    industry_id: otherIndustry.id,
    academic_year_id: year.id,
    status: 'active',
  })
  async function request(path: string, token?: string, method = 'GET', data?: PklInput) {
    const headers = new Headers({ 'X-Astra-Contract-Version': 'v1' })
    if (token) headers.set('Authorization', `Bearer ${token}`)
    if (data) headers.set('Content-Type', 'application/json')
    return app.request('/v1/pkl' + path, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
    })
  }
  return { store, profiles, year, industry, student, teacher, internship, request }
}
describe('native authenticated PKL API', () => {
  it.each([...pklResources.keys()])('requires authentication for %s', async (resource) => {
    const env = await environment()
    expect((await env.request('/' + resource)).status).toBe(401)
  })
  it.each(['student', 'teacher', 'industry'])(
    'limits %s to the related placement and nested school records',
    async (subject) => {
      const env = await environment(),
        response = await env.request('/internships', subject)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      const result = await response.json()
      expect(result.data.map((row: { id: string }) => row.id)).toEqual([env.internship.id])
      expect(result.data[0].student.name).toBe('Synthetic student')
      expect(result.meta.pagination.has_more).toBe(false)
    },
  )
  it('filters exact NIS inside the protected student ownership scope', async () => {
    const env = await environment()
    expect((await (await env.request('/students?nis=001', 'student')).json()).data).toHaveLength(1)
    expect((await (await env.request('/students?nis=002', 'student')).json()).data).toHaveLength(0)
    expect((await (await env.request('/students?nis=002', 'admin')).json()).data).toHaveLength(1)
    expect((await env.request('/industries?nis=001', 'admin')).status).toBe(422)
  })
  it('checks in/out only for the student owner and keeps repeated check-in idempotent', async () => {
    const env = await environment()
    const first = await env.request('/attendance/check-in', 'student', 'POST', {
      internship_id: env.internship.id,
      lat: -7.5,
      lng: 110.2,
    })
    expect(first.status).toBe(200)
    const initial = (await first.json()).data
    const retry = (
      await (
        await env.request('/attendance/check-in', 'student', 'POST', {
          internship_id: env.internship.id,
          lat: 0,
          lng: 0,
        })
      ).json()
    ).data
    expect(retry.id).toBe(initial.id)
    expect(retry.check_in_at).toBe(initial.check_in_at)
    expect(retry.check_in_lat).toBe(-7.5)
    expect(
      (await env.request(`/attendance/${initial.id}/check-out`, 'other', 'POST', {})).status,
    ).toBe(403)
    const out = await env.request(`/attendance/${initial.id}/check-out`, 'student', 'POST', {
      lat: -7.5,
      lng: 110.2,
    })
    expect(out.status).toBe(200)
    expect((await out.json()).data.check_out_at).toBeTruthy()
    expect(
      (
        await env.request('/attendance/check-in', 'other', 'POST', {
          internship_id: env.internship.id,
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await env.request('/attendance/check-in', 'student', 'POST', {
          internship_id: env.internship.id,
          lat: 100,
        })
      ).status,
    ).toBe(422)
  })
  it('creates attendance together with a submitted journal, without granting students attendance CRUD', async () => {
    const env = await environment()
    const journal = await env.request('/daily_journals', 'student', 'POST', {
      internship_id: env.internship.id,
      date: '2026-11-04',
      description: 'Daily learning',
      status: 'pending',
    })
    expect(journal.status).toBe(201)
    const attendance = (await (await env.request('/attendance?date=2026-11-04', 'student')).json())
      .data
    expect(attendance).toHaveLength(1)
    expect(attendance[0].student_id).toBe(env.student.id)
    expect(attendance[0].status).toBe('HADIR')
    expect(
      (
        await env.request('/attendance', 'student', 'POST', {
          internship_id: env.internship.id,
          student_id: env.student.id,
          date: '2026-11-04',
        })
      ).status,
    ).toBe(403)
  })
  it('rolls back an entire batch when a later row fails validation', async () => {
    const env = await environment(),
      before = env.store.pklRecords.get('academic_years')!.size,
      audits = env.store.pklAudit.length
    const rejected = await env.request('/academic_years/import', 'admin', 'POST', {
      rows: [
        { name: 'Valid', is_active: false },
        { name: '', is_active: false },
      ],
    })
    expect(rejected.status).toBe(422)
    expect(env.store.pklRecords.get('academic_years')!.size).toBe(before)
    expect(env.store.pklAudit).toHaveLength(audits)
    expect(
      (
        await env.request('/academic_years/import', 'student', 'POST', {
          rows: [{ name: 'Forbidden', is_active: false }],
        })
      ).status,
    ).toBe(403)
  })
  it('atomically upserts dual assessments, notes, placement and certificate totals', async () => {
    const env = await environment()
    const indicator = await env.store.mutatePklRecord({
      resource: 'assessment_indicators',
      action: 'create',
      access: env.profiles.get('admin')!,
      data: {
        name: 'Competence',
        sort_order: 0,
        category: 'combined',
        weight: 2,
        max_score: 100,
        is_published: true,
      },
    })
    const certificate = await env.store.mutatePklRecord({
      resource: 'certificates',
      action: 'create',
      access: env.profiles.get('admin')!,
      data: {
        internship_id: env.internship.id,
        certificate_number: 'SYNTHETIC',
        issue_date: '2026-11-01',
      },
    })
    const path = `/internships/${env.internship.id}/assessment`
    expect(
      (
        await env.request(path, 'teacher', 'POST', {
          scores: [{ indicator_id: indicator.id, score_school: 80 }],
          notes: 'School review',
        })
      ).status,
    ).toBe(200)
    const result = await env.request(path, 'industry', 'POST', {
      scores: [{ indicator_id: indicator.id, score_industry: 90 }],
    })
    expect(result.status).toBe(200)
    expect((await result.json()).data).toMatchObject({ saved: 1, final_score: 85, grade: 'B' })
    expect(env.store.pklRecords.get('internships')!.get(env.internship.id)).toMatchObject({
      final_score: 85,
      notes: 'School review',
    })
    expect(env.store.pklRecords.get('certificates')!.get(certificate.id)).toMatchObject({
      final_score: 85,
      grade: 'B',
    })
    expect(env.store.pklRecords.get('assessment_scores')!.size).toBe(1)
    const placement = await env.request('/internships/' + env.internship.id, 'student')
    expect((await placement.json()).data.scores).toEqual([
      expect.objectContaining({
        score_school: 80,
        score_industry: 90,
        indicator: expect.objectContaining({ id: indicator.id }),
      }),
    ])
    const before = structuredClone(env.store.pklRecords),
      audits = env.store.pklAudit.length
    expect(
      (
        await env.request(path, 'teacher', 'POST', {
          scores: [{ indicator_id: indicator.id, score_industry: 100 }],
        })
      ).status,
    ).toBe(403)
    expect(env.store.pklRecords).toEqual(before)
    expect(env.store.pklAudit).toHaveLength(audits)
    expect(
      (
        await env.request(path, 'other', 'POST', {
          scores: [{ indicator_id: indicator.id, score_school: 100 }],
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await env.request(path, 'student', 'POST', {
          scores: [{ indicator_id: indicator.id, score_school: 100 }],
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await env.request(path, 'admin', 'POST', {
          scores: [
            { indicator_id: indicator.id, score_school: 80 },
            { indicator_id: indicator.id, score_school: 90 },
          ],
        })
      ).status,
    ).toBe(422)
  })
  it('verifies only issued certificates by an unguessable code with a bounded public projection', async () => {
    const env = await environment(),
      access = env.profiles.get('admin')!
    const certificate = await env.store.mutatePklRecord({
      resource: 'certificates',
      action: 'create',
      access,
      data: {
        internship_id: env.internship.id,
        certificate_number: 'SYNTHETIC-VERIFY',
        issue_date: '2026-11-01',
      },
    })
    const code = String(certificate.validation_code)
    expect(code).toMatch(/^[0-9a-f-]{36}$/)
    expect((await env.request('/certificates/verify/' + code)).status).toBe(404)
    await env.store.mutatePklRecord({
      resource: 'certificates',
      action: 'update',
      id: certificate.id,
      access,
      data: { status: 'issued' },
    })
    const response = await env.request('/certificates/verify/' + code)
    expect(response.status).toBe(200)
    const result = (await response.json()).data
    expect(result.certificate_number).toBe('SYNTHETIC-VERIFY')
    expect(Object.keys(result).sort()).toEqual(
      ['id', 'certificate_number', 'issue_date', 'final_score', 'grade', 'internship'].sort(),
    )
    expect(Object.keys(result.internship.student).sort()).toEqual(['name', 'nis', 'jurusan'].sort())
    expect(Object.keys(result.internship.industry).sort()).toEqual(['name', 'city'].sort())
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect((await env.request('/certificates/verify/not-a-code')).status).toBe(404)
    expect((await env.request('/certificates/verify/' + randomUUID())).status).toBe(404)
    await env.store.mutatePklRecord({
      resource: 'certificates',
      action: 'update',
      id: certificate.id,
      access,
      data: { status: 'revoked' },
    })
    expect((await env.request('/certificates/verify/' + code)).status).toBe(404)
    expect((await env.request('/certificates')).status).toBe(401)
  })
  it('rolls back every score and audit when a later indicator exceeds its maximum', async () => {
    const env = await environment(),
      access = env.profiles.get('admin')!
    const first = await env.store.mutatePklRecord({
      resource: 'assessment_indicators',
      action: 'create',
      access,
      data: { name: 'First', sort_order: 0, max_score: 100, is_published: true },
    })
    const second = await env.store.mutatePklRecord({
      resource: 'assessment_indicators',
      action: 'create',
      access,
      data: { name: 'Second', sort_order: 1, max_score: 10, is_published: true },
    })
    const before = structuredClone(env.store.pklRecords),
      audits = env.store.pklAudit.length
    const response = await env.request(
      `/internships/${env.internship.id}/assessment`,
      'teacher',
      'POST',
      {
        scores: [
          { indicator_id: first.id, score_school: 90 },
          { indicator_id: second.id, score_school: 11 },
        ],
      },
    )
    expect(response.status).toBe(422)
    expect(env.store.pklRecords).toEqual(before)
    expect(env.store.pklAudit).toHaveLength(audits)
  })
  it('assigns the industry default only to placements with no existing teacher binding', async () => {
    const env = await environment(),
      access = env.profiles.get('admin')!
    const replacement = await env.store.mutatePklRecord({
      resource: 'supervisors',
      action: 'create',
      access,
      data: { name: 'New teacher', is_published: true },
    })
    const other = [...env.store.pklRecords.get('internships')!.values()].find(
      (row) => row.id !== env.internship.id,
    )!
    await env.store.mutatePklRecord({
      resource: 'internships',
      action: 'update',
      id: other.id,
      access,
      data: { industry_id: env.industry.id },
    })
    const path = `/industries/${env.industry.id}/supervisor`
    expect(
      (await env.request(path, 'student', 'POST', { supervisor_id: replacement.id })).status,
    ).toBe(403)
    expect(
      (await env.request(path, 'admin', 'POST', { supervisor_id: replacement.id })).status,
    ).toBe(200)
    expect(env.store.pklRecords.get('internships')!.get(env.internship.id)?.supervisor_id).toBe(
      env.teacher.id,
    )
    expect(env.store.pklRecords.get('internships')!.get(other.id)).toMatchObject({
      supervisor_id: replacement.id,
      supervisor_guru_id: replacement.id,
    })
    expect(env.store.pklRecords.get('industries')!.get(env.industry.id)?.supervisor_id).toBe(
      replacement.id,
    )
    expect(env.store.pklAudit.at(-1)).toMatchObject({
      actor_id: access.id,
      resource: 'internships',
      action: 'update',
    })
  })
  it('does not expose provider-specific columns or credentials', async () => {
    const env = await environment()
    env.store.pklRecords.get('students')!.get(env.student.id)!.future_secret = 'forbidden'
    const response = await env.request('/students/' + env.student.id, 'student')
    expect((await response.json()).data).not.toHaveProperty('future_secret')
    const edited = await env.request('/students/' + env.student.id, 'student', 'PATCH', {
      phone: '08123456789',
    })
    expect((await edited.json()).data).not.toHaveProperty('future_secret')
  })
  it('rejects binding and ownership escalation', async () => {
    const env = await environment()
    expect(
      (
        await env.request('/students/' + env.student.id, 'student', 'PATCH', {
          profile_id: env.profiles.get('admin')!.id,
        })
      ).status,
    ).toBe(403)
    expect(
      (await env.request('/students/' + env.student.id, 'other', 'PATCH', { phone: 'forged' }))
        .status,
    ).toBe(404)
    expect(
      (
        await env.request('/students/' + env.student.id, 'student', 'PATCH', {
          initial_password: 'forbidden',
        })
      ).status,
    ).toBe(422)
  })
  it('keeps transitions legal, current and recorded with the authenticated actor', async () => {
    const env = await environment()
    const response = await env.request('/registrations', 'student', 'POST', {
      student_id: env.student.id,
      academic_year_id: env.year.id,
    })
    expect(response.status).toBe(201)
    const id = (await response.json()).data.id
    expect(
      (
        await env.request(`/registrations/${id}/transition`, 'student', 'POST', {
          expected_status: 'BELUM_DAFTAR',
          status: 'PENDING_APPROVAL',
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await env.request(`/registrations/${id}/transition`, 'student', 'POST', {
          expected_status: 'PENDING_APPROVAL',
          status: 'MENCARI_INDUSTRI',
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await env.request(`/registrations/${id}/transition`, 'admin', 'POST', {
          expected_status: 'PENDING_APPROVAL',
          status: 'MENCARI_INDUSTRI',
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await env.request(`/registrations/${id}/transition`, 'admin', 'POST', {
          expected_status: 'PENDING_APPROVAL',
          status: 'MENCARI_INDUSTRI',
        })
      ).status,
    ).toBe(409)
    const history = (
      await (
        await env.request(
          `/status_history?registration_id=${id}&sort=changed_at&direction=asc`,
          'student',
        )
      ).json()
    ).data
    expect(history.map((row: { to_status: string }) => row.to_status)).toEqual([
      'BELUM_DAFTAR',
      'PENDING_APPROVAL',
      'MENCARI_INDUSTRI',
    ])
    expect(history[2].changed_by).toBe(env.profiles.get('admin')!.id)
    expect(
      (await env.request('/status_history', 'admin', 'POST', { registration_id: id })).status,
    ).toBe(403)
  })
  it('rejects mismatched document ownership and role-incompatible bindings', async () => {
    const env = await environment()
    expect(
      (
        await env.request('/documents', 'student', 'POST', {
          student_id: env.student.id,
          internship_id: randomUUID(),
          doc_type: 'laporan',
          title: 'Report',
          file_url: 'https://example.test/report.pdf',
        })
      ).status,
    ).toBeGreaterThanOrEqual(400)
    expect(
      (
        await env.request('/supervisors', 'admin', 'POST', {
          name: 'Invalid binding',
          profile_id: env.profiles.get('student')!.id,
          is_published: false,
        })
      ).status,
    ).toBe(422)
  })
  it.each([
    '/students?select=*',
    '/students?sort=initial_password',
    '/students?limit=101',
    '/pg_catalog',
  ])('rejects unsupported resource/query %s', async (path) => {
    const env = await environment()
    expect((await env.request(path, 'admin')).status).toBeGreaterThanOrEqual(400)
  })
})
