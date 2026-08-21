import { describe, expect, it } from 'vitest'
import { AppError } from '../../../src/lib/errors/app-error.js'
import { registerStudent, resetStudentPassword } from '../../../src/modules/auth/service.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { RobinClient } from '../../../src/clients/robin/client.js'
import type { AppProviders } from '../../../src/providers/types.js'

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

describe('unit: student auth service', () => {
  it('rejects student signup when signup is not open', async () => {
    const providers = createTestProviders()
    providers.domainStore.signupOpen = false

    await expect(
      registerStudent(
        {
          nis: '1001',
          email: 'student@school.sch.id',
          password: 'Password123!',
        },
        providers,
      ),
    ).rejects.toThrowError(AppError)
  })

  it('rejects student signup when NIS is not in the accepted roster', async () => {
    const providers = createTestProviders()
    providers.domainStore.signupOpen = true

    await expect(
      registerStudent(
        {
          nis: '9999',
          email: 'unlisted@school.sch.id',
          password: 'Password123!',
        },
        providers,
      ),
    ).rejects.toThrowError(AppError)
  })

  it('creates pending student profile and disabled identity when NIS is valid', async () => {
    const domainStore = new MemoryDomainStore()
    const identityProvider = new MemoryIdentityProvider()
    const providers = createTestProviders(domainStore, identityProvider)

    domainStore.signupOpen = true
    await domainStore.stageRosterReport({
      totalRows: 1,
      validRows: 1,
      rejectedRows: 0,
      status: 'staged',
      reviewState: 'pending',
      rows: [{ nis: '1001', full_name: 'Budi Santoso', class_name: 'XII RPL 1', grade: 12 }],
      rejectedItems: [],
    })
    const report = Array.from(domainStore.rosterReports.values())[0]
    await domainStore.acceptRosterReport(report.id, 'admin-1')

    const profile = await registerStudent(
      {
        nis: '1001',
        email: 'budi@school.sch.id',
        password: 'Password123!',
      },
      providers,
    )

    expect(profile.nis).toBe('1001')
    expect(profile.full_name).toBe('Budi Santoso')
    expect(profile.class_name).toBe('XII RPL 1')
    expect(profile.email).toBe('budi@school.sch.id')
    expect(profile.role).toBe('student')
    expect(profile.lifecycle_status).toBe('pending')

    expect(identityProvider.suspendedUsers.has(profile.user_id)).toBe(true)

    const auditLogs = await domainStore.getAuditLogs('profile', profile.user_id)
    expect(auditLogs.length).toBe(1)
    expect(auditLogs[0].action).toBe('student_signup')
  })

  it('rejects duplicate student signup when profile already pending or approved', async () => {
    const domainStore = new MemoryDomainStore()
    const providers = createTestProviders(domainStore)

    domainStore.signupOpen = true
    await domainStore.stageRosterReport({
      totalRows: 1,
      validRows: 1,
      rejectedRows: 0,
      status: 'staged',
      reviewState: 'pending',
      rows: [{ nis: '1001', full_name: 'Budi Santoso', class_name: 'XII RPL 1' }],
      rejectedItems: [],
    })
    const report = Array.from(domainStore.rosterReports.values())[0]
    await domainStore.acceptRosterReport(report.id, 'admin-1')

    await registerStudent(
      {
        nis: '1001',
        email: 'budi@school.sch.id',
        password: 'Password123!',
      },
      providers,
    )

    await expect(
      registerStudent(
        {
          nis: '1001',
          email: 'budi2@school.sch.id',
          password: 'Password123!',
        },
        providers,
      ),
    ).rejects.toThrowError(AppError)
  })

  it('resets student password with valid reset code and revokes existing sessions', async () => {
    const domainStore = new MemoryDomainStore()
    const identityProvider = new MemoryIdentityProvider()
    const providers = createTestProviders(domainStore, identityProvider)

    domainStore.profiles.set('user-student-1', {
      user_id: 'user-student-1',
      nis: '1001',
      full_name: 'Budi Santoso',
      email: 'budi@school.sch.id',
      role: 'student',
      lifecycle_status: 'approved',
      gender: null,
    })

    const resetCode = await domainStore.createPasswordResetCode({
      userId: 'user-student-1',
      code: '839201',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      createdBy: 'admin-1',
    })

    const result = await resetStudentPassword(
      {
        nis: '1001',
        code: '839201',
        new_password: 'NewPassword999!',
      },
      providers,
    )

    expect(result.success).toBe(true)
    expect(identityProvider.passwords.get('user-student-1')).toBe('NewPassword999!')
    expect(identityProvider.revokedSessions.has('user-student-1')).toBe(true)

    // Verify reset code cannot be used again
    await expect(
      resetStudentPassword(
        {
          nis: '1001',
          code: '839201',
          new_password: 'AnotherPassword123!',
        },
        providers,
      ),
    ).rejects.toThrowError(AppError)

    const usedCheck = await domainStore.getActivePasswordResetCode('user-student-1', resetCode.code)
    expect(usedCheck).toBeNull()
  })

  it('rejects password reset with expired or invalid code', async () => {
    const domainStore = new MemoryDomainStore()
    const providers = createTestProviders(domainStore)

    domainStore.profiles.set('user-student-1', {
      user_id: 'user-student-1',
      nis: '1001',
      full_name: 'Budi Santoso',
      email: 'budi@school.sch.id',
      role: 'student',
      lifecycle_status: 'approved',
      gender: null,
    })

    // Expired code
    await domainStore.createPasswordResetCode({
      userId: 'user-student-1',
      code: '123456',
      expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
      createdBy: 'admin-1',
    })

    await expect(
      resetStudentPassword(
        {
          nis: '1001',
          code: '123456',
          new_password: 'NewPassword999!',
        },
        providers,
      ),
    ).rejects.toThrowError(AppError)

    // Non-existent code
    await expect(
      resetStudentPassword(
        {
          nis: '1001',
          code: '999999',
          new_password: 'NewPassword999!',
        },
        providers,
      ),
    ).rejects.toThrowError(AppError)
  })

  it('rejects password reset when student profile is not approved', async () => {
    const domainStore = new MemoryDomainStore()
    const providers = createTestProviders(domainStore)

    domainStore.profiles.set('user-student-pending', {
      user_id: 'user-student-pending',
      nis: '1002',
      full_name: 'Pending Student',
      email: 'pending@school.sch.id',
      role: 'student',
      lifecycle_status: 'pending',
      gender: null,
    })

    await domainStore.createPasswordResetCode({
      userId: 'user-student-pending',
      code: '555666',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      createdBy: 'admin-1',
    })

    await expect(
      resetStudentPassword(
        {
          nis: '1002',
          code: '555666',
          new_password: 'NewPassword999!',
        },
        providers,
      ),
    ).rejects.toThrowError(AppError)
  })
})
