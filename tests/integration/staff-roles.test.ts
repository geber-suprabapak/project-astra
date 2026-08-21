import { describe, expect, it } from 'vitest'
import type { JWTPayload } from 'jose'
import { createApp } from '../../src/app.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../src/providers/memory/index.js'
import type { RobinClient } from '../../src/clients/robin/client.js'
import type { Role, UserProfile } from '../../src/providers/types.js'

const robinClient: RobinClient = {
  checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
  getEnrollmentStatus: async () => ({
    status: 'not_enrolled',
    embeddingCount: 0,
    message: 'No enrollment found.',
  }),
  enroll: async () => ({
    status: 'ok',
    userId: 'platform-admin-1',
    samplesReceived: 0,
    embeddingsCreated: 0,
    message: 'Enrollment complete.',
  }),
  identify: async () => ({
    status: 'no_match',
    candidateId: null,
    confidence: 0,
    threshold: 0.7,
    qualityScore: 0,
    processTimeMs: 0,
  }),
  deleteEnrollment: async () => {},
}

function tokenFor(payload: JWTPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${encodedPayload}.signature`
}

function setupTestEnvironment() {
  const domainStore = new MemoryDomainStore()
  const identityProvider = new MemoryIdentityProvider()

  // Seed platform admin
  domainStore.profiles.set('platform-admin-1', {
    user_id: 'platform-admin-1',
    full_name: 'Platform Admin',
    email: 'admin@platform.sch.id',
    role: 'platform_admin',
    lifecycle_status: 'approved',
    gender: null,
  })

  // Seed school admin
  domainStore.profiles.set('school-admin-1', {
    user_id: 'school-admin-1',
    full_name: 'School Admin',
    email: 'admin@school.sch.id',
    role: 'school_admin',
    lifecycle_status: 'approved',
    gender: null,
  })

  const app = createApp({
    providers: {
      domainStore,
      objectStorage: new MemoryObjectStorage(),
      identityProvider,
      robinClient,
    },
  })

  const platformAdminToken = tokenFor({
    sub: 'platform-admin-1',
    roles: ['platform_admin'],
    scope: 'openid profile admin:read',
    must_change_password: false,
    mfa_verified: true,
  })

  const schoolAdminToken = tokenFor({
    sub: 'school-admin-1',
    roles: ['school_admin'],
    scope: 'openid profile admin:read',
    must_change_password: false,
    mfa_verified: true,
  })

  return { app, domainStore, identityProvider, platformAdminToken, schoolAdminToken }
}

describe('integration: manage staff, roles, and permissions (Ticket 05)', () => {
  describe('RBAC Policy and Role Definition (Platform Admin vs School Admin)', () => {
    it('platform_admin can create roles, assign permissions, update, and deactivate roles with audit trail', async () => {
      const { app, domainStore, platformAdminToken } = setupTestEnvironment()

      // 1. Create role
      const createRes = await app.request('/v1/admin/roles', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${platformAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'counselor',
          description: 'Guidance Counselor',
          permissions: ['attendance:read', 'leave:read', 'leave:approve'],
        }),
      })

      expect(createRes.status).toBe(201)
      // SAFETY: response JSON follows standard envelope
      const createdBody = (await createRes.json()) as { data: Role }
      expect(createdBody.data.name).toBe('counselor')
      expect(createdBody.data.permissions).toEqual([
        'attendance:read',
        'leave:read',
        'leave:approve',
      ])

      // 2. Fetch created role
      const getRes = await app.request(`/v1/admin/roles/${createdBody.data.id}`, {
        headers: { Authorization: `Bearer ${platformAdminToken}` },
      })
      expect(getRes.status).toBe(200)

      // 3. Update and deactivate role
      const patchRes = await app.request(`/v1/admin/roles/${createdBody.data.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${platformAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          description: 'Senior Counselor',
          is_active: false,
        }),
      })
      expect(patchRes.status).toBe(200)
      // SAFETY: response JSON follows standard envelope
      const patchedBody = (await patchRes.json()) as { data: Role }
      expect(patchedBody.data.description).toBe('Senior Counselor')
      expect(patchedBody.data.is_active).toBe(false)

      // 4. Verify audit evidence
      const auditLogs = await domainStore.getAuditLogs('role', createdBody.data.id)
      expect(auditLogs.length).toBe(2)
      expect(auditLogs.map((l) => l.action)).toContain('create_role')
      expect(auditLogs.map((l) => l.action)).toContain('update_role')
    })

    it('platform_admin can create new permissions with audit logs', async () => {
      const { app, domainStore, platformAdminToken } = setupTestEnvironment()

      const res = await app.request('/v1/admin/permissions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${platformAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'curriculum:manage',
          description: 'Manage academic syllabus and curriculum',
        }),
      })

      expect(res.status).toBe(201)
      // SAFETY: response JSON follows standard envelope
      const body = (await res.json()) as { data: { id: string; name: string } }
      expect(body.data.name).toBe('curriculum:manage')

      const auditLogs = await domainStore.getAuditLogs('permission', body.data.id)
      expect(auditLogs.length).toBe(1)
      expect(auditLogs[0].action).toBe('create_permission')
    })

    it('school_admin is rejected when attempting to create roles or permissions', async () => {
      const { app, schoolAdminToken } = setupTestEnvironment()

      const createRoleRes = await app.request('/v1/admin/roles', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${schoolAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'dean',
          description: 'School Dean',
        }),
      })
      expect(createRoleRes.status).toBe(403)

      const createPermRes = await app.request('/v1/admin/permissions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${schoolAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'dean:superpower',
        }),
      })
      expect(createPermRes.status).toBe(403)
    })
  })

  describe('Staff Creation & Role Assignment', () => {
    it('school_admin can create Staff and assign existing roles', async () => {
      const { app, domainStore, schoolAdminToken } = setupTestEnvironment()

      const res = await app.request('/v1/admin/staff', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${schoolAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'guru.siti@school.sch.id',
          fullName: 'Siti Rahma, M.Pd',
          role: 'teacher',
          gender: 'P',
        }),
      })

      expect(res.status).toBe(201)
      // SAFETY: response JSON follows standard envelope
      const body = (await res.json()) as {
        data: UserProfile & { roles: string[]; effective_permissions: string[] }
      }
      expect(body.data.email).toBe('guru.siti@school.sch.id')
      expect(body.data.full_name).toBe('Siti Rahma, M.Pd')
      expect(body.data.role).toBe('teacher')
      expect(body.data.roles).toContain('teacher')
      expect(body.data.effective_permissions).toContain('attendance:read')
      expect(body.data.effective_permissions).toContain('leave:approve')

      const auditLogs = await domainStore.getAuditLogs('profile', body.data.user_id)
      expect(auditLogs.length).toBe(1)
      expect(auditLogs[0].action).toBe('create_staff')
      expect(auditLogs[0].actor_id).toBe('school-admin-1')
    })

    it('school_admin is forbidden from assigning the platform_admin role', async () => {
      const { app, schoolAdminToken } = setupTestEnvironment()

      const res = await app.request('/v1/admin/staff', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${schoolAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'hacker@school.sch.id',
          fullName: 'Elevation Attempt',
          role: 'platform_admin',
        }),
      })

      expect(res.status).toBe(403)
    })

    it('returns validation error when assigning non-existent or inactive roles', async () => {
      const { app, platformAdminToken, schoolAdminToken } = setupTestEnvironment()

      // Non-existent role
      const nonExistentRes = await app.request('/v1/admin/staff', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${schoolAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'nonexistent@school.sch.id',
          fullName: 'Ghost Role',
          role: 'wizard',
        }),
      })
      expect(nonExistentRes.status).toBe(422)

      // Create and deactivate a role
      const createRoleRes = await app.request('/v1/admin/roles', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${platformAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'inactive_role',
          description: 'To be deactivated',
        }),
      })
      // SAFETY: response JSON follows standard envelope
      const createdRole = (await createRoleRes.json()) as { data: Role }

      await app.request(`/v1/admin/roles/${createdRole.data.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${platformAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_active: false }),
      })

      // Attempt to assign inactive role
      const inactiveRes = await app.request('/v1/admin/staff', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${schoolAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'inactive.assignee@school.sch.id',
          fullName: 'Inactive Assignee',
          role: 'inactive_role',
        }),
      })
      expect(inactiveRes.status).toBe(422)
    })
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

      const resetRes = await app.request(
        `/v1/admin/staff/${staff.data.user_id}/reset-password`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${schoolAdminToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        },
      )
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
