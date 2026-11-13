import { describe, expect, it } from 'vitest'
import {
  createIntegrationEnvironment,
  setupTestUsers,
  tokenFor,
} from './helpers/leave-requests-fixture.js'

describe('Ticket 10 Integration: Leave Requests Admin Lifecycle & Conflicts', () => {
  it('School administrator reviews, approves, rejects, and manages leave request lifecycle', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupTestUsers(domainStore, identityProvider)

    const studentToken = tokenFor({ sub: 'student-1', roles: ['student'], scope: 'openid profile' })
    const adminToken = tokenFor({
      sub: 'admin-1',
      roles: ['school_admin'],
      scope: 'openid profile admin:read leave:read leave:approve',
      mfa_verified: true,
      must_change_password: false,
    })

    // Student creates leave request 1
    const create1Res = await app.request('/v1/mobile/leave-requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        category: 'sakit',
        description: 'Sakit tipes rawat jalan dokter',
        date: '2026-08-23',
      }),
    })
    const leave1 = (await create1Res.json()).data

    // Student creates leave request 2
    const student2Token = tokenFor({
      sub: 'student-2',
      roles: ['student'],
      scope: 'openid profile',
    })
    const create2Res = await app.request('/v1/mobile/leave-requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${student2Token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        category: 'pergi',
        description: 'Liburan ke pantai bersama teman',
        date: '2026-08-24',
      }),
    })
    const leave2 = (await create2Res.json()).data

    // Admin lists all leave requests
    const adminListRes = await app.request('/v1/admin/leave-requests', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(adminListRes.status).toBe(200)
    const adminListBody = await adminListRes.json()
    expect(adminListBody.data).toHaveLength(2)
    const budi = adminListBody.data.find(
      (item: { user_id: string }) => item.user_id === 'student-1',
    )
    expect(budi.student_name).toBe('Budi Santoso')
    expect(budi.student_nis).toBe('1001')
    expect(budi.student_class).toBe('XII RPL 1')

    // Admin approves leave request 1
    const approveRes = await app.request(`/v1/admin/leave-requests/${leave1.id}/approve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ duration_days: 2 }),
    })
    expect(approveRes.status).toBe(200)
    const approveBody = await approveRes.json()
    expect(approveBody.data.approval_status).toBe('approved')
    expect(approveBody.data.status).toBe(true)
    expect(approveBody.data.requested_start_date).toBe('2026-08-23')
    expect(approveBody.data.original_end_date).toBe('2026-08-24')
    expect(approveBody.data.effective_end_date).toBe('2026-08-24')
    expect(approveBody.data.duration_days).toBe(2)

    // Student cannot delete approved leave request
    const studentDeleteRes = await app.request(`/v1/mobile/leave-requests/${leave1.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${studentToken}` },
    })
    expect(studentDeleteRes.status).toBe(409)

    // Admin rejects leave request 2 with reason
    const rejectRes = await app.request(`/v1/admin/leave-requests/${leave2.id}/reject`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reason: 'Liburan pribadi tidak diizinkan pada hari efektif sekolah.',
      }),
    })
    expect(rejectRes.status).toBe(200)
    const rejectBody = await rejectRes.json()
    expect(rejectBody.data.approval_status).toBe('rejected')
    expect(rejectBody.data.rejection_reason).toBe(
      'Liburan pribadi tidak diizinkan pada hari efektif sekolah.',
    )
    expect(rejectBody.data.rejected_at).toBeDefined()

    // Student cancels pending or admin deletes leave request
    const adminDeleteRes = await app.request(`/v1/admin/leave-requests/${leave2.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(adminDeleteRes.status).toBe(200)
  })

  it('does not expose an approved Leave Request when its required audit write fails', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupTestUsers(domainStore, identityProvider)
    const adminToken = tokenFor({
      sub: 'admin-1',
      roles: ['school_admin'],
      scope: 'openid profile admin:read leave:read leave:approve',
      mfa_verified: true,
      must_change_password: false,
    })
    const permit = await domainStore.createLeaveRequest({
      user_id: 'student-1',
      category: 'sakit',
      description: 'Synthetic audit-failure route case',
      date: '2026-08-21T00:00:00+07:00',
      approval_status: 'pending',
    })
    domainStore.insertAuditLog = async () => {
      throw new Error('synthetic audit failure')
    }

    const response = await app.request(`/v1/admin/leave-requests/${permit.id}/approve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ duration_days: 3 }),
    })

    expect(response.status).toBe(500)
    expect(await domainStore.getLeaveRequestById(permit.id)).toMatchObject({
      approval_status: 'pending',
      status: false,
      original_end_date: null,
      effective_end_date: null,
    })
    expect(await domainStore.getAuditLogs('leave_request', permit.id)).toHaveLength(0)
  })

  it('Student submits a leave request and administrator updates it via PATCH', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupTestUsers(domainStore, identityProvider)

    const adminToken = tokenFor({
      sub: 'admin-1',
      roles: ['school_admin'],
      scope: 'openid profile admin:read admin:write leave:read leave:approve',
      mfa_verified: true,
      must_change_password: false,
    })
    const studentToken = tokenFor({ sub: 'student-1', roles: ['student'], scope: 'openid profile' })

    // 1. Student submits a leave request; approval is a separate transition.
    const createRes = await app.request('/v1/mobile/leave-requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        category: 'sakit',
        description: 'Sakit demam berdarah dicatat oleh tata usaha',
        date: '2026-08-28',
      }),
    })

    expect(createRes.status).toBe(201)
    const createBody = await createRes.json()
    expect(createBody.success).toBe(true)
    expect(createBody.data.id).toBeDefined()
    expect(createBody.data.category).toBe('sakit')
    expect(createBody.data.approval_status).toBe('pending')
    const permitId = createBody.data.id
    expect(permitId).toBeDefined()

    // A pending leave request must not block a physical attendance record for the same student.
    const attendanceAttempt = await domainStore.recordAttendanceAttempt({
      userId: 'student-1',
      actionType: 'check_in',
      status: 'failed',
      reason: 'Manual attendance scenario after the student presence was checked',
    })
    const attendanceAttemptIndex = domainStore.attendanceAttempts.findIndex(
      (attempt) => attempt.id === attendanceAttempt.id,
    )
    domainStore.attendanceAttempts[attendanceAttemptIndex] = {
      ...attendanceAttempt,
      created_at: '2026-08-27T17:00:00.000Z',
    }
    const attendanceRes = await app.request('/v1/admin/attendance/manual', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: 'student-1',
        action_type: 'check_in',
        status: 'Hadir',
        reason: 'Physical attendance recorded while leave is pending',
        date: '2026-08-28',
        attempt_id: attendanceAttempt.id,
      }),
    })

    expect(attendanceRes.status).toBe(201)
    const attendanceBody = await attendanceRes.json()
    expect(attendanceBody.data.user_id).toBe('student-1')
    expect(attendanceBody.data.date).toBe('2026-08-28')
    expect(attendanceBody.data.status).toBe('Hadir')

    // 2. Admin creates leave request with explicit pending status
    const student2Token = tokenFor({
      sub: 'student-2',
      roles: ['student'],
      scope: 'openid profile',
    })
    const pendingCreateRes = await app.request('/v1/mobile/leave-requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${student2Token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        category: 'dispensasi',
        description: 'Dispensasi olimpiade sains',
        date: '2026-08-29',
      }),
    })

    expect(pendingCreateRes.status).toBe(201)
    const pendingBody = await pendingCreateRes.json()
    expect(pendingBody.data.approval_status).toBe('pending')
    const pendingPermitId = pendingBody.data.id

    // 3. Admin updates pending permit via PATCH /v1/admin/leave-requests/:id
    const patchRes = await app.request(`/v1/admin/leave-requests/${pendingPermitId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        approval_status: 'approved',
        duration_days: 1,
      }),
    })

    expect(patchRes.status).toBe(200)
    const patchBody = await patchRes.json()
    expect(patchBody.data.approval_status).toBe('approved')
    expect(patchBody.data.status).toBe(true)

    // 4. Student token calling POST /v1/admin/leave-requests is rejected with 403 Forbidden
    const forbiddenRes = await app.request('/v1/admin/leave-requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: 'student-1',
        category: 'sakit',
        description: 'Trying to call admin route as student',
        date: '2026-08-28',
      }),
    })
    expect(forbiddenRes.status).toBe(403)

    // 5. The privileged admin route rejects a student before validating its payload
    const invalidRes = await app.request('/v1/admin/leave-requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: 'student-1',
        category: 'invalid_cat',
        date: 'not-a-date',
      }),
    })
    expect(invalidRes.status).toBe(403)
  })

  it('School administrator reopens a rejected leave request via PATCH and dedicated POST /reopen endpoints', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupTestUsers(domainStore, identityProvider)

    const adminToken = tokenFor({
      sub: 'admin-1',
      roles: ['school_admin'],
      scope: 'openid profile admin:read admin:write leave:read leave:approve',
      mfa_verified: true,
      must_change_password: false,
    })
    const studentToken = tokenFor({ sub: 'student-1', roles: ['student'], scope: 'openid profile' })

    // 1. Student submits leave request
    const createRes = await app.request('/v1/mobile/leave-requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        category: 'pergi',
        description: 'Menghadiri resepsi pernikahan',
        date: '2026-08-30',
      }),
    })
    const leaveId = (await createRes.json()).data.id

    // 2. Admin rejects the leave request
    const rejectRes = await app.request(`/v1/admin/leave-requests/${leaveId}/reject`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reason: 'Dokumentasi tidak lengkap',
      }),
    })
    expect(rejectRes.status).toBe(200)
    const rejectBody = await rejectRes.json()
    expect(rejectBody.data.approval_status).toBe('rejected')
    expect(rejectBody.data.rejection_reason).toBe('Dokumentasi tidak lengkap')
    expect(rejectBody.data.rejected_at).toBeDefined()

    // 3. Admin reopens via PATCH /v1/admin/leave-requests/:id with Chronos reset payload
    const patchReopenRes = await app.request(`/v1/admin/leave-requests/${leaveId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        approval_status: 'pending',
        status: false,
        rejection_reason: null,
        rejected_at: null,
      }),
    })
    expect(patchReopenRes.status).toBe(200)
    const patchReopenBody = await patchReopenRes.json()
    expect(patchReopenBody.success).toBe(true)
    expect(patchReopenBody.data.approval_status).toBe('pending')
    expect(patchReopenBody.data.status).toBe(false)
    expect(patchReopenBody.data.rejection_reason).toBeNull()
    expect(patchReopenBody.data.rejected_at).toBeNull()

    // 4. Reject again to test dedicated POST /reopen endpoint
    await app.request(`/v1/admin/leave-requests/${leaveId}/reject`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Ditolak lagi' }),
    })

    // 5. Admin reopens via POST /v1/admin/leave-requests/:id/reopen
    const postReopenRes = await app.request(`/v1/admin/leave-requests/${leaveId}/reopen`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    })
    expect(postReopenRes.status).toBe(200)
    const postReopenBody = await postReopenRes.json()
    expect(postReopenBody.success).toBe(true)
    expect(postReopenBody.data.approval_status).toBe('pending')
    expect(postReopenBody.data.status).toBe(false)
    expect(postReopenBody.data.rejection_reason).toBeNull()
    expect(postReopenBody.data.rejected_at).toBeNull()

    // 6. Test permit alias POST /v1/admin/permits/:id/reopen
    // Reject again
    await app.request(`/v1/admin/permits/${leaveId}/reject`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Ditolak untuk alias check' }),
    })

    const permitReopenRes = await app.request(`/v1/admin/permits/${leaveId}/reopen`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    })
    expect(permitReopenRes.status).toBe(200)
    const permitReopenBody = await permitReopenRes.json()
    expect(permitReopenBody.data.approval_status).toBe('pending')
    expect(permitReopenBody.data.rejection_reason).toBeNull()

    // 7. Student token attempting to reopen is forbidden (403)
    const studentReopenRes = await app.request(`/v1/admin/leave-requests/${leaveId}/reopen`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
      },
    })
    expect(studentReopenRes.status).toBe(403)

    // 8. Reopening non-existent leave request returns 404
    const notFoundRes = await app.request(
      '/v1/admin/leave-requests/00000000-0000-0000-0000-000000000000/reopen',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      },
    )
    expect(notFoundRes.status).toBe(404)
  })
})
