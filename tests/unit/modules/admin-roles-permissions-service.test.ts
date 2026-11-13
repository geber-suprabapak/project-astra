import { describe, expect, it } from 'vitest'
import {
  createPermission,
  createRole,
  getRole,
  listPermissions,
  listRoles,
  updateRole,
} from '../../../src/modules/admin/service.js'
import { AppError } from '../../../src/lib/errors/app-error.js'
import { createAdminStaffTestProviders } from './admin-staff-service-harness.js'

describe('admin roles and permissions service unit tests (Ticket 05)', () => {
  it('platform_admin can list seeded default roles and permissions', async () => {
    const { providers } = createAdminStaffTestProviders()

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
    const { providers, domainStore } = createAdminStaffTestProviders()

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
    const { providers, domainStore } = createAdminStaffTestProviders()

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
    const { providers, domainStore } = createAdminStaffTestProviders()

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
    expect(auditLogs[0].action).toBe('update_role')
    expect(auditLogs[1].action).toBe('create_role')
  })

  it('school_admin is forbidden from creating roles, updating roles, and defining permissions', async () => {
    const { providers } = createAdminStaffTestProviders()

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
