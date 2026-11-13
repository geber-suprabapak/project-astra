import { describe, expect, it, vi } from 'vitest'
import {
  createStaff,
  getStaff,
  getStaffEffectivePermissions,
  listStaff,
  requestStaffPasswordReset,
  updateStaff,
} from '../../../src/modules/admin/service.js'
import { AppError } from '../../../src/lib/errors/app-error.js'
import { createAdminStaffTestProviders } from './admin-staff-service-harness.js'

describe('admin staff identity & profile lifecycle service unit tests (Ticket 05)', () => {
  it('provisions the complete assigned identity roles before publishing an approved profile', async () => {
    const { providers, domainStore, identityProvider } = createAdminStaffTestProviders()
    const assign = vi
      .spyOn(identityProvider, 'assignRoles')
      .mockImplementation(async (id, roles) => {
        expect(domainStore.profiles.has(id)).toBe(false)
        expect(roles).toEqual(['staff', 'teacher'])
      })
    const staff = await createStaff({
      email: 'assigned@school.sch.id',
      fullName: 'Assigned Staff',
      role: 'staff',
      roles: ['teacher', 'staff'],
      actorId: 'school-admin-1',
      actorRole: 'school_admin',
      providers,
    })
    expect(assign).toHaveBeenCalledWith(staff.user_id, ['staff', 'teacher'])
    expect(staff.roles).toEqual(['staff', 'teacher'])
  })

  it('does not publish a profile or success audit when Logto role assignment fails', async () => {
    const { providers, domainStore, identityProvider } = createAdminStaffTestProviders()
    vi.spyOn(identityProvider, 'assignRoles').mockRejectedValue(
      AppError.internal('Logto unavailable'),
    )
    await expect(
      createStaff({
        email: 'failure@school.sch.id',
        fullName: 'Failed Staff',
        role: 'staff',
        actorId: 'school-admin-1',
        actorRole: 'school_admin',
        providers,
      }),
    ).rejects.toThrow('Logto unavailable')
    expect(await domainStore.getStaffProfiles()).toEqual([])
    expect(await domainStore.getAuditLogs('profile')).toEqual([])
  })

  it('rejects a caller-selected identity before creating or assigning identity roles', async () => {
    const { providers, identityProvider } = createAdminStaffTestProviders()
    const create = vi.spyOn(identityProvider, 'createStaffIdentity')
    const assign = vi.spyOn(identityProvider, 'assignRoles')
    await expect(
      createStaff({
        userId: 'existing-platform-admin',
        email: 'separate@school.sch.id',
        fullName: 'Wrong Binding',
        role: 'staff',
        actorId: 'school-admin-1',
        actorRole: 'school_admin',
        providers,
      }),
    ).rejects.toThrow(AppError)
    expect(create).not.toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
  })

  it('repairs assigned roles through the existing update path and retains primary role on roles-only input', async () => {
    const { providers, domainStore, identityProvider } = createAdminStaffTestProviders()
    const staff = await createStaff({
      email: 'repair@school.sch.id',
      fullName: 'Repair Staff',
      role: 'staff',
      actorId: 'school-admin-1',
      actorRole: 'school_admin',
      providers,
    })
    identityProvider.users.get(staff.user_id)!.roles = []
    const assign = vi
      .spyOn(identityProvider, 'assignRoles')
      .mockRejectedValueOnce(AppError.internal('Logto unavailable'))
    const params = {
      userId: staff.user_id,
      roles: ['teacher'],
      actorId: 'school-admin-1',
      actorRole: 'school_admin' as const,
      providers,
    }
    await expect(updateStaff(params)).rejects.toThrow('Logto unavailable')
    expect(await domainStore.getUserRoles(staff.user_id)).toEqual(['staff'])
    expect((await domainStore.getAuditLogs('profile', staff.user_id)).length).toBe(1)
    const updated = await updateStaff(params)
    expect(updated.roles).toEqual(['staff', 'teacher'])
    expect(identityProvider.users.get(staff.user_id)?.roles).toEqual(['staff', 'teacher'])
    expect(assign).toHaveBeenLastCalledWith(staff.user_id, ['staff', 'teacher'])
  })

  it('does not let school_admin replace a platform administrator identity role', async () => {
    const { providers, identityProvider } = createAdminStaffTestProviders()
    const staff = await createStaff({
      email: 'platform@school.sch.id',
      fullName: 'Platform Admin',
      role: 'platform_admin',
      actorId: 'platform-admin-1',
      actorRole: 'platform_admin',
      providers,
    })
    const assign = vi.spyOn(identityProvider, 'assignRoles')
    await expect(
      updateStaff({
        userId: staff.user_id,
        role: 'staff',
        actorId: 'school-admin-1',
        actorRole: 'school_admin',
        providers,
      }),
    ).rejects.toThrow(AppError)
    expect(assign).not.toHaveBeenCalled()
  })

  it('school_admin can create a Staff profile with an existing active role', async () => {
    const { providers, domainStore } = createAdminStaffTestProviders()

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
    const { providers } = createAdminStaffTestProviders()

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
    const { providers } = createAdminStaffTestProviders()

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
    const { providers } = createAdminStaffTestProviders()

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
    const { providers, domainStore } = createAdminStaffTestProviders()

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
    expect(auditLogs[0].action).toBe('update_staff')
    expect(auditLogs[1].action).toBe('create_staff')
  })

  it('disabling staff profile revokes active sessions', async () => {
    const { providers, domainStore } = createAdminStaffTestProviders()

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
    const { providers, domainStore } = createAdminStaffTestProviders()

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
    const { providers } = createAdminStaffTestProviders()

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
