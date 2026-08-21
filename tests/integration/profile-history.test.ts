import { describe, expect, it } from 'vitest'
import type { JWTPayload } from 'jose'
import { createApp } from '../../src/app.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../src/providers/memory/index.js'
import type { RobinClient } from '../../src/clients/robin/client.js'

function tokenFor(payload: JWTPayload): string {
  const fullPayload = {
    scope: 'openid profile',
    roles: ['student'],
    ...payload,
  }
  const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url')
  return `header.${encodedPayload}.signature`
}

function createIntegrationEnvironment() {
  const domainStore = new MemoryDomainStore()
  const objectStorage = new MemoryObjectStorage()
  const identityProvider = new MemoryIdentityProvider()

  const robinClient: RobinClient = {
    checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
    getEnrollmentStatus: async () => ({
      status: 'enrolled',
      embeddingCount: 10,
      message: 'Ready.',
    }),
    enroll: async () => ({ imagesProcessed: 10, imagesFailed: 0, totalEmbeddings: 10 }),
    identify: async () => ({
      status: 'ok',
      confidence: 0.94,
      qualityScore: 0.91,
      processTimeMs: 38,
      message: 'Face verified successfully',
    }),
    deleteEnrollment: async () => {},
  }

  const providers = {
    domainStore,
    objectStorage,
    identityProvider,
    robinClient,
  }

  const app = createApp({ providers })

  return { domainStore, identityProvider, objectStorage, robinClient, providers, app }
}

async function setupTestScenario(
  domainStore: MemoryDomainStore,
  identityProvider: MemoryIdentityProvider,
) {
  // 1. School
  await domainStore.createSchool({
    name: 'SMK Negeri 2 Banjarmasin',
    slug: 'smkn2-bjm',
  })

  // 2. Academic Period & Classes
  const period = await domainStore.createAcademicPeriod({
    name: '2026/2027 Ganjil',
    startDate: '2026-07-01',
    endDate: '2026-12-31',
    isActive: true,
  })

  const classRpl1 = await domainStore.createClass({
    name: 'XII RPL 1',
    grade: 12,
    academicPeriodId: period.id,
  })

  // 3. Approved Student 1
  domainStore.profiles.set('student-1', {
    user_id: 'student-1',
    full_name: 'Budi Santoso',
    email: 'student1@school.sch.id',
    nis: '1001',
    class_name: 'XII RPL 1',
    absence_number: '05',
    role: 'student',
    lifecycle_status: 'approved',
    gender: 'L',
    avatar_url: 'avatars/student-1.jpg',
  })
  identityProvider.users.set('student-1', {
    userId: 'student-1',
    email: 'student1@school.sch.id',
    roles: ['student'],
    scopes: ['openid', 'profile'],
  })
  await domainStore.enrollStudentInClass({
    userId: 'student-1',
    classId: classRpl1.id,
    academicPeriodId: period.id,
  })

  // 4. Approved Student 2
  domainStore.profiles.set('student-2', {
    user_id: 'student-2',
    full_name: 'Siti Aminah',
    email: 'student2@school.sch.id',
    nis: '1002',
    class_name: 'XII RPL 1',
    absence_number: '12',
    role: 'student',
    lifecycle_status: 'approved',
    gender: 'P',
  })
  identityProvider.users.set('student-2', {
    userId: 'student-2',
    email: 'student2@school.sch.id',
    roles: ['student'],
    scopes: ['openid', 'profile'],
  })
  await domainStore.enrollStudentInClass({
    userId: 'student-2',
    classId: classRpl1.id,
    academicPeriodId: period.id,
  })

  // 5. Pending Student
  domainStore.profiles.set('student-pending', {
    user_id: 'student-pending',
    full_name: 'Calon Siswa',
    email: 'calon@school.sch.id',
    nis: '1003',
    role: 'student',
    lifecycle_status: 'pending',
  })
  identityProvider.users.set('student-pending', {
    userId: 'student-pending',
    email: 'calon@school.sch.id',
    roles: ['student'],
  })

  // 6. Disabled Student
  domainStore.profiles.set('student-disabled', {
    user_id: 'student-disabled',
    full_name: 'Siswa Nonaktif',
    email: 'nonaktif@school.sch.id',
    nis: '1004',
    role: 'student',
    lifecycle_status: 'disabled',
  })
  identityProvider.users.set('student-disabled', {
    userId: 'student-disabled',
    email: 'nonaktif@school.sch.id',
    roles: ['student'],
  })

  // 7. Seed attendances
  domainStore.attendancesList.push(
    {
      id: 'att-s1-1',
      user_id: 'student-1',
      date: '2026-08-10',
      status: 'Hadir',
      action_type: 'check_in',
      latitude: -7.1234,
      longitude: 112.1234,
      created_at: '2026-08-10T07:05:00.000Z',
    },
    {
      id: 'att-s1-2',
      user_id: 'student-1',
      date: '2026-08-10',
      status: 'Pulang',
      action_type: 'check_out',
      latitude: -7.1234,
      longitude: 112.1234,
      created_at: '2026-08-10T15:00:00.000Z',
    },
    {
      id: 'att-s1-3',
      user_id: 'student-1',
      date: '2026-08-11',
      status: 'Terlambat',
      action_type: 'check_in',
      latitude: -7.1234,
      longitude: 112.1234,
      created_at: '2026-08-11T07:20:00.000Z',
    },
    {
      id: 'att-s2-1',
      user_id: 'student-2',
      date: '2026-08-10',
      status: 'Hadir',
      action_type: 'check_in',
      latitude: -7.1234,
      longitude: 112.1234,
      created_at: '2026-08-10T06:55:00.000Z',
    },
  )

  // 8. Seed leave requests
  domainStore.permits.push(
    {
      id: 'leave-s1-1',
      user_id: 'student-1',
      kategori_izin: 'sakit',
      deskripsi: 'Sakit tifus rawat inap',
      status: true,
      link_foto: 'permits/surat-inap.jpg',
      tanggal: '2026-08-15T00:00:00+07:00',
      approval_status: 'approved',
      created_at: '2026-08-15T06:00:00.000Z',
      rejection_reason: null,
      rejected_at: null,
    },
    {
      id: 'leave-s2-1',
      user_id: 'student-2',
      kategori_izin: 'pergi',
      deskripsi: 'Lomba olimpiade sains',
      status: true,
      link_foto: null,
      tanggal: '2026-08-16T00:00:00+07:00',
      approval_status: 'approved',
      created_at: '2026-08-16T06:00:00.000Z',
      rejection_reason: null,
      rejected_at: null,
    },
  )

  // 9. Calendar holiday
  await domainStore.createCalendarException({
    date: '2026-08-17',
    reason: 'Hari Kemerdekaan RI',
    isHoliday: true,
    academicPeriodId: period.id,
  })

  return { period, classRpl1 }
}

