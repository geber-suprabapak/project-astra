import { describe, expect, it } from 'vitest'
import { SignJWT, type JWTPayload } from 'jose'
import { createApp } from '../../src/app.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../src/providers/memory/index.js'
import type { RobinClient } from '../../src/clients/robin/client.js'

const OIDC_SECRET = 'test-secret-at-least-32-chars-long-12345'

async function token(claims: JWTPayload): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('http://logto.test/oidc')
    .setAudience('astra-api')
    .setSubject(claims.sub ?? 'user-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(OIDC_SECRET))
}

const wibDate = (offsetDays = 0) => {
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000)
  now.setUTCDate(now.getUTCDate() + offsetDays)
  return now.toISOString().slice(0, 10)
}

async function setup() {
  const domainStore = new MemoryDomainStore()
  const identityProvider = new MemoryIdentityProvider()
  const robinClient: RobinClient = {
    checkReadiness: async () => ({ healthy: true }),
    getEnrollmentStatus: async () => ({ status: 'enrolled', embeddingCount: 1, message: 'Ready.' }),
    enroll: async () => ({ imagesProcessed: 1, imagesFailed: 0, totalEmbeddings: 1 }),
    identify: async () => ({ status: 'ok', processTimeMs: 1 }),
    deleteEnrollment: async () => {},
  }
  domainStore.profiles.set('student-1', {
    user_id: 'student-1',
    full_name: 'Student One',
    role: 'student',
    lifecycle_status: 'approved',
  })
  domainStore.profiles.set('school-admin-1', {
    user_id: 'school-admin-1',
    full_name: 'School Admin',
    role: 'school_admin',
    lifecycle_status: 'approved',
  })
  domainStore.profiles.set('teacher-1', {
    user_id: 'teacher-1',
    full_name: 'Teacher One',
    role: 'teacher',
    lifecycle_status: 'approved',
  })
  const period = await domainStore.createAcademicPeriod({
    name: '2026/2027',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    isActive: true,
  })
  const classRoom = await domainStore.createClass({
    name: 'XII RPL 1',
    academicPeriodId: period.id,
  })
  await domainStore.enrollStudentInClass({
    userId: 'student-1',
    classId: classRoom.id,
    academicPeriodId: period.id,
  })
  await domainStore.createLocation({
    name: 'Campus',
    latitude: -6.2,
    longitude: 106.816666,
    radiusMeters: 5000,
  })
  for (const dayOfWeek of ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu']) {
    await domainStore.createSchedule({
      dayOfWeek,
      startTime: '00:00:00',
      endTime: '23:59:59',
      startCheckout: '00:00:00',
      endCheckout: '23:59:59',
      classId: classRoom.id,
      academicPeriodId: period.id,
    })
  }
  await domainStore.saveFaceEnrollment({ userId: 'student-1', status: 'enrolled', sampleCount: 1 })
  identityProvider.users.set('student-1', {
    userId: 'student-1',
    roles: ['student'],
    scopes: ['attendance:write'],
  })
  identityProvider.users.set('school-admin-1', {
    userId: 'school-admin-1',
    roles: ['school_admin'],
    scopes: ['admin:read', 'admin:write'],
    mfaVerified: true,
    mustChangePassword: false,
  })
  identityProvider.users.set('teacher-1', {
    userId: 'teacher-1',
    roles: ['teacher'],
    scopes: ['admin:read', 'admin:write'],
    mfaVerified: true,
    mustChangePassword: false,
  })
  const providers = {
    domainStore,
    identityProvider,
    objectStorage: new MemoryObjectStorage(),
    robinClient,
  }
  return { domainStore, app: createApp({ providers }) }
}

