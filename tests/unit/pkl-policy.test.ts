import { describe, expect, it } from 'vitest'
import {
  authorizePklMutation,
  authorizePklTransition,
  canAssessPklInternship,
  canReadPklInternship,
  type PklBindings,
} from '../../src/modules/pkl/policy.js'
import { preparePklWrite, validatePklQuery, type PklRow } from '../../src/modules/pkl/resources.js'
import type { CmsSession } from '../../src/modules/cms/schema.js'

const user = (role: CmsSession['role']): CmsSession => ({
  id: 'a5880444-dd9b-4455-8454-7b0efc367ef1',
  role,
  email: null,
  full_name: null,
  jurusan_id: null,
  jurusan_slug: null,
  authz_version: 1,
})
const bindings: PklBindings = {
  studentId: 'student',
  supervisorIds: ['teacher'],
  industryIds: ['industry'],
}
const internship: PklRow = {
  id: 'internship',
  student_id: 'student',
  supervisor_id: 'teacher',
  supervisor_guru_id: null,
  industry_id: 'industry',
}
describe('PKL record ownership', () => {
  it.each([
    'siswa',
    'guru',
    'pembimbing_sekolah',
    'supervisor',
    'industri',
    'pembimbing_industri',
  ] as const)('allows explicitly related %s and denies unrelated bindings', (role) => {
    expect(canReadPklInternship(internship, user(role), bindings)).toBe(true)
    expect(
      canReadPklInternship(internship, user(role), {
        studentId: null,
        supervisorIds: [],
        industryIds: [],
      }),
    ).toBe(false)
  })
  it('retains monitoring read access without assessment authority', () => {
    expect(canReadPklInternship(internship, user('monitoring_sipkl'), bindings)).toBe(true)
    expect(canAssessPklInternship(internship, user('monitoring_sipkl'), bindings)).toBe(false)
  })
  it('does not grant attendance administrator or unrelated CMS role access', () => {
    expect(canReadPklInternship(internship, user('jurnalistik'), bindings)).toBe(false)
  })
  it('does not equate missing student bindings with a missing row owner', () => {
    expect(
      canReadPklInternship({ id: 'invalid' }, user('siswa'), { ...bindings, studentId: null }),
    ).toBe(false)
  })
})
describe('PKL field authority', () => {
  const student = user('siswa')
  const patch = (
    resource: string,
    data: Record<string, string | boolean>,
    before: PklRow = { id: 'student' },
  ) =>
    authorizePklMutation(
      { resource, action: 'update', data, access: student },
      data,
      bindings,
      before,
      internship,
    )
  it('allows student contact edits', () => {
    expect(() => patch('students', { phone: '08123456789', profile_completed: true })).not.toThrow()
  })
  it.each(['role', 'profile_id', 'nis', 'jurusan', 'name', 'is_published'])(
    'rejects student changes to protected %s',
    (field) => {
      expect(() => patch('students', { [field]: 'forged' })).toThrow()
    },
  )
  it('denies self-approval and edits to approved journals', () => {
    expect(() =>
      patch('daily_journals', { status: 'approved' }, { id: 'journal', status: 'pending' }),
    ).toThrow()
    expect(() =>
      patch('daily_journals', { activities: 'changed' }, { id: 'journal', status: 'approved' }),
    ).toThrow()
  })
  it('permits only the assessor’s own score field', () => {
    const base = {
      resource: 'assessment_scores',
      action: 'update',
      access: user('guru'),
      data: { score_school: 80 },
    } as const
    expect(() =>
      authorizePklMutation(base, base.data, bindings, { id: 'score' }, internship),
    ).not.toThrow()
    expect(() =>
      authorizePklMutation(base, { score_industry: 100 }, bindings, { id: 'score' }, internship),
    ).toThrow()
    expect(() =>
      authorizePklMutation(base, { final_score: 100 }, bindings, { id: 'score' }, internship),
    ).toThrow()
  })
  it('keeps status history immutable even for an administrator', () => {
    expect(() =>
      authorizePklMutation(
        { resource: 'status_history', action: 'create', data: {}, access: user('super_admin') },
        {},
        bindings,
        null,
        null,
      ),
    ).toThrow()
  })
})
describe('PKL workflow authority', () => {
  const registration: PklRow = {
    id: 'registration',
    student_id: 'student',
    industry_id: 'industry',
    status: 'PENDING_APPROVAL',
  }
  it('requires both a legal transition and a matching current state', () => {
    expect(() =>
      authorizePklTransition(
        {
          id: 'registration',
          expected_status: 'PENDING_APPROVAL',
          status: 'MENCARI_INDUSTRI',
          access: user('admin_hubin'),
        },
        registration,
        bindings,
      ),
    ).not.toThrow()
    expect(() =>
      authorizePklTransition(
        {
          id: 'registration',
          expected_status: 'PENDING_APPROVAL',
          status: 'SELESAI',
          access: user('admin_hubin'),
        },
        registration,
        bindings,
      ),
    ).toThrow()
    expect(() =>
      authorizePklTransition(
        {
          id: 'registration',
          expected_status: 'BELUM_DAFTAR',
          status: 'PENDING_APPROVAL',
          access: user('admin_hubin'),
        },
        registration,
        bindings,
      ),
    ).toThrow()
  })
  it('never lets an applicant approve their own registration', () => {
    expect(() =>
      authorizePklTransition(
        {
          id: 'registration',
          expected_status: 'PENDING_APPROVAL',
          status: 'MENCARI_INDUSTRI',
          access: user('siswa'),
        },
        registration,
        bindings,
      ),
    ).toThrow()
  })
  it('allows acceptance only by the chosen industry account', () => {
    const before = { ...registration, status: 'MENUNGGU_INDUSTRI' }
    const command = {
      id: 'registration',
      expected_status: 'MENUNGGU_INDUSTRI',
      status: 'DITERIMA',
      access: user('industri'),
    } as const
    expect(() => authorizePklTransition(command, before, bindings)).not.toThrow()
    expect(() =>
      authorizePklTransition(command, before, { ...bindings, industryIds: ['other'] }),
    ).toThrow()
  })
})
describe('native PKL input boundaries', () => {
  it('normalizes empty optional dates and rejects unknown auth fields', () => {
    const access = user('admin_hubin')
    expect(
      preparePklWrite({
        resource: 'academic_years',
        action: 'create',
        access,
        data: { name: '2026', start_date: '', end_date: '', is_active: false, is_published: false },
      }).start_date,
    ).toBeNull()
    expect(() =>
      preparePklWrite({
        resource: 'students',
        action: 'update',
        access,
        data: { initial_password: 'forbidden' },
      }),
    ).toThrow()
  })
  it.each([{ select: '*' }, { sort: 'password' }, { limit: 101 }, { date_from: '2026-01-01' }])(
    'rejects undeclared query capabilities %j',
    (input) => {
      expect(() => validatePklQuery('students', input)).toThrow()
    },
  )
})
