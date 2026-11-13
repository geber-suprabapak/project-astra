import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { environment } from './helpers/pkl-fixture.js'

describe('native authenticated PKL workflows and integrity', () => {
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
