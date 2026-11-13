import { describe, expect, it } from 'vitest'
import {
  createIntegrationEnvironment,
  setupTestUsers,
  tokenFor,
} from './helpers/leave-requests-fixture.js'

describe('Ticket 10 Integration: Chronos Leave History & Overlap Conflicts', () => {
  it.each(['platform_admin', 'school_admin', 'teacher', 'staff'] as const)(
    'allows Chronos %s to read sanitized Leave decision history',
    async (role) => {
      const { domainStore, identityProvider, app } = createIntegrationEnvironment()
      await setupTestUsers(domainStore, identityProvider)
      const actorId = `history-reader-${role}`
      domainStore.profiles.set(actorId, {
        user_id: actorId,
        full_name: 'History Reader',
        role,
        lifecycle_status: 'approved',
      })
      identityProvider.users.set(actorId, {
        userId: actorId,
        roles: [role],
        scopes: ['openid', 'profile', 'admin:read'],
      })
      const token = tokenFor({
        sub: actorId,
        roles: [role],
        scope: 'openid profile admin:read',
      })
      const leave = await domainStore.createLeaveRequest({
        user_id: 'student-1',
        category: 'sakit',
        description: 'Synthetic history test',
        date: '2026-08-28',
      })
      await domainStore.insertAuditLog({
        actor_id: 'private-actor-id',
        action: 'approve_leave_request',
        entity_type: 'leave_request',
        entity_id: leave.id,
        details: {
          actor_name: 'Name at decision',
          actor_role: 'teacher',
          reason: 'private audit detail',
        },
      })
      await domainStore.insertAuditLog({
        actor_id: 'private-actor-id',
        action: 'reject_leave_request',
        entity_type: 'leave_request',
        entity_id: leave.id,
        details: { actor_name: 'Reject Actor', actor_role: 'staff' },
      })
      await domainStore.insertAuditLog({
        actor_id: 'legacy-private-actor-id',
        action: 'reopen_leave_request',
        entity_type: 'leave_request',
        entity_id: leave.id,
        details: { reason: 'legacy private detail' },
      })
      await domainStore.insertAuditLog({
        actor_id: 'private-actor-id',
        action: 'force_finish_leave_request',
        entity_type: 'leave_request',
        entity_id: leave.id,
        details: { actor_name: 'Finish Actor', actor_role: 'platform_admin' },
      })
      await domainStore.insertAuditLog({
        actor_id: 'private-actor-id',
        action: 'create_admin_leave_request',
        entity_type: 'leave_request',
        entity_id: leave.id,
        details: { actor_name: 'Do not expose create actor' },
      })

      const response = await app.request(`/v1/admin/leave-requests/${leave.id}/history`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(response.status).toBe(200)
      const { data } = await response.json()
      expect(data).toHaveLength(4)
      expect(data).toContainEqual({
        action: 'approve_leave_request',
        occurred_at: expect.any(String),
        actor_name: 'Name at decision',
        actor_role: 'teacher',
      })
      expect(data).toContainEqual({
        action: 'reject_leave_request',
        occurred_at: expect.any(String),
        actor_name: 'Reject Actor',
        actor_role: 'staff',
      })
      expect(data).toContainEqual({
        action: 'reopen_leave_request',
        occurred_at: expect.any(String),
        actor_name: null,
        actor_role: null,
      })
      expect(data).toContainEqual({
        action: 'force_finish_leave_request',
        occurred_at: expect.any(String),
        actor_name: 'Finish Actor',
        actor_role: 'platform_admin',
      })
      expect(JSON.stringify(data)).not.toContain('private')
      expect(JSON.stringify(data)).not.toContain('actor_id')
    },
  )

  it('denies students access to the admin Leave decision history endpoint', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupTestUsers(domainStore, identityProvider)
    identityProvider.users.set('student-1', {
      userId: 'student-1',
      roles: ['student'],
      scopes: ['openid', 'profile', 'admin:read'],
    })
    const leave = await domainStore.createLeaveRequest({
      user_id: 'student-1',
      category: 'sakit',
      description: 'Synthetic history access test',
      date: '2026-08-28',
    })
    const token = tokenFor({
      sub: 'student-1',
      roles: ['student'],
      scope: 'openid profile admin:read',
    })

    const response = await app.request(`/v1/admin/leave-requests/${leave.id}/history`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(response.status).toBe(403)
  })

  describe.each(['/v1/admin/leave-requests', '/v1/admin/permits'])(
    'Chronos manual creation through %s',
    (path) => {
      it.each(['platform_admin', 'school_admin', 'teacher', 'staff'] as const)(
        'allows approved %s to create and approve a Leave Request',
        async (role) => {
          const { domainStore, identityProvider, app } = createIntegrationEnvironment()
          await setupTestUsers(domainStore, identityProvider)
          const actorId = `chronos-${role}`
          domainStore.profiles.set(actorId, {
            user_id: actorId,
            full_name: 'Chronos user',
            role,
            lifecycle_status: 'approved',
          })
          identityProvider.users.set(actorId, {
            userId: actorId,
            roles: [role],
            scopes: ['openid', 'profile', 'admin:read', 'leave:read'],
            mfaVerified: true,
            mustChangePassword: false,
          })
          const token = tokenFor({
            sub: actorId,
            roles: [role],
            scope: 'openid profile admin:read leave:read',
          })
          const response = await app.request(path, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_id: 'student-1',
              category: 'pergi',
              description: 'Chronos manual request',
              date: '2026-08-28',
            }),
          })
          expect(response.status).toBe(201)
          const { data } = await response.json()
          expect(data).toMatchObject({
            user_id: 'student-1',
            approval_status: 'pending',
            status: false,
          })
          const logs = await domainStore.getAuditLogs('leave_request', data.id)
          expect(logs).toHaveLength(1)
          expect(logs[0].actor_id).toBe(actorId)
          const review = await app.request(`${path}/${data.id}/approve`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ duration_days: 1 }),
          })
          expect(review.status).toBe(200)
          expect((await domainStore.getLeaveRequestById(data.id))?.approval_status).toBe('approved')
          const reviewLogs = await domainStore.getAuditLogs('leave_request', data.id)
          expect(reviewLogs.at(-1)?.actor_id).toBe(actorId)
        },
      )
    },
  )

  it.each(['platform_admin', 'school_admin', 'teacher', 'staff'] as const)(
    'allows approved %s to reject and reopen a Leave Request',
    async (role) => {
      const { domainStore, identityProvider, app } = createIntegrationEnvironment()
      await setupTestUsers(domainStore, identityProvider)
      const actorId = `chronos-${role}`
      domainStore.profiles.set(actorId, {
        user_id: actorId,
        full_name: 'Chronos user',
        role,
        lifecycle_status: 'approved',
      })
      identityProvider.users.set(actorId, {
        userId: actorId,
        roles: [role],
        scopes: ['openid', 'profile', 'admin:read', 'leave:read'],
        mfaVerified: true,
        mustChangePassword: false,
      })
      const actorToken = tokenFor({
        sub: actorId,
        roles: [role],
        scope: 'openid profile admin:read leave:read',
      })
      const headers = {
        Authorization: `Bearer ${actorToken}`,
        'Content-Type': 'application/json',
      }
      const created = await app.request('/v1/admin/leave-requests', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          user_id: 'student-1',
          category: 'pergi',
          description: 'Chronos manual request',
          date: '2026-08-28',
        }),
      })
      expect(created.status).toBe(201)
      const { data: leave } = await created.json()

      const rejected = await app.request(`/v1/admin/leave-requests/${leave.id}/reject`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reason: 'Verified by Chronos role' }),
      })
      expect(rejected.status).toBe(200)
      expect((await domainStore.getLeaveRequestById(leave.id))?.approval_status).toBe('rejected')

      const reopened = await app.request(`/v1/admin/leave-requests/${leave.id}/reopen`, {
        method: 'POST',
        headers,
      })
      expect(reopened.status).toBe(200)
      expect((await domainStore.getLeaveRequestById(leave.id))?.approval_status).toBe('pending')
      const logs = await domainStore.getAuditLogs('leave_request', leave.id)
      expect(logs.slice(-2).map((entry) => entry.actor_id)).toEqual([actorId, actorId])
    },
  )

  it('rejects pending and overlapping requests atomically and reports every approval attendance conflict', async () => {
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

    const create = (date: string) =>
      app.request('/v1/mobile/leave-requests', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${studentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          category: 'sakit',
          description: `Permohonan sakit ${date}`,
          date,
        }),
      })

    const first = await create('2026-08-20')
    expect(first.status).toBe(201)
    const firstBody = await first.json()

    const pending = await create('2026-08-21')
    expect(pending.status).toBe(409)
    const pendingBody = await pending.json()
    expect(pendingBody.error.code).toBe('LEAVE_REQUEST_PENDING')
    expect(pendingBody.error.details).toMatchObject({
      pending_request_id: firstBody.data.id,
      requested_start_date: '2026-08-21',
    })

    const reject = await app.request(`/v1/admin/leave-requests/${firstBody.data.id}/reject`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Silakan ajukan ulang dengan tanggal yang benar.' }),
    })
    expect(reject.status).toBe(200)

    const approved = await create('2026-08-21')
    expect(approved.status).toBe(201)
    const approvedBody = await approved.json()
    const approve = await app.request(`/v1/admin/leave-requests/${approvedBody.data.id}/approve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ duration_days: 2 }),
    })
    expect(approve.status).toBe(200)

    const boundary = await create('2026-08-22')
    expect(boundary.status).toBe(409)
    const boundaryBody = await boundary.json()
    expect(boundaryBody.error.code).toBe('LEAVE_PERIOD_OVERLAP')
    expect(boundaryBody.error.details.overlapping_request_id).toBe(approvedBody.data.id)

    const future = await create('2026-08-23')
    expect(future.status).toBe(201)
    const futureBody = await future.json()
    const rejectFuture = await app.request(
      `/v1/admin/leave-requests/${futureBody.data.id}/reject`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Disiapkan ulang untuk pengujian konflik kehadiran.' }),
      },
    )
    expect(rejectFuture.status).toBe(200)

    await domainStore.insertAttendance({
      user_id: 'student-1',
      date: '2026-08-24',
      status: 'Hadir',
      action_type: 'check_in',
    })
    await domainStore.insertAttendance({
      user_id: 'student-1',
      date: '2026-08-26',
      status: 'Pulang',
      action_type: 'check_out',
    })

    const conflictBody = await domainStore.createLeaveRequest({
      user_id: 'student-1',
      category: 'sakit',
      description: 'Permohonan sakit 2026-08-24',
      date: '2026-08-24T00:00:00+07:00',
      approval_status: 'pending',
    })
    const conflictApprove = await app.request(
      `/v1/admin/leave-requests/${conflictBody.id}/approve`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ duration_days: 3 }),
      },
    )
    expect(conflictApprove.status).toBe(409)
    const conflictError = await conflictApprove.json()
    expect(conflictError.error.code).toBe('LEAVE_APPROVAL_CONFLICT')
    expect(conflictError.error.details.conflicting_dates).toEqual(['2026-08-24', '2026-08-26'])

    const unchanged = await app.request(`/v1/admin/leave-requests/${conflictBody.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    const unchangedBody = await unchanged.json()
    expect(unchangedBody.data.approval_status).toBe('pending')
    expect(unchangedBody.data.original_end_date).toBeNull()
    expect(unchangedBody.data.effective_end_date).toBeNull()
    expect(
      (await domainStore.getTodayAbsences('student-1', '2026-08-24')).map((row) => row.date),
    ).toEqual(['2026-08-24'])
    expect(
      (await domainStore.getTodayAbsences('student-1', '2026-08-26')).map((row) => row.date),
    ).toEqual(['2026-08-26'])
  })
})
