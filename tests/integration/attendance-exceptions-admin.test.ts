import { describe, expect, it } from 'vitest'
import {
  createIntegrationEnvironment,
  setupSchoolAndStudent,
  signedOidcToken,
} from './helpers/attendance-exceptions-fixture.js'

describe('Admin Manual Attendance Exceptions & RBAC Integration Tests (Ticket 09)', () => {
  it('Admin API: Query attendance attempts and create manual attendance exception with audit trail', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupSchoolAndStudent(domainStore, identityProvider, 'student-1')

    // 1. Student experiences a failed verification
    const failedAttempt = await domainStore.recordAttendanceAttempt({
      userId: 'student-1',
      actionType: 'check_in',
      status: 'failed',
      reason: 'Low lighting conditions in classroom',
      confidence: 0.4,
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
    const listRes = await app.request(
      '/v1/admin/attendance/attempts?status=failed&userId=student-1',
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      },
    )
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
    expect(auditLogs[0].details?.reason).toBe(
      'Manually verified by homeroom teacher after lighting defect',
    )
  })

  it('Admin API: deletes one attendance and bulk-deletes attendance records with audit trail', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupSchoolAndStudent(domainStore, identityProvider, 'student-1')

    const adminToken = await signedOidcToken({
      sub: 'school-admin-1',
      roles: ['school_admin'],
      scope: 'admin:read admin:write openid profile',
      mfa_verified: true,
      must_change_password: false,
    })

    const first = await domainStore.createManualAttendance({
      userId: 'student-1',
      actionType: 'check_in',
      status: 'Hadir',
      reason: 'Delete regression first record',
      date: '2026-08-28',
      actorId: 'school-admin-1',
    })
    const second = await domainStore.createManualAttendance({
      userId: 'student-1',
      actionType: 'check_out',
      status: 'Pulang',
      reason: 'Delete regression second record',
      date: '2026-08-28',
      actorId: 'school-admin-1',
    })
    const third = await domainStore.createManualAttendance({
      userId: 'student-1',
      actionType: 'check_in',
      status: 'Terlambat',
      reason: 'Delete regression third record',
      date: '2026-08-29',
      actorId: 'school-admin-1',
    })

    const emptyBulkRes = await app.request('/v1/admin/attendance/bulk', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: [] }),
    })
    expect(emptyBulkRes.status).toBe(422)

    const duplicateBulkRes = await app.request('/v1/admin/attendance/bulk', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: [first.id, first.id] }),
    })
    expect(duplicateBulkRes.status).toBe(422)

    const failedBulkRes = await app.request('/v1/admin/attendance/bulk', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: [second.id, 'attendance-does-not-exist'] }),
    })
    expect(failedBulkRes.status).toBe(404)
    expect(
      (await domainStore.listAttendances({ userId: 'student-1' })).map(
        (attendance) => attendance.id,
      ),
    ).toEqual(expect.arrayContaining([first.id, second.id, third.id]))

    const deleteRes = await app.request(`/v1/admin/attendance/${first.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(deleteRes.status).toBe(200)
    const deleteBody = await deleteRes.json()
    expect(deleteBody.success).toBe(true)
    expect(deleteBody.data.id).toBe(first.id)

    const afterSingleDelete = await domainStore.listAttendances({ userId: 'student-1' })
    expect(afterSingleDelete.map((attendance) => attendance.id)).not.toContain(first.id)

    const bulkRes = await app.request('/v1/admin/attendance/bulk', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: [second.id, third.id] }),
    })
    expect(bulkRes.status).toBe(200)
    const bulkBody = await bulkRes.json()
    expect(bulkBody.success).toBe(true)
    expect(bulkBody.data).toEqual({
      deletedCount: 2,
      deletedIds: [second.id, third.id],
    })

    expect(await domainStore.listAttendances({ userId: 'student-1' })).toHaveLength(0)
    for (const id of [first.id, second.id, third.id]) {
      const auditLogs = await domainStore.getAuditLogs('attendance', id)
      expect(auditLogs.some((log) => log.action === 'delete_attendance')).toBe(true)
      expect(auditLogs.find((log) => log.action === 'delete_attendance')?.actor_id).toBe(
        'school-admin-1',
      )
    }
  })

  it('RBAC: Student cannot access /v1/admin/attendance/manual (403)', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupSchoolAndStudent(domainStore, identityProvider, 'student-1')
    const attempt = await domainStore.recordAttendanceAttempt({
      userId: 'student-1',
      actionType: 'check_in',
      status: 'failed',
      reason: 'Camera unavailable',
    })

    domainStore.profiles.set('platform-admin-1', {
      user_id: 'platform-admin-1',
      full_name: 'Platform Admin 1',
      email: 'platform-admin@school.sch.id',
      role: 'platform_admin',
      lifecycle_status: 'approved',
    })
    identityProvider.users.set('platform-admin-1', {
      userId: 'platform-admin-1',
      email: 'platform-admin@school.sch.id',
      roles: ['platform_admin'],
      scopes: ['openid', 'profile', 'admin:read', 'admin:write'],
      mfaVerified: true,
      mustChangePassword: false,
    })

    const platformAdminToken = await signedOidcToken({
      sub: 'platform-admin-1',
      roles: ['platform_admin'],
      scope: 'admin:read admin:write openid profile',
      mfa_verified: true,
      must_change_password: false,
    })
    const platformAdminRes = await app.request('/v1/admin/attendance/manual', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${platformAdminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: 'student-1',
        action_type: 'check_in',
        date: '2026-08-22',
        status: 'Hadir',
        reason: 'Verified in person after camera failure',
        attempt_id: attempt.id,
      }),
    })
    expect(platformAdminRes.status).not.toBe(403)
    expect(await domainStore.listAttendances({ userId: 'student-1' })).toHaveLength(0)

    const studentToken = await signedOidcToken({
      sub: 'student-1',
      roles: ['student'],
      scope: 'admin:read attendance:write openid profile',
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
        attempt_id: 'not-used-for-unauthorized-role',
      }),
    })

    expect(res.status).toBe(403)

    const teacherToken = await signedOidcToken({
      sub: 'teacher-1',
      roles: ['teacher'],
      scope: 'admin:read admin:write attendance:write openid profile',
    })
    const teacherRes = await app.request('/v1/admin/attendance/manual', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${teacherToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: 'student-1',
        action_type: 'check_in',
        reason: 'Teacher attempts a manual attendance write',
        attempt_id: 'not-used-for-unauthorized-role',
      }),
    })
    expect(teacherRes.status).toBe(403)

    const deleteRes = await app.request('/v1/admin/attendance/nonexistent', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${studentToken}` },
    })
    expect(deleteRes.status).toBe(403)
  })

  it('requires a related attendance attempt before recording manual attendance', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupSchoolAndStudent(domainStore, identityProvider, 'student-1')
    const adminToken = await signedOidcToken({
      sub: 'school-admin-1',
      roles: ['school_admin'],
      scope: 'admin:read admin:write openid profile',
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
        reason: 'Physical verification completed by the school administrator',
      }),
    })

    expect(response.status).toBe(422)
    expect(await domainStore.listAttendances({ userId: 'student-1' })).toHaveLength(0)
  })
})
