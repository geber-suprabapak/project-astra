import { describe, expect, it, vi } from 'vitest'
import type { UserProfile } from '../../src/providers/types.js'
import { setupTestEnvironment, tokenFor } from './helpers/staff-roles-fixture.js'

describe('integration: manage staff, roles, and permissions (Ticket 05)', () => {
  it('keeps revoked tokens denied while allowing a fresh token after re-enable', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-27T10:00:00Z'))
      const { app, schoolAdminToken } = setupTestEnvironment()
      const headers = {
        Authorization: `Bearer ${schoolAdminToken}`,
        'Content-Type': 'application/json',
      }
      const created = await app.request('/v1/admin/staff', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: 'lifecycle@example.test',
          full_name: 'Lifecycle Staff',
          role: 'staff',
        }),
      })
      expect(created.status).toBe(201)
      const { data } = await created.json()
      const issue = () =>
        tokenFor({
          sub: data.user_id,
          roles: ['staff'],
          scope: 'openid profile admin:read',
          iat: Math.floor(Date.now() / 1000),
        })
      const access = (token: string) =>
        app.request('/v1/admin/session', { headers: { Authorization: `Bearer ${token}` } })
      const update = (status: string) =>
        app.request(`/v1/admin/staff/${data.user_id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ lifecycle_status: status }),
        })
      const old = issue()
      expect((await access(old)).status).toBe(200)
      vi.setSystemTime(new Date('2026-10-27T10:00:01.500Z'))
      expect((await update('disabled')).status).toBe(200)
      expect((await access(old)).status).toBe(401)
      const duringDisabled = issue()
      vi.setSystemTime(new Date('2026-10-27T10:00:03.500Z'))
      expect((await update('approved')).status).toBe(200)
      expect((await access(old)).status).toBe(401)
      expect((await access(duringDisabled)).status).toBe(401)
      expect((await access(issue())).status).toBe(401)
      vi.setSystemTime(new Date('2026-10-27T10:00:04Z'))
      const fresh = issue()
      expect((await access(fresh)).status).toBe(200)
      expect(
        (await access(tokenFor({ sub: data.user_id, roles: ['staff'], scope: 'admin:read' })))
          .status,
      ).toBe(401)
      vi.setSystemTime(new Date('2026-10-27T10:00:05Z'))
      expect((await update('disabled')).status).toBe(200)
      expect((await access(fresh)).status).toBe(401)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not publish re-enable or success audit when identity session revocation fails', async () => {
    const { app, schoolAdminToken, identityProvider, domainStore } = setupTestEnvironment()
    const headers = {
      Authorization: `Bearer ${schoolAdminToken}`,
      'Content-Type': 'application/json',
    }
    const created = await app.request('/v1/admin/staff', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: 'failure@example.test',
        full_name: 'Failure Staff',
        role: 'staff',
      }),
    })
    const { data } = await created.json()
    await app.request(`/v1/admin/staff/${data.user_id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ lifecycle_status: 'disabled' }),
    })
    const before = await domainStore.getAuditLogs('profile', data.user_id)
    vi.spyOn(identityProvider, 'revokeUserSessions').mockRejectedValue(new Error('IdP unavailable'))
    const response = await app.request(`/v1/admin/staff/${data.user_id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ lifecycle_status: 'approved' }),
    })
    expect(response.status).toBe(500)
    expect((await domainStore.getStaffProfile(data.user_id))?.lifecycle_status).toBe('disabled')
    expect(await domainStore.getAuditLogs('profile', data.user_id)).toEqual(before)
    vi.restoreAllMocks()
  })

  it('keeps the profile disabled and old tokens denied when Logto revocation fails', async () => {
    const { app, schoolAdminToken, identityProvider, domainStore } = setupTestEnvironment()
    const headers = {
      Authorization: `Bearer ${schoolAdminToken}`,
      'Content-Type': 'application/json',
    }
    const created = await app.request('/v1/admin/staff', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: 'containment@example.test',
        full_name: 'Containment Staff',
        role: 'staff',
      }),
    })
    const { data } = await created.json()
    vi.spyOn(identityProvider, 'revokeUserSessions').mockRejectedValue(new Error('IdP unavailable'))
    const response = await app.request(`/v1/admin/staff/${data.user_id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ lifecycle_status: 'disabled' }),
    })
    expect(response.status).toBe(500)
    expect((await domainStore.getStaffProfile(data.user_id))?.lifecycle_status).toBe('disabled')
    expect(await domainStore.getAuditLogs('profile', data.user_id)).toHaveLength(1)
    const old = tokenFor({ sub: data.user_id, roles: ['staff'], scope: 'admin:read' })
    expect(
      (await app.request('/v1/admin/session', { headers: { Authorization: `Bearer ${old}` } }))
        .status,
    ).toBe(401)
    vi.restoreAllMocks()
  })

  describe('Multi-Role Assignment and Effective Permissions Union', () => {
    it('effective permissions endpoint returns the union of active assigned roles', async () => {
      const { app, schoolAdminToken } = setupTestEnvironment()

      // Create staff with multi-role: teacher and staff
      const createRes = await app.request('/v1/admin/staff', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${schoolAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'multirole@school.sch.id',
          fullName: 'Multi Role Member',
          role: 'teacher',
          roles: ['teacher', 'staff'],
        }),
      })
      // SAFETY: response JSON follows standard envelope
      const createdStaff = (await createRes.json()) as { data: UserProfile }

      const effPermsRes = await app.request(
        `/v1/admin/staff/${createdStaff.data.user_id}/effective-permissions`,
        {
          headers: { Authorization: `Bearer ${schoolAdminToken}` },
        },
      )
      expect(effPermsRes.status).toBe(200)
      // SAFETY: response JSON follows standard envelope
      const effPermsBody = (await effPermsRes.json()) as {
        data: { user_id: string; roles: string[]; permissions: string[] }
      }
      expect(effPermsBody.data.roles).toContain('teacher')
      expect(effPermsBody.data.roles).toContain('staff')
      expect(effPermsBody.data.permissions).toContain('attendance:read')
      expect(effPermsBody.data.permissions).toContain('leave:approve')
    })
  })

  describe('Staff Password Recovery and Session Revocation', () => {
    it('initiates password recovery and logs audit entry', async () => {
      const { app, domainStore, schoolAdminToken } = setupTestEnvironment()

      const createRes = await app.request('/v1/admin/staff', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${schoolAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'forgot.pass@school.sch.id',
          fullName: 'Forgot Password Staff',
          role: 'teacher',
        }),
      })
      // SAFETY: response JSON follows standard envelope
      const staff = (await createRes.json()) as { data: UserProfile }

      const resetRes = await app.request(`/v1/admin/staff/${staff.data.user_id}/reset-password`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${schoolAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      expect(resetRes.status).toBe(200)

      const auditLogs = await domainStore.getAuditLogs('profile', staff.data.user_id)
      expect(auditLogs.some((l) => l.action === 'request_staff_password_reset')).toBe(true)
    })

    it('revokes active sessions immediately when staff profile is disabled or rejected', async () => {
      const { app, domainStore, schoolAdminToken } = setupTestEnvironment()

      // Create staff
      const createRes = await app.request('/v1/admin/staff', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${schoolAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'active.staff@school.sch.id',
          fullName: 'Active Staff Member',
          role: 'teacher',
        }),
      })
      // SAFETY: response JSON follows standard envelope
      const staff = (await createRes.json()) as { data: UserProfile }

      // Generate active bearer token for this staff
      const staffToken = tokenFor({
        sub: staff.data.user_id,
        roles: ['teacher'],
        scope: 'openid profile',
      })

      // Authenticated request works initially
      const initRes = await app.request('/v1/mobile/profile', {
        headers: { Authorization: `Bearer ${staffToken}` },
      })
      expect(initRes.status).toBe(200)

      // Admin disables the staff member
      const disableRes = await app.request(`/v1/admin/staff/${staff.data.user_id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${schoolAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          lifecycle_status: 'disabled',
        }),
      })
      expect(disableRes.status).toBe(200)
      expect(await domainStore.isSessionRevoked(staff.data.user_id)).toBe(true)

      // Subsequent requests with previously issued token must now fail with 401
      const blockedRes = await app.request('/v1/mobile/profile', {
        headers: { Authorization: `Bearer ${staffToken}` },
      })
      expect(blockedRes.status).toBe(401)
      // SAFETY: error response body conforms to standard error envelope
      const errBody = (await blockedRes.json()) as { error: { message: string } }
      expect(errBody.error.message).toContain('Session has been revoked')
    })
  })
})
