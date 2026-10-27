import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../../src/lib/errors/app-error.js'
import {
  approveStudent,
  correctStudentEmail,
  disableStudent,
  generateStudentResetCode,
  getStudent,
  listStudents,
  rejectStudent,
} from '../../../src/modules/admin/service.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { RobinClient } from '../../../src/clients/robin/client.js'
import type { AppProviders } from '../../../src/providers/types.js'
import { getProfile } from '../../../src/modules/profile/service.js'

const mockRobinClient: RobinClient = {
  checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
  getEnrollmentStatus: async () => ({
    status: 'not_enrolled',
    embeddingCount: 0,
    message: 'No enrollment found.',
  }),
  enroll: async () => ({
    status: 'ok',
    userId: 'student-1',
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

function createTestProviders(
  domainStore = new MemoryDomainStore(),
  identityProvider = new MemoryIdentityProvider(),
): AppProviders {
  return {
    domainStore,
    objectStorage: new MemoryObjectStorage(),
    identityProvider,
    robinClient: mockRobinClient,
  }
}

describe('unit: admin student management service', () => {
  it('projects canonical roster fields consistently for admin and mobile without rewriting profiles', async () => {
    const domainStore = new MemoryDomainStore()
    const providers = createTestProviders(domainStore)
    const legacy = {
      user_id: 's1',
      nis: '1001',
      full_name: 'Legacy Name',
      email: 'account@example.invalid',
      class_name: 'Old Class',
      absence_number: null,
      gender: null,
      role: 'student' as const,
      lifecycle_status: 'approved' as const,
    }
    domainStore.profiles.set('s1', legacy)
    const student = await domainStore.createStudent({
      nis: '1001',
      fullName: 'Canonical Name',
      gender: 'P',
    })
    await domainStore.bindStudentToUser({ studentId: student.id, userId: 's1' })
    const period = await domainStore.createAcademicPeriod({
      name: 'Current',
      startDate: '2026-07-01',
      endDate: '2027-06-30',
      isActive: true,
    })
    const cls = await domainStore.createClass({ name: 'X PPLG 1', academicPeriodId: period.id })
    domainStore.classEnrollments.push({
      id: 'enrollment',
      student_id: student.id,
      user_id: 's1',
      class_id: cls.id,
      academic_period_id: period.id,
      status: 'active',
      absence_number: '6',
    })
    for (const result of [
      await getStudent({ userId: 's1', actorRole: 'school_admin', providers }),
      await getProfile('s1', providers),
    ]) {
      expect(result).toMatchObject({
        user_id: 's1',
        nis: '1001',
        full_name: 'Canonical Name',
        class_name: 'X PPLG 1',
        absence_number: '6',
        gender: 'P',
        email: legacy.email,
        role: 'student',
        lifecycle_status: 'approved',
      })
    }
    expect(domainStore.profiles.get('s1')).toEqual(legacy)
  })

  it('retains legacy details when a canonical roster is absent or belongs to another identity', async () => {
    const domainStore = new MemoryDomainStore()
    const providers = createTestProviders(domainStore)
    const legacy = {
      user_id: 's1',
      nis: '1001',
      full_name: 'Legacy Student',
      class_name: 'Legacy Class',
      absence_number: '4',
      gender: 'L',
      role: 'student' as const,
      lifecycle_status: 'pending' as const,
    }
    domainStore.profiles.set('s1', legacy)
    const params = { userId: 's1', actorRole: 'school_admin' as const, providers }
    expect(await getStudent(params)).toEqual(legacy)
    const canonical = await domainStore.createStudent({
      nis: '1001',
      fullName: 'Other Identity',
      gender: 'P',
    })
    await domainStore.bindStudentToUser({ studentId: canonical.id, userId: 'other-user' })
    expect(await getStudent(params)).toEqual(legacy)
    const read = vi
      .spyOn(domainStore, 'getRosterStudentByNis')
      .mockRejectedValueOnce(new Error('Roster unavailable'))
    await expect(getStudent(params)).rejects.toThrow('Roster unavailable')
    read.mockRestore()
    expect(domainStore.profiles.get('s1')).toEqual(legacy)
  })

  it('lists student profiles with and without lifecycle filter', async () => {
    const domainStore = new MemoryDomainStore()
    const providers = createTestProviders(domainStore)

    domainStore.profiles.set('s1', {
      user_id: 's1',
      nis: '1001',
      full_name: 'Student 1',
      role: 'student',
      lifecycle_status: 'pending',
      gender: null,
    })
    domainStore.profiles.set('s2', {
      user_id: 's2',
      nis: '1002',
      full_name: 'Student 2',
      role: 'student',
      lifecycle_status: 'approved',
      gender: null,
    })
    domainStore.profiles.set('admin-1', {
      user_id: 'admin-1',
      full_name: 'School Admin',
      role: 'school_admin',
      lifecycle_status: 'approved',
      gender: null,
    })

    const allStudents = await listStudents({
      actorRole: 'school_admin',
      providers,
    })
    expect(allStudents.length).toBe(2)

    const pendingStudents = await listStudents({
      status: 'pending',
      actorRole: 'school_admin',
      providers,
    })
    expect(pendingStudents.length).toBe(1)
    expect(pendingStudents[0].user_id).toBe('s1')

    const approvedStudents = await listStudents({
      status: 'approved',
      actorRole: 'platform_admin',
      providers,
    })
    expect(approvedStudents.length).toBe(1)
    expect(approvedStudents[0].user_id).toBe('s2')
  })

  it('rejects list students for non-privileged actors', async () => {
    const providers = createTestProviders()

    await expect(
      listStudents({
        actorRole: 'student',
        providers,
      }),
    ).rejects.toThrowError(AppError)

    await expect(
      listStudents({
        actorRole: null,
        providers,
      }),
    ).rejects.toThrowError(AppError)
  })

  it('allows list students for teacher and staff roles', async () => {
    const providers = createTestProviders()

    const teacherStudents = await listStudents({
      actorRole: 'teacher',
      providers,
    })
    expect(teacherStudents).toEqual([])

    const staffStudents = await listStudents({
      actorRole: 'staff',
      providers,
    })
    expect(staffStudents).toEqual([])
  })

  it('retrieves individual student profile by user_id', async () => {
    const domainStore = new MemoryDomainStore()
    const providers = createTestProviders(domainStore)

    domainStore.profiles.set('s1', {
      user_id: 's1',
      nis: '1001',
      full_name: 'Student 1',
      role: 'student',
      lifecycle_status: 'pending',
      gender: null,
    })

    const student = await getStudent({
      userId: 's1',
      actorRole: 'school_admin',
      providers,
    })
    expect(student.user_id).toBe('s1')
    expect(student.nis).toBe('1001')
  })

  it('approves student profile and activates Logto identity idempotently', async () => {
    const domainStore = new MemoryDomainStore()
    const identityProvider = new MemoryIdentityProvider()
    const providers = createTestProviders(domainStore, identityProvider)

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
      const providers = createTestProviders(domainStore, identityProvider)
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
    const providers = createTestProviders(domainStore, identityProvider)
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
    const providers = createTestProviders(domainStore, identityProvider)

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
    const providers = createTestProviders(domainStore, identityProvider)

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
    const providers = createTestProviders(domainStore)

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
    const providers = createTestProviders(domainStore)

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
    const providers = createTestProviders(domainStore, identityProvider)

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
