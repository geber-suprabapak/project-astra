import { describe, expect, it } from 'vitest'
import type { JWTPayload } from 'jose'
import { createApp } from '../../src/app.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../src/providers/memory/index.js'
import type { RobinClient } from '../../src/clients/robin/client.js'

const robinClient: RobinClient = {
  checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
  getEnrollmentStatus: async () => ({
    status: 'enrolled',
    embeddingCount: 1,
    message: 'Enrolled.',
  }),
  enroll: async () => ({
    status: 'ok',
    userId: 'student-1',
    samplesReceived: 1,
    embeddingsCreated: 1,
    message: 'Enrollment complete.',
  }),
  identify: async () => ({
    status: 'match',
    candidateId: 'student-1',
    confidence: 0.95,
    threshold: 0.7,
    qualityScore: 0.9,
    processTimeMs: 10,
  }),
  deleteEnrollment: async () => {},
}

function tokenFor(payload: JWTPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${encodedPayload}.signature`
}

function setupPolicyTestEnvironment() {
  const domainStore = new MemoryDomainStore()
  const identityProvider = new MemoryIdentityProvider()

  // Seed school admin
  domainStore.profiles.set('school-admin-1', {
    user_id: 'school-admin-1',
    full_name: 'School Admin',
    email: 'admin@school.sch.id',
    role: 'school_admin',
    lifecycle_status: 'approved',
    gender: null,
  })

  // Seed student profile
  domainStore.profiles.set('student-1', {
    user_id: 'student-1',
    full_name: 'Budi Santoso',
    nis: '54321',
    role: 'student',
    lifecycle_status: 'approved',
    gender: 'male',
  })

  const app = createApp({
    providers: {
      domainStore,
      identityProvider,
      objectStorage: new MemoryObjectStorage(),
      robinClient,
    },
  })

  const adminToken = tokenFor({
    sub: 'school-admin-1',
    email: 'admin@school.sch.id',
    roles: ['school_admin'],
    scope: 'openid profile admin:read',
    must_change_password: false,
    mfa_verified: true,
  })

  const studentToken = tokenFor({
    sub: 'student-1',
    email: 'budi@school.sch.id',
    roles: ['student'],
    scope: 'openid profile',
    must_change_password: false,
  })

  return { app, domainStore, identityProvider, adminToken, studentToken }
}

describe('Academic Attendance Policy Integration', () => {
  it('manages full lifecycle of academic policies and applies attendance rules', async () => {
    const { app, adminToken, studentToken } = setupPolicyTestEnvironment()

    // 1. Create Academic Period
    const createPeriodRes = await app.request('/v1/admin/academic-periods', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: '2026/2027 Ganjil',
        start_date: '2026-07-01',
        end_date: '2026-12-31',
        is_active: true,
      }),
    })
    expect(createPeriodRes.status).toBe(201)
    const periodData = await createPeriodRes.json()
    const periodId = periodData.data.id

    // 2. Create Classes
    const createClassRes1 = await app.request('/v1/admin/classes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'X RPL 1',
        grade: 10,
        academic_period_id: periodId,
      }),
    })
    expect(createClassRes1.status).toBe(201)
    const class1 = await createClassRes1.json()
    const class1Id = class1.data.id

    const createClassRes2 = await app.request('/v1/admin/classes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'X RPL 2',
        grade: 10,
        academic_period_id: periodId,
      }),
    })
    expect(createClassRes2.status).toBe(201)
    const class2 = await createClassRes2.json()
    const class2Id = class2.data.id

    // 3. Enroll student in Class 1
    const enrollRes = await app.request('/v1/admin/enrollments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: 'student-1',
        class_id: class1Id,
        academic_period_id: periodId,
      }),
    })
    expect(enrollRes.status).toBe(201)

    // 4. Duplicate active enrollment in same period is rejected with 409
    const dupEnrollRes = await app.request('/v1/admin/enrollments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: 'student-1',
        class_id: class2Id,
        academic_period_id: periodId,
      }),
    })
    expect(dupEnrollRes.status).toBe(409)

    // 5. Create Geofence Location
    const locRes = await app.request('/v1/admin/locations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Kampus Utama',
        latitude: -3.316694,
        longitude: 114.590111,
        radius_meters: 100,
        is_active: true,
      }),
    })
    expect(locRes.status).toBe(201)
    const locData = await locRes.json()
    const locationId = locData.data.id

    // 6. Create Schedule for today
    const dayMap = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu']
    const todayDay = dayMap[new Date(Date.now() + 7 * 60 * 60 * 1000).getUTCDay()]

    const schedRes = await app.request('/v1/admin/schedules', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        day_of_week: todayDay,
        start_time: '00:00',
        end_time: '23:59',
        start_checkout: '00:00',
        end_checkout: '23:59',
        grace_period_minutes: 30,
        location_id: locationId,
        class_id: class1Id,
        academic_period_id: periodId,
        is_active: true,
      }),
    })
    expect(schedRes.status).toBe(201)

    // 7. Student checks dashboard - should allow check in
    const dashboardRes = await app.request('/v1/mobile/dashboard', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${studentToken}`,
      },
    })
    expect(dashboardRes.status).toBe(200)
    const dashData = await dashboardRes.json()
    expect(dashData.data.primary_action.allowed).toBe(true)
    expect(dashData.data.profile.class_name).toBe('X RPL 1')

    // 8. Transfer student to Class 2
    const transferRes = await app.request('/v1/admin/enrollments/transfer', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: 'student-1',
        to_class_id: class2Id,
        academic_period_id: periodId,
      }),
    })
    expect(transferRes.status).toBe(200)

    // Verify profile updated to X RPL 2
    const dashAfterTransfer = await app.request('/v1/mobile/dashboard', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${studentToken}`,
      },
    })
    const dashAfterData = await dashAfterTransfer.json()
    expect(dashAfterData.data.profile.class_name).toBe('X RPL 2')
  })
})
