import { describe, expect, it } from 'vitest'
import {
  createPermission,
  createRole,
  createStaff,
  getRole,
  getStaff,
  getStaffEffectivePermissions,
  listPermissions,
  listRoles,
  listStaff,
  requestStaffPasswordReset,
  updateRole,
  updateStaff,
} from '../../../src/modules/admin/service.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { RobinClient } from '../../../src/clients/robin/client.js'
import type { AppProviders } from '../../../src/providers/types.js'
import { AppError } from '../../../src/lib/errors/app-error.js'

const mockRobinClient: RobinClient = {
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

interface TestProvidersContext {
  providers: AppProviders
  domainStore: MemoryDomainStore
  identityProvider: MemoryIdentityProvider
}

function createTestProviders(): TestProvidersContext {
  const domainStore = new MemoryDomainStore()
  const identityProvider = new MemoryIdentityProvider()
  const providers: AppProviders = {
    domainStore,
    objectStorage: new MemoryObjectStorage(),
    identityProvider,
    robinClient: mockRobinClient,
  }
  return { providers, domainStore, identityProvider }
}

describe('admin staff, roles, and permissions service unit tests (Ticket 05)', () => {
  describe('Roles & Permissions Management (Platform Admin)', () => {
    it('platform_admin can list seeded default roles and permissions', async () => {
      const { providers } = createTestProviders()

      const roles = await listRoles({
        actorRole: 'platform_admin',
        providers,
      })
      expect(roles.length).toBeGreaterThanOrEqual(5)
      expect(roles.map((r) => r.name)).toContain('platform_admin')
      expect(roles.map((r) => r.name)).toContain('teacher')

      const permissions = await listPermissions({
        actorRole: 'platform_admin',
        providers,
      })
      expect(permissions.length).toBeGreaterThanOrEqual(14)
      expect(permissions.map((p) => p.name)).toContain('admin:read')
      expect(permissions.map((p) => p.name)).toContain('roles:manage')
    })

    it('platform_admin can create a new global role with permissions and audit log', async () => {
      const { providers, domainStore } = createTestProviders()

      const role = await createRole({
        name: 'counselor',
        description: 'School guidance counselor',
        permissions: ['attendance:read', 'leave:read', 'leave:approve'],
        actorId: 'platform-admin-1',
        actorRole: 'platform_admin',
        providers,
      })

      expect(role.name).toBe('counselor')
      expect(role.description).toBe('School guidance counselor')
      expect(role.permissions).toEqual(['attendance:read', 'leave:read', 'leave:approve'])
      expect(role.is_active).toBe(true)

      const auditLogs = await domainStore.getAuditLogs('role', role.id)
      expect(auditLogs.length).toBe(1)
      expect(auditLogs[0].action).toBe('create_role')
      expect(auditLogs[0].actor_id).toBe('platform-admin-1')
    })

    it('platform_admin can create a new permission and audit log', async () => {
      const { providers, domainStore } = createTestProviders()

      const perm = await createPermission({
        name: 'reports:export',
        description: 'Export school-wide attendance reports',
        actorId: 'platform-admin-1',
        actorRole: 'platform_admin',
        providers,
      })

      expect(perm.name).toBe('reports:export')
      expect(perm.description).toBe('Export school-wide attendance reports')

      const auditLogs = await domainStore.getAuditLogs('permission', perm.id)
      expect(auditLogs.length).toBe(1)
      expect(auditLogs[0].action).toBe('create_permission')
    })

    it('platform_admin can update and deactivate an existing role with audit evidence', async () => {
      const { providers, domainStore } = createTestProviders()

      const role = await createRole({
        name: 'intern',
        description: 'Intern assistant',
        permissions: ['attendance:read'],
        actorId: 'platform-admin-1',
        actorRole: 'platform_admin',
        providers,
      })

      const updated = await updateRole({
        id: role.id,
        description: 'Senior intern assistant',
        permissions: ['attendance:read', 'profile:read'],
        isActive: false,
        actorId: 'platform-admin-1',
        actorRole: 'platform_admin',
        providers,
      })

      expect(updated.description).toBe('Senior intern assistant')
      expect(updated.permissions).toEqual(['attendance:read', 'profile:read'])
      expect(updated.is_active).toBe(false)

      const fetched = await getRole({
        id: role.id,
        actorRole: 'platform_admin',
        providers,
      })
      expect(fetched.is_active).toBe(false)

      const auditLogs = await domainStore.getAuditLogs('role', role.id)
      expect(auditLogs.length).toBe(2)
      expect(auditLogs[1].action).toBe('update_role')
    })

    it('school_admin is forbidden from creating roles, updating roles, and defining permissions', async () => {
      const { providers } = createTestProviders()

      await expect(
        createRole({
          name: 'curriculum_lead',
          actorId: 'school-admin-1',
          actorRole: 'school_admin',
          providers,
        }),
      ).rejects.toThrow(AppError)

      const defaultRole = await providers.domainStore.getRoleByName('teacher')
      expect(defaultRole).not.toBeNull()

      await expect(
        updateRole({
          id: defaultRole!.id,
          description: 'Hacked role',
          actorId: 'school-admin-1',
          actorRole: 'school_admin',
          providers,
        }),
      ).rejects.toThrow(AppError)

      await expect(
        createPermission({
          name: 'super:admin',
          actorId: 'school-admin-1',
          actorRole: 'school_admin',
          providers,
        }),
      ).rejects.toThrow(AppError)
    })
  })

  describe('Staff Identity & Profile Lifecycle Management', () => {
    it('school_admin can create a Staff profile with an existing active role', async () => {
      const { providers, domainStore } = createTestProviders()

      const staff = await createStaff({
        email: 'guru.ahmad@school.sch.id',
        fullName: 'Ahmad Guru, S.Pd',
        role: 'teacher',
        gender: 'L',
        actorId: 'school-admin-1',
        actorRole: 'school_admin',
        providers,
      })

      expect(staff.email).toBe('guru.ahmad@school.sch.id')
      expect(staff.full_name).toBe('Ahmad Guru, S.Pd')
      expect(staff.role).toBe('teacher')
      expect(staff.lifecycle_status).toBe('approved')
      expect(staff.roles).toContain('teacher')
      expect(staff.effective_permissions).toContain('attendance:read')
      expect(staff.effective_permissions).toContain('leave:approve')

      const auditLogs = await domainStore.getAuditLogs('profile', staff.user_id)
      expect(auditLogs.length).toBe(1)
      expect(auditLogs[0].action).toBe('create_staff')
      expect(auditLogs[0].actor_id).toBe('school-admin-1')
    })

    it('school_admin cannot assign the platform_admin role', async () => {
      const { providers } = createTestProviders()

      await expect(
        createStaff({
          email: 'elevated@school.sch.id',
          fullName: 'Elevated User',
          role: 'platform_admin',
          actorId: 'school-admin-1',
          actorRole: 'school_admin',
          providers,
        }),
      ).rejects.toThrow(AppError)
    })

    it('rejects staff creation when role is non-existent or inactive', async () => {
      const { providers } = createTestProviders()

      try {
        await createStaff({
          email: 'invalid.role@school.sch.id',
          fullName: 'Invalid Role Staff',
          role: 'non_existent_role',
          actorId: 'school-admin-1',
          actorRole: 'school_admin',
          providers,
        })
        expect.unreachable('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(AppError)
        // SAFETY: err is verified AppError instance above
        expect((err as AppError).details).toContain('does not exist or is inactive')
      }

      // Deactivate a role and verify rejection
      const role = await providers.domainStore.getRoleByName('staff')
      expect(role).not.toBeNull()
      await providers.domainStore.updateRole(role!.id, { isActive: false })

      try {
        await createStaff({
          email: 'inactive.staff@school.sch.id',
          fullName: 'Inactive Staff',
          role: 'staff',
          actorId: 'school-admin-1',
          actorRole: 'school_admin',
          providers,
        })
        expect.unreachable('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(AppError)
        // SAFETY: err is verified AppError instance above
        expect((err as AppError).details).toContain('does not exist or is inactive')
      }
    })

    it('rejects duplicate staff email registration', async () => {
      const { providers } = createTestProviders()

      await createStaff({
        email: 'duplicate@school.sch.id',
        fullName: 'First Staff',
        role: 'teacher',
        actorId: 'school-admin-1',
        actorRole: 'school_admin',
        providers,
      })

      await expect(
        createStaff({
          email: 'duplicate@school.sch.id',
          fullName: 'Second Staff',
          role: 'staff',
          actorId: 'school-admin-1',
          actorRole: 'school_admin',
          providers,
        }),
      ).rejects.toThrow('already registered')
    })

    it('updateStaff updates profile, assigns multi-roles, and updates effective permissions', async () => {
      const { providers, domainStore } = createTestProviders()

      const staff = await createStaff({
        email: 'multi.role@school.sch.id',
        fullName: 'Multi Role Teacher',
        role: 'teacher',
        actorId: 'school-admin-1',
        actorRole: 'school_admin',
        providers,
      })

      const updated = await updateStaff({
        userId: staff.user_id,
        fullName: 'Multi Role Teacher, M.Kom',
        role: 'teacher',
        roles: ['teacher', 'staff'],
        actorId: 'school-admin-1',
        actorRole: 'school_admin',
        providers,
      })

      expect(updated.full_name).toBe('Multi Role Teacher, M.Kom')
      expect(updated.roles).toContain('teacher')
      expect(updated.roles).toContain('staff')

      const effectivePerms = await getStaffEffectivePermissions({
        userId: staff.user_id,
        actorRole: 'school_admin',
        providers,
      })
      expect(effectivePerms.roles).toContain('teacher')
      expect(effectivePerms.roles).toContain('staff')
      expect(effectivePerms.permissions).toContain('attendance:read')
      expect(effectivePerms.permissions).toContain('leave:approve')

      const auditLogs = await domainStore.getAuditLogs('profile', staff.user_id)
      expect(auditLogs.length).toBe(2)
      expect(auditLogs[1].action).toBe('update_staff')
    })

    it('disabling staff profile revokes active sessions', async () => {
      const { providers, domainStore } = createTestProviders()

      const staff = await createStaff({
        email: 'disable.me@school.sch.id',
        fullName: 'To Be Disabled',
        role: 'staff',
        actorId: 'school-admin-1',
        actorRole: 'school_admin',
        providers,
      })

      expect(await domainStore.isSessionRevoked(staff.user_id)).toBe(false)

      await updateStaff({
        userId: staff.user_id,
        lifecycleStatus: 'disabled',
        actorId: 'school-admin-1',
        actorRole: 'school_admin',
        providers,
      })

      expect(await domainStore.isSessionRevoked(staff.user_id)).toBe(true)
    })

    it('requestStaffPasswordReset initiates password recovery and creates audit log', async () => {
      const { providers, domainStore } = createTestProviders()

      const staff = await createStaff({
        email: 'recovery@school.sch.id',
        fullName: 'Recovery User',
        role: 'teacher',
        actorId: 'school-admin-1',
        actorRole: 'school_admin',
        providers,
      })

      const res = await requestStaffPasswordReset({
        userId: staff.user_id,
        actorId: 'school-admin-1',
        actorRole: 'school_admin',
        providers,
      })

      expect(res.success).toBe(true)
      expect(res.message).toContain('Password recovery email initiated')

      const auditLogs = await domainStore.getAuditLogs('profile', staff.user_id)
      const resetLog = auditLogs.find((l) => l.action === 'request_staff_password_reset')
      expect(resetLog).toBeDefined()
      expect(resetLog?.actor_id).toBe('school-admin-1')
    })

    it('listStaff and getStaff return active staff records with effective permissions', async () => {
      const { providers } = createTestProviders()

      await createStaff({
        email: 'staff.a@school.sch.id',
        fullName: 'Staff A',
        role: 'teacher',
        actorId: 'platform-admin-1',
        actorRole: 'platform_admin',
        providers,
      })
      await createStaff({
        email: 'staff.b@school.sch.id',
        fullName: 'Staff B',
        role: 'staff',
        actorId: 'platform-admin-1',
        actorRole: 'platform_admin',
        providers,
      })

      const allStaff = await listStaff({
        actorRole: 'school_admin',
        providers,
      })
      expect(allStaff.length).toBeGreaterThanOrEqual(2)

      const staffA = allStaff.find((s) => s.email === 'staff.a@school.sch.id')
      expect(staffA).toBeDefined()

      const fetched = await getStaff({
        userId: staffA!.user_id,
        actorRole: 'school_admin',
        providers,
      })
      expect(fetched.email).toBe('staff.a@school.sch.id')
      expect(fetched.roles).toContain('teacher')
    })
  })
})