describe('attendance gate and leave force-finish', () => {
  it('allows Attendance for pending and rejected Leave Requests', async () => {
    for (const approvalStatus of ['pending', 'rejected'] as const) {
      const { domainStore, app } = await setup()
      const today = wibDate()
      const leave = await domainStore.createLeaveRequest({
        user_id: 'student-1',
        category: 'sakit',
        description: `${approvalStatus} leave`,
        date: `${today}T00:00:00+07:00`,
        approval_status: approvalStatus,
      })
      const adminToken = await token({
        sub: 'school-admin-1',
        roles: ['school_admin'],
        scope: 'admin:read admin:write',
        mfa_verified: true,
        must_change_password: false,
      })

      const response = await app.request('/v1/admin/attendance/manual', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: 'student-1',
          action_type: 'check_in',
          date: today,
          reason: `${approvalStatus} leave must not block attendance`,
        }),
      })

      expect(response.status, approvalStatus).toBe(201)
      expect(leave.approval_status).toBe(approvalStatus)
    }
  })

  it('blocks mobile check-in/check-out and manual Attendance through the inclusive effective end, then opens the next WIB day after force-finish', async () => {
    const { domainStore, app } = await setup()
    const today = wibDate()
    const start = wibDate(-1)
    const leave = await domainStore.insertPermit({
      user_id: 'student-1',
      kategori_izin: 'sakit',
      deskripsi: 'Medical leave',
      status: false,
      link_foto: null,
      tanggal: `${start}T00:00:00+07:00`,
    })
    await domainStore.updateLeaveRequestStatus({
      id: leave.id,
      approvalStatus: 'approved',
      durationDays: 2,
    })

    const adminToken = await token({
      sub: 'school-admin-1',
      roles: ['school_admin'],
      scope: 'admin:read admin:write',
      mfa_verified: true,
      must_change_password: false,
    })
    const studentToken = await token({
      sub: 'student-1',
      roles: ['student'],
      scope: 'attendance:write',
    })
    const headers = {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    }

    const precheckBlocked = await app.request('/v1/mobile/attendance/precheck', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ latitude: -6.2, longitude: 106.816666 }),
    })
    expect(precheckBlocked.status).toBe(200)
    expect((await precheckBlocked.json()).data).toMatchObject({ allowed: false })

    for (const actionType of ['check_in', 'check_out'] as const) {
      const mobileBlocked = await app.request('/v1/mobile/attendance/submit', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${studentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action_type: actionType,
          image_base64: 'data:image/jpeg;base64,dGVzdA==',
          latitude: -6.2,
          longitude: 106.816666,
        }),
      })
      expect(mobileBlocked.status, actionType).toBe(409)
      expect((await mobileBlocked.json()).error).toMatchObject({
        code: 'ATTENDANCE_BLOCKED',
      })
    }

    for (const actionType of ['check_in', 'check_out'] as const) {
      const blocked = await app.request('/v1/admin/attendance/manual', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          user_id: 'student-1',
          action_type: actionType,
          date: today,
          reason: 'Manual verification',
        }),
      })
      expect(blocked.status, actionType).toBe(409)
      expect((await blocked.json()).error).toMatchObject({ code: 'ATTENDANCE_BLOCKED' })
    }
    expect(await domainStore.listAttendances({ userId: 'student-1' })).toHaveLength(0)

    const extension = await app.request(`/v1/admin/leave-requests/${leave.id}/force-finish`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ effective_end_date: wibDate(1), reason: 'Invalid extension' }),
    })
    expect(extension.status).toBe(409)
    expect((await extension.json()).error.message).toContain('cannot extend')

    const invalidDate = await app.request(`/v1/admin/leave-requests/${leave.id}/force-finish`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ effective_end_date: '2026-02-30', reason: 'Invalid calendar date' }),
    })
    expect(invalidDate.status).toBe(422)

    const finished = await app.request(`/v1/admin/leave-requests/${leave.id}/force-finish`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ effective_end_date: start, reason: 'Student returned early' }),
    })
    expect(finished.status).toBe(200)
    const finishedBody = await finished.json()
    expect(finishedBody.data.original_end_date).toBe(today)
    expect(finishedBody.data.effective_end_date).toBe(start)

    const allowed = await app.request('/v1/admin/attendance/manual', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        user_id: 'student-1',
        action_type: 'check_in',
        date: today,
        reason: 'Manual verification after return',
      }),
    })
    expect(allowed.status).toBe(201)
    expect(await domainStore.listAttendances({ userId: 'student-1' })).toHaveLength(1)

    const audit = await domainStore.getAuditLogs('leave_request', leave.id)
    const forceFinish = audit.find((entry) => entry.action === 'force_finish_leave_request')
    expect(forceFinish).toMatchObject({
      actor_id: 'school-admin-1',
      details: {
        effective_end_date: start,
        original_end_date: today,
        reason: 'Student returned early',
      },
    })
    expect(forceFinish?.created_at).toBeDefined()
  })

  it('rejects force-finish from a non-school-admin role', async () => {
    const { domainStore, app } = await setup()
    const today = wibDate()
    const leave = await domainStore.insertPermit({
      user_id: 'student-1',
      kategori_izin: 'sakit',
      deskripsi: 'Medical leave',
      status: false,
      link_foto: null,
      tanggal: `${today}T00:00:00+07:00`,
    })
    await domainStore.updateLeaveRequestStatus({
      id: leave.id,
      approvalStatus: 'approved',
      durationDays: 2,
    })
    const teacherToken = await token({
      sub: 'teacher-1',
      roles: ['teacher'],
      scope: 'admin:read admin:write',
      mfa_verified: true,
      must_change_password: false,
    })

    const response = await app.request(`/v1/admin/leave-requests/${leave.id}/force-finish`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${teacherToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ effective_end_date: today, reason: 'Not allowed' }),
    })

    expect(response.status).toBe(403)
    expect(await domainStore.getLeaveRequestById(leave.id)).toMatchObject({
      original_end_date: wibDate(1),
      effective_end_date: wibDate(1),
    })
  })
})
