import { describe, expect, it } from 'vitest'
import { pklResources } from '../../src/modules/pkl/resources.js'
import { environment } from './helpers/pkl-fixture.js'

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
})