describe('Show Student Profile and Attendance History Integration (Ticket 12)', () => {
  it('GET /v1/mobile/profile returns authorized profile with class enrollment and lifecycle context', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupTestScenario(domainStore, identityProvider)

    const token = tokenFor({ sub: 'student-1' })
    const res = await app.request('/v1/mobile/profile', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.user_id).toBe('student-1')
    expect(json.data.full_name).toBe('Budi Santoso')
    expect(json.data.email).toBe('student1@school.sch.id')
    expect(json.data.nis).toBe('1001')
    expect(json.data.class_name).toBe('XII RPL 1')
    expect(json.data.absence_number).toBe('05')
    expect(json.data.gender).toBe('L')
    expect(json.data.role).toBe('student')
    expect(json.data.lifecycle_status).toBe('approved')
    expect(json.data.avatar_url).toBeDefined()
    expect(json.data.active_enrollment).toBeDefined()
    expect(json.data.active_enrollment.class_name).toBe('XII RPL 1')
  })

  it('GET /v1/mobile/profile/enrollment-history returns time-bounded Class Enrollment records', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupTestScenario(domainStore, identityProvider)

    const token = tokenFor({ sub: 'student-1' })
    const res = await app.request('/v1/mobile/profile/enrollment-history', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.items).toBeInstanceOf(Array)
    expect(json.data.items.length).toBeGreaterThanOrEqual(1)
    expect(json.data.items[0].user_id).toBe('student-1')
    expect(json.data.items[0].class_name).toBe('XII RPL 1')
    expect(json.data.items[0].status).toBe('active')
  })

  it('GET /v1/mobile/attendance returns only authorized student attendance history with filters', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupTestScenario(domainStore, identityProvider)

    const token = tokenFor({ sub: 'student-1' })

    // 1. Full list for student 1
    const resAll = await app.request('/v1/mobile/attendance', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(resAll.status).toBe(200)
    const jsonAll = await resAll.json()
    expect(jsonAll.data.items.length).toBe(3)
    expect(jsonAll.data.items.every((i: any) => i.user_id === 'student-1')).toBe(true)

    // 2. Filtered by date
    const resFiltered = await app.request(
      '/v1/mobile/attendance?startDate=2026-08-11&endDate=2026-08-11',
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    )
    expect(resFiltered.status).toBe(200)
    const jsonFiltered = await resFiltered.json()
    expect(jsonFiltered.data.items.length).toBe(1)
    expect(jsonFiltered.data.items[0].status).toBe('Terlambat')
    expect(jsonFiltered.data.items[0].date).toBe('2026-08-11')

    // 3. /history alias works identically
    const resHistory = await app.request('/v1/mobile/attendance/history', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(resHistory.status).toBe(200)
    const jsonHistory = await resHistory.json()
    expect(jsonHistory.data.items.length).toBe(3)
  })

  it('GET /v1/mobile/attendance/calendar returns monthly attendance, leave, holiday, and stats', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupTestScenario(domainStore, identityProvider)

    const token = tokenFor({ sub: 'student-1' })
    const res = await app.request('/v1/mobile/attendance/calendar?year=2026&month=8', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.year).toBe(2026)
    expect(json.data.month).toBe(8)
    expect(json.data.start_date).toBe('2026-08-01')
    expect(json.data.end_date).toBe('2026-08-31')

    // Stats
    expect(json.data.stats.hadir).toBe(1) // 2026-08-10 (check in Hadir + check out Pulang)
    expect(json.data.stats.terlambat).toBe(1) // 2026-08-11 (check in Terlambat)
    expect(json.data.stats.sakit).toBe(1) // 2026-08-15 (Leave Request sakit)

    // Items
    const items = json.data.items
    const aug10 = items.find((i: any) => i.date === '2026-08-10')
    expect(aug10).toBeDefined()
    expect(aug10.status).toBe('present')
    expect(aug10.check_in_time).toBe('2026-08-10T07:05:00.000Z')
    expect(aug10.check_out_time).toBe('2026-08-10T15:00:00.000Z')

    const aug11 = items.find((i: any) => i.date === '2026-08-11')
    expect(aug11).toBeDefined()
    expect(aug11.status).toBe('late')
    expect(aug11.is_late).toBe(true)

    const aug15 = items.find((i: any) => i.date === '2026-08-15')
    expect(aug15).toBeDefined()
    expect(aug15.status).toBe('sick')
    expect(aug15.attachment_url).toBeDefined()

    const aug17 = items.find((i: any) => i.date === '2026-08-17')
    expect(aug17).toBeDefined()
    expect(aug17.status).toBe('holiday')
    expect(aug17.holiday_reason).toBe('Hari Kemerdekaan RI')
  })

  it('GET /v1/mobile/leave-requests isolates student records and protects individual access', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupTestScenario(domainStore, identityProvider)

    // 1. Student 1 lists leave requests -> only sees their own
    const token1 = tokenFor({ sub: 'student-1' })
    const res1 = await app.request('/v1/mobile/leave-requests', {
      headers: { Authorization: `Bearer ${token1}` },
    })
    expect(res1.status).toBe(200)
    const json1 = await res1.json()
    expect(json1.data.items.length).toBe(1)
    expect(json1.data.items[0].id).toBe('leave-s1-1')
    expect(json1.data.items[0].category).toBe('sakit')

    // 2. Student 1 views their own leave request by ID
    const resDetail = await app.request('/v1/mobile/leave-requests/leave-s1-1', {
      headers: { Authorization: `Bearer ${token1}` },
    })
    expect(resDetail.status).toBe(200)
    const jsonDetail = await resDetail.json()
    expect(jsonDetail.data.id).toBe('leave-s1-1')

    // 3. Student 1 attempts to view Student 2's leave request -> 403 Forbidden
    const resForbidden = await app.request('/v1/mobile/leave-requests/leave-s2-1', {
      headers: { Authorization: `Bearer ${token1}` },
    })
    expect(resForbidden.status).toBe(403)
    const jsonForbidden = await resForbidden.json()
    expect(jsonForbidden.error.code).toBe('FORBIDDEN')
  })

  it('enforces student lifecycle approval gate on history and leave endpoints', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupTestScenario(domainStore, identityProvider)

    const pendingToken = tokenFor({ sub: 'student-pending' })
    const disabledToken = tokenFor({ sub: 'student-disabled' })

    // Pending student blocked from attendance history
    const resAttPending = await app.request('/v1/mobile/attendance', {
      headers: { Authorization: `Bearer ${pendingToken}` },
    })
    expect(resAttPending.status).toBe(403)

    // Disabled student blocked from attendance calendar
    const resCalDisabled = await app.request('/v1/mobile/attendance/calendar', {
      headers: { Authorization: `Bearer ${disabledToken}` },
    })
    expect(resCalDisabled.status).toBe(403)

    // Pending student blocked from leave requests
    const resLeavePending = await app.request('/v1/mobile/leave-requests', {
      headers: { Authorization: `Bearer ${pendingToken}` },
    })
    expect(resLeavePending.status).toBe(403)
  })
})
