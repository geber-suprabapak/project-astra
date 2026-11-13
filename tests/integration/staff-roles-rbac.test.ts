import { describe, expect, it } from 'vitest'
import type { Role, UserProfile } from '../../src/providers/types.js'
import { setupTestEnvironment } from './helpers/staff-roles-fixture.js'

describe('integration: manage staff, RBAC, and role assignment (Ticket 05)', () => {
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
})
