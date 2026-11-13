import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../../src/lib/errors/app-error.js'
import {
  approveStudent,
  correctStudentEmail,
  disableStudent,
  generateStudentResetCode,
  rejectStudent,
} from '../../../src/modules/admin/service.js'
import { MemoryDomainStore, MemoryIdentityProvider } from '../../../src/providers/memory/index.js'
import { createAdminStudentTestProviders } from './admin-student-service-harness.js'

describe('unit: admin student lifecycle management service', () => {
  it('approves student profile and activates Logto identity idempotently', async () => {
    const domainStore = new MemoryDomainStore()
    const identityProvider = new MemoryIdentityProvider()
    const providers = createAdminStudentTestProviders(domainStore, identityProvider)

    domainStore.profiles.set('s1', {
      user_id: 's1',
      nis: '1001',
      full_name: 'Student 1',
      role: 'student',
      lifecycle_status: 'pending',
      gender: null,
    })
    identityProvider.suspendedUsers.add('s1')

    const approved = await approveStudent({
      userId: 's1',
      actorId: 'admin-1',
      actorRole: 'school_admin',
      providers,
    })

    expect(approved.lifecycle_status).toBe('approved')
    expect(identityProvider.suspendedUsers.has('s1')).toBe(false)

    // Repeat approval must be idempotent
    const repeated = await approveStudent({
      userId: 's1',
      actorId: 'admin-1',
      actorRole: 'school_admin',
      providers,
    })
    expect(repeated.lifecycle_status).toBe('approved')

    const auditLogs = await domainStore.getAuditLogs('profile', 's1')
    expect(auditLogs.length).toBe(2)
    expect(auditLogs[0].action).toBe('approve_student')
  })

  it.each(['assignUserRole', 'setUserSuspended'] as const)(
    'keeps approval pending when %s fails, then safely retries',
    async (operation) => {
      const domainStore = new MemoryDomainStore()
      const identityProvider = new MemoryIdentityProvider()
      const providers = createAdminStudentTestProviders(domainStore, identityProvider)
      await domainStore.createPendingStudentProfile({
        userId: 's1',
        nis: '1001',
        fullName: 'Pending Student',
        email: 'student@example.invalid',
      })
      identityProvider.suspendedUsers.add('s1')
      const identityCall = vi
        .spyOn(identityProvider, operation)
        .mockRejectedValueOnce(new Error('Identity provider unavailable'))
      const writeLifecycle = vi.spyOn(domainStore, 'updateProfileLifecycle')
      const audit = vi.spyOn(domainStore, 'insertAuditLog')
      const notify = vi.spyOn(domainStore, 'enqueueNotification')
      const params = {
        userId: 's1',
        actorId: 'admin-1',
        actorRole: 'school_admin' as const,
        providers,
      }

      await expect(approveStudent(params)).rejects.toThrow('Identity provider unavailable')
      expect((await domainStore.getUserProfile('s1')).lifecycle_status).toBe('pending')
      expect(identityProvider.suspendedUsers.has('s1')).toBe(true)
      expect(writeLifecycle).not.toHaveBeenCalled()
      expect(audit).not.toHaveBeenCalled()
      expect(notify).not.toHaveBeenCalled()

      await expect(approveStudent(params)).resolves.toMatchObject({ lifecycle_status: 'approved' })
      expect(identityCall).toHaveBeenCalledTimes(2)
      expect(identityProvider.suspendedUsers.has('s1')).toBe(false)
      expect(audit).toHaveBeenCalledTimes(1)
      expect(notify).toHaveBeenCalledTimes(1)
    },
  )

  it('does not announce approval when the database write fails and permits retry', async () => {
    const domainStore = new MemoryDomainStore()
    const identityProvider = new MemoryIdentityProvider()
    const providers = createAdminStudentTestProviders(domainStore, identityProvider)
    await domainStore.createPendingStudentProfile({
      userId: 's1',
      nis: '1001',
      fullName: 'Pending Student',
      email: 'student@example.invalid',
    })
    const update = vi
      .spyOn(domainStore, 'updateProfileLifecycle')
      .mockRejectedValueOnce(new Error('Database unavailable'))
    const audit = vi.spyOn(domainStore, 'insertAuditLog')
    const notify = vi.spyOn(domainStore, 'enqueueNotification')
    const params = {
      userId: 's1',
      actorId: 'admin-1',
      actorRole: 'school_admin' as const,
      providers,
    }

    await expect(approveStudent(params)).rejects.toThrow('Database unavailable')
    expect((await domainStore.getUserProfile('s1')).lifecycle_status).toBe('pending')
    expect(audit).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()

    await expect(approveStudent(params)).resolves.toMatchObject({ lifecycle_status: 'approved' })
    expect(update).toHaveBeenCalledTimes(2)
    expect(audit).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('rejects student profile and disables Logto identity with session revocation', async () => {
    const domainStore = new MemoryDomainStore()
    const identityProvider = new MemoryIdentityProvider()
    const providers = createAdminStudentTestProviders(domainStore, identityProvider)

    domainStore.profiles.set('s1', {
      user_id: 's1',
      nis: '1001',
      full_name: 'Student 1',
      role: 'student',
      lifecycle_status: 'pending',
      gender: null,
    })

    const rejected = await rejectStudent({
      userId: 's1',
      reason: 'NIS mismatch on roster documentation',
      actorId: 'admin-1',
      actorRole: 'school_admin',
      providers,
    })

    expect(rejected.lifecycle_status).toBe('rejected')
    expect(identityProvider.suspendedUsers.has('s1')).toBe(true)
    expect(identityProvider.revokedSessions.has('s1')).toBe(true)

    const auditLogs = await domainStore.getAuditLogs('profile', 's1')
    expect(auditLogs.length).toBe(1)
    expect(auditLogs[0].action).toBe('reject_student')
  })

  it('disables student profile and revokes identity sessions', async () => {
    const domainStore = new MemoryDomainStore()
    const identityProvider = new MemoryIdentityProvider()
    const providers = createAdminStudentTestProviders(domainStore, identityProvider)

    domainStore.profiles.set('s1', {
      user_id: 's1',
      nis: '1001',
      full_name: 'Student 1',
      role: 'student',
      lifecycle_status: 'approved',
      gender: null,
    })

    const disabled = await disableStudent({
      userId: 's1',
      actorId: 'admin-1',
      actorRole: 'school_admin',
      providers,
    })

    expect(disabled.lifecycle_status).toBe('disabled')
    expect(identityProvider.suspendedUsers.has('s1')).toBe(true)
    expect(identityProvider.revokedSessions.has('s1')).toBe(true)
  })

  it('generates one-time reset code for approved student without exposing password', async () => {
    const domainStore = new MemoryDomainStore()
    const providers = createAdminStudentTestProviders(domainStore)

    domainStore.profiles.set('s1', {
      user_id: 's1',
      nis: '1001',
      full_name: 'Student 1',
      role: 'student',
      lifecycle_status: 'approved',
      gender: null,
    })

    const resetResult = await generateStudentResetCode({
      userId: 's1',
      actorId: 'admin-1',
      actorRole: 'school_admin',
      providers,
    })

    expect(resetResult.code).toMatch(/^\d{6}$/)
    expect(resetResult.user_id).toBe('s1')
    expect(resetResult.nis).toBe('1001')
    expect(new Date(resetResult.expires_at).getTime()).toBeGreaterThan(Date.now())

    // Verify stored in domain store
    const codeRecord = await domainStore.getActivePasswordResetCode('s1', resetResult.code)
    expect(codeRecord).not.toBeNull()
    expect(codeRecord?.code).toBe(resetResult.code)

    const auditLogs = await domainStore.getAuditLogs('password_reset_code', 's1')
    expect(auditLogs.length).toBe(1)
    expect(auditLogs[0].action).toBe('generate_reset_code')
  })

  it('rejects generating reset code for unapproved student', async () => {
    const domainStore = new MemoryDomainStore()
    const providers = createAdminStudentTestProviders(domainStore)

    domainStore.profiles.set('s-pending', {
      user_id: 's-pending',
      nis: '1002',
      full_name: 'Pending Student',
      role: 'student',
      lifecycle_status: 'pending',
      gender: null,
    })

    await expect(
      generateStudentResetCode({
        userId: 's-pending',
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      }),
    ).rejects.toThrowError(AppError)
  })

  it('corrects student email and synchronizes with IdentityProvider', async () => {
    const domainStore = new MemoryDomainStore()
    const identityProvider = new MemoryIdentityProvider()
    const providers = createAdminStudentTestProviders(domainStore, identityProvider)

    domainStore.profiles.set('s1', {
      user_id: 's1',
      nis: '1001',
      full_name: 'Student 1',
      email: 'wrong@school.sch.id',
      role: 'student',
      lifecycle_status: 'approved',
      gender: null,
    })
    identityProvider.users.set('s1', {
      userId: 's1',
      email: 'wrong@school.sch.id',
      roles: ['student'],
    })

    const updated = await correctStudentEmail({
      userId: 's1',
      email: 'correct@school.sch.id',
      actorId: 'admin-1',
      actorRole: 'school_admin',
      providers,
    })

    expect(updated.email).toBe('correct@school.sch.id')
    expect(identityProvider.users.get('s1')?.email).toBe('correct@school.sch.id')

    const auditLogs = await domainStore.getAuditLogs('profile', 's1')
    expect(auditLogs.length).toBe(1)
    expect(auditLogs[0].action).toBe('correct_student_email')
  })
})
