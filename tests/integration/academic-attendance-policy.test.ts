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

  it('supports modifying locations and schedules via both PUT and PATCH methods (ISS-12)', async () => {
    const { app, adminToken } = setupPolicyTestEnvironment()

    // 1. Create a location
    const createLocRes = await app.request('/v1/admin/locations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Initial Campus',
        latitude: -6.2,
        longitude: 106.816666,
        radius_meters: 100,
      }),
    })
    expect(createLocRes.status).toBe(201)
    const locId = (await createLocRes.json()).data.id

    // 2. Update location via PUT
    const putLocRes = await app.request(`/v1/admin/locations/${locId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Campus Updated via PUT',
        radius_meters: 150,
      }),
    })
    expect(putLocRes.status).toBe(200)
    const putLocBody = await putLocRes.json()
    expect(putLocBody.data.name).toBe('Campus Updated via PUT')
    expect(putLocBody.data.radius_meters).toBe(150)

    // 3. Update location via PATCH
    const patchLocRes = await app.request(`/v1/admin/locations/${locId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Campus Updated via PATCH',
        radius_meters: 200,
      }),
    })
    expect(patchLocRes.status).toBe(200)
    const patchLocBody = await patchLocRes.json()
    expect(patchLocBody.data.name).toBe('Campus Updated via PATCH')
    expect(patchLocBody.data.radius_meters).toBe(200)

    // 4. Create a schedule
    const createSchedRes = await app.request('/v1/admin/schedules', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        day_of_week: 'senin',
        start_time: '06:00',
        end_time: '07:15',
        start_checkout: '15:00',
        end_checkout: '18:00',
        grace_period_minutes: 15,
        location_id: locId,
      }),
    })
    expect(createSchedRes.status).toBe(201)
    const schedId = (await createSchedRes.json()).data.id

    // 5. Update schedule via PUT
    const putSchedRes = await app.request(`/v1/admin/schedules/${schedId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grace_period_minutes: 20,
      }),
    })
    expect(putSchedRes.status).toBe(200)
    const putSchedBody = await putSchedRes.json()
    expect(putSchedBody.data.kompensasi_waktu).toBe(20)

    // 6. Update schedule via PATCH
    const patchSchedRes = await app.request(`/v1/admin/schedules/${schedId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grace_period_minutes: 25,
      }),
    })
    expect(patchSchedRes.status).toBe(200)
    const patchSchedBody = await patchSchedRes.json()
    expect(patchSchedBody.data.kompensasi_waktu).toBe(25)
  })

  it('updates a UUID schedule partially without clearing its existing values', async () => {
    const { app, domainStore, adminToken } = setupPolicyTestEnvironment()
    const scheduleId = 'd85474f9-9d2b-4f13-bc55-18f2c66f82f4'
    domainStore.schedules.set(scheduleId, {
      id: scheduleId,
      school_id: 'b1246237-46ec-44ae-abff-1c3eb9b3c899',
      class_id: 'e043a145-a0f8-4b21-b53c-5ddb8042ab20',
      academic_period_id: '42de502f-3a7e-412e-a1c3-5af2b4cc40da',
      location_id: '0e7bb61c-8267-4b94-84ca-e165007a23bc',
      day_of_week: 'senin',
      hari: 'senin',
      mulai_masuk: '06:00:00',
      selesai_masuk: '07:15:00',
      mulai_pulang: '15:00:00',
      selesai_pulang: '18:00:00',
      kompensasi_waktu: 15,
      is_active: true,
    })

    const putRes = await app.request(`/v1/admin/schedules/${scheduleId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ start_time: '06:30', grace_period_minutes: 20 }),
    })
    expect(putRes.status).toBe(200)
    const putBody = await putRes.json()
    expect(putBody.data).toMatchObject({
      id: scheduleId,
      mulai_masuk: '06:30',
      selesai_masuk: '07:15:00',
      mulai_pulang: '15:00:00',
      selesai_pulang: '18:00:00',
      kompensasi_waktu: 20,
      location_id: '0e7bb61c-8267-4b94-84ca-e165007a23bc',
    })

    const patchRes = await app.request(`/v1/admin/schedules/${scheduleId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ end_checkout: '18:30' }),
    })
    expect(patchRes.status).toBe(200)
    const patchBody = await patchRes.json()
    expect(patchBody.data).toMatchObject({
      id: scheduleId,
      mulai_masuk: '06:30',
      selesai_pulang: '18:30',
      kompensasi_waktu: 20,
      class_id: 'e043a145-a0f8-4b21-b53c-5ddb8042ab20',
    })
  })
})
