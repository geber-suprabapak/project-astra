import { describe, expect, it } from 'vitest'
import { SignJWT, type JWTPayload } from 'jose'
import { createApp } from '../../src/app.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../src/providers/memory/index.js'
import type { RobinClient } from '../../src/clients/robin/client.js'
import { AppError } from '../../src/lib/errors/app-error.js'

const OIDC_SECRET = 'test-secret-at-least-32-chars-long-12345'

async function signedOidcToken(
  claims: JWTPayload,
  audience = 'astra-api',
  expirationTime: string | number = '5m',
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('http://logto.test/oidc')
    .setAudience(audience)
    .setSubject(claims.sub ?? 'user-1')
    .setIssuedAt()
    .setExpirationTime(expirationTime)
    .sign(new TextEncoder().encode(OIDC_SECRET))
}

function createIntegrationEnvironment(customRobinClient?: Partial<RobinClient>) {
  const domainStore = new MemoryDomainStore()
  const objectStorage = new MemoryObjectStorage()
  const identityProvider = new MemoryIdentityProvider()

  const defaultRobinClient: RobinClient = {
    checkReadiness: async () => ({ healthy: true }),
    getEnrollmentStatus: async () => ({ status: 'enrolled', embeddingCount: 10, message: 'Ready.' }),
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

  // SAFETY: test environment merges defaultRobinClient and partial override to form valid RobinClient
  const robinClient = { ...defaultRobinClient, ...customRobinClient } as RobinClient

  const providers = {
    domainStore,
    objectStorage,
    identityProvider,
    robinClient,
  }

  const app = createApp({ providers })

  return { domainStore, identityProvider, objectStorage, robinClient, providers, app }
}

async function setupSchoolAndStudent(domainStore: MemoryDomainStore, identityProvider: MemoryIdentityProvider, studentId = 'student-1') {
  // 1. School
  await domainStore.createSchool({
    name: 'SMK Negeri 2 Banjarmasin',
    slug: 'smkn2-bjm',
  })

  // 2. Academic Period
  const period = await domainStore.createAcademicPeriod({
    name: '2026/2027 Ganjil',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    isActive: true,
  })

  // 3. Class
  const classRoom = await domainStore.createClass({
    name: 'XII RPL 1',
    academicPeriodId: period.id,
    grade: 12,
  })

  // 4. Student profile & identity
  domainStore.profiles.set(studentId, {
    user_id: studentId,
    full_name: 'Ahmad Dahlan',
    email: `${studentId}@school.sch.id`,
    nis: '1001',
    class_name: 'XII RPL 1',
    role: 'student',
    lifecycle_status: 'approved',
    gender: 'L',
  })
  identityProvider.users.set(studentId, {
    userId: studentId,
    email: `${studentId}@school.sch.id`,
    roles: ['student'],
    scopes: ['openid', 'profile', 'attendance:write'],
  })

  // 5. Class Enrollment
  await domainStore.enrollStudentInClass({
    userId: studentId,
    classId: classRoom.id,
    academicPeriodId: period.id,
  })

  // 6. Geofence Location
  await domainStore.createLocation({
    name: 'Campus Ground',
    latitude: -6.2,
    longitude: 106.816666,
    radiusMeters: 5000,
    isActive: true,
  })

  // 7. Schedule
  const days = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu']
  for (const d of days) {
    await domainStore.createSchedule({
      dayOfWeek: d,
      startTime: '00:00:00',
      endTime: '23:59:59',
      startCheckout: '00:00:00',
      endCheckout: '23:59:59',
      gracePeriodMinutes: 30,
      isActive: true,
      classId: classRoom.id,
      academicPeriodId: period.id,
    })
  }

  // 8. Face Enrollment
  await domainStore.saveFaceEnrollment({
    userId: studentId,
    status: 'enrolled',
    sampleCount: 10,
  })

  // Pre-seed School Admin
  domainStore.profiles.set('school-admin-1', {
    user_id: 'school-admin-1',
    full_name: 'School Admin 1',
    email: 'admin@school.sch.id',
    role: 'school_admin',
    lifecycle_status: 'approved',
  })
  identityProvider.users.set('school-admin-1', {
    userId: 'school-admin-1',
    email: 'admin@school.sch.id',
    roles: ['school_admin'],
    scopes: ['openid', 'profile', 'admin:read', 'admin:write'],
    mfaVerified: true,
    mustChangePassword: false,
  })

  return { period, classRoom }
}

describe('Record Face Attendance & Manual Exceptions Integration Tests (Ticket 09)', () => {
  it('POST /v1/mobile/attendance/submit - Happy path records Attendance and Success Attempt', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupSchoolAndStudent(domainStore, identityProvider, 'student-1')

    const studentToken = await signedOidcToken({
      sub: 'student-1',
      roles: ['student'],
      scope: 'attendance:write openid profile',
    })

    const res = await app.request('/v1/mobile/attendance/submit', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action_type: 'check_in',
        image_base64: 'data:image/jpeg;base64,dGVzdA==',
        latitude: -6.2,
        longitude: 106.816666,
      }),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.attendance_type).toBe('check_in')
    expect(body.data.status_label).toBe('Hadir')

    // Verify domain store state
    const attempts = await domainStore.listAttendanceAttempts({ userId: 'student-1' })
    expect(attempts).toHaveLength(1)
    expect(attempts[0].status).toBe('success')

    const attendances = await domainStore.listAttendances({ userId: 'student-1' })
    expect(attendances).toHaveLength(1)
    expect(attendances[0].status).toBe('Hadir')
  })

  it('POST /v1/mobile/attendance/submit - Face non-match creates Attempt (status: failed) and NO Attendance', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment({
      identify: async () => ({
        status: 'not_found',
        confidence: 0.38,
        processTimeMs: 40,
        message: 'Face does not match enrolled face',
      }),
    })
    await setupSchoolAndStudent(domainStore, identityProvider, 'student-1')

    const studentToken = await signedOidcToken({
      sub: 'student-1',
      roles: ['student'],
      scope: 'attendance:write openid profile',
    })

    const res = await app.request('/v1/mobile/attendance/submit', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action_type: 'check_in',
        image_base64: 'data:image/jpeg;base64,dGVzdA==',
        latitude: -6.2,
        longitude: 106.816666,
      }),
    })

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('ATTENDANCE_BLOCKED')

    // Attempt recorded with status failed
    const attempts = await domainStore.listAttendanceAttempts({ userId: 'student-1' })
    expect(attempts).toHaveLength(1)
    expect(attempts[0].status).toBe('failed')
    expect(attempts[0].confidence).toBe(0.38)

    // No attendance persisted
    const attendances = await domainStore.listAttendances({ userId: 'student-1' })
    expect(attendances).toHaveLength(0)
  })

  it('POST /v1/mobile/attendance/submit - Robin timeout yields Observable Error Attempt and NO Attendance', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment({
      identify: async () => {
        throw AppError.upstreamTimeout('Robin')
      },
    })
    await setupSchoolAndStudent(domainStore, identityProvider, 'student-1')

    const studentToken = await signedOidcToken({
      sub: 'student-1',
      roles: ['student'],
      scope: 'attendance:write openid profile',
    })

    const res = await app.request('/v1/mobile/attendance/submit', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action_type: 'check_in',
        image_base64: 'data:image/jpeg;base64,dGVzdA==',
        latitude: -6.2,
        longitude: 106.816666,
      }),
    })

    expect(res.status).toBe(504)

    // Attempt recorded with status error
    const attempts = await domainStore.listAttendanceAttempts({ userId: 'student-1' })
    expect(attempts).toHaveLength(1)
    expect(attempts[0].status).toBe('error')

    // No attendance
    const attendances = await domainStore.listAttendances({ userId: 'student-1' })
    expect(attendances).toHaveLength(0)
  })

  it('Admin API: Query attendance attempts and create manual attendance exception with audit trail', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupSchoolAndStudent(domainStore, identityProvider, 'student-1')

    // 1. Student experiences a failed verification
    const failedAttempt = await domainStore.recordAttendanceAttempt({
      userId: 'student-1',
      actionType: 'check_in',
      status: 'failed',
      reason: 'Low lighting conditions in classroom',
      confidence: 0.40,
      latitude: -6.2,
      longitude: 106.816666,
      processTimeMs: 110,
    })

    const adminToken = await signedOidcToken({
      sub: 'school-admin-1',
      roles: ['school_admin'],
      scope: 'admin:read admin:write openid profile',
      mfa_verified: true,
      must_change_password: false,
    })

    // 2. School Admin lists attendance attempts
    const listRes = await app.request('/v1/admin/attendance/attempts?status=failed&userId=student-1', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    })
    expect(listRes.status).toBe(200)
    const listBody = await listRes.json()
    expect(listBody.success).toBe(true)
    expect(listBody.data).toHaveLength(1)
    expect(listBody.data[0].id).toBe(failedAttempt.id)

    // 3. School Admin gets single attempt
    const getRes = await app.request(`/v1/admin/attendance/attempts/${failedAttempt.id}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    })
    expect(getRes.status).toBe(200)
    const getBody = await getRes.json()
    expect(getBody.data.reason).toBe('Low lighting conditions in classroom')

    // 4. School Admin creates manual attendance referencing the attempt
    const manualRes = await app.request('/v1/admin/attendance/manual', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: 'student-1',
        action_type: 'check_in',
        status: 'Hadir',
        reason: 'Manually verified by homeroom teacher after lighting defect',
        attempt_id: failedAttempt.id,
      }),
    })

    expect(manualRes.status).toBe(201)
    const manualBody = await manualRes.json()
    expect(manualBody.success).toBe(true)
    expect(manualBody.data.user_id).toBe('student-1')
    expect(manualBody.data.status).toBe('Hadir')

    // 5. Verify attendance created and audit log logged
    const attendances = await domainStore.listAttendances({ userId: 'student-1' })
    expect(attendances).toHaveLength(1)
    expect(attendances[0].status).toBe('Hadir')

    const auditLogs = await domainStore.getAuditLogs('attendance', manualBody.data.id)
    expect(auditLogs.length).toBeGreaterThan(0)
    expect(auditLogs[0].actor_id).toBe('school-admin-1')
    expect(auditLogs[0].action).toBe('create_manual_attendance')
    expect(auditLogs[0].details?.attempt_id).toBe(failedAttempt.id)
    expect(auditLogs[0].details?.reason).toBe('Manually verified by homeroom teacher after lighting defect')
  })

  it('RBAC: Student cannot access /v1/admin/attendance/manual (403)', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupSchoolAndStudent(domainStore, identityProvider, 'student-1')

    const studentToken = await signedOidcToken({
      sub: 'student-1',
      roles: ['student'],
      scope: 'attendance:write openid profile',
    })

    const res = await app.request('/v1/admin/attendance/manual', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: 'student-1',
        action_type: 'check_in',
        reason: 'Illegal self-override',
      }),
    })

    expect(res.status).toBe(403)
  })
})
