import { randomUUID } from 'node:crypto'
import { vi } from 'vitest'
import { createApp } from '../../../src/app.js'
import { AppError } from '../../../src/lib/errors/app-error.js'
import { MemoryDomainStore, MemoryIdentityProvider } from '../../../src/providers/memory/index.js'
import type { CmsProfile } from '../../../src/modules/cms/schema.js'
import type { PklInput } from '../../../src/modules/pkl/resources.js'

export async function environment() {
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
