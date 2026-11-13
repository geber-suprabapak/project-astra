import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../../src/lib/errors/app-error.js'
import { ErrorCode } from '../../../src/lib/errors/codes.js'
import {
  approveStudent,
  correctStudentEmail,
  createClass,
  disableStudent,
  enrollStudent,
  exitStudentEnrollment,
  generateStudentResetCode,
  promoteStudentEnrollment,
  rejectStudent,
  resetStudentFaceEnrollment,
  transferStudentEnrollment,
} from '../../../src/modules/admin/service.js'
import { MemoryDomainStore, MemoryIdentityProvider } from '../../../src/providers/memory/index.js'
import type { IdentityRole } from '../../../src/providers/types.js'
import {
  createAdversarialTestProviders,
  mockRobinClient,
  nonAdminRoles,
} from './adversarial-rbac-m0-harness.js'

describe('Adversarial Challenge M0: Service Layer Mutation Authorization Matrix', () => {
  it('strictly rejects non-admin roles for approveStudent with HTTP 403', async () => {
    const domainStore = new MemoryDomainStore()
    const identityProvider = new MemoryIdentityProvider()
    const providers = createAdversarialTestProviders(domainStore, identityProvider)

    domainStore.profiles.set('pending-student', {
      user_id: 'pending-student',
      nis: '1002',
      full_name: 'Pending Student',
      role: 'student',
      lifecycle_status: 'pending',
      gender: null,
    })

    for (const role of nonAdminRoles) {
      try {
        await approveStudent({
          userId: 'pending-student',
          actorId: 'attacker-1',
          actorRole: role ?? null,
          providers,
        })
        expect.fail(`Expected approveStudent to reject role: ${String(role)}`)
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AppError)
        // SAFETY: Checked as AppError above
        const appErr = err as AppError
        expect(appErr.httpStatus).toBe(403)
        expect(appErr.code).toBe(ErrorCode.FORBIDDEN)
      }
    }
  })

  it('strictly rejects non-admin roles for rejectStudent with HTTP 403', async () => {
    const domainStore = new MemoryDomainStore()
    const identityProvider = new MemoryIdentityProvider()
    const providers = createAdversarialTestProviders(domainStore, identityProvider)

    domainStore.profiles.set('pending-student', {
      user_id: 'pending-student',
      nis: '1002',
      full_name: 'Pending Student',
      role: 'student',
      lifecycle_status: 'pending',
      gender: null,
    })

    for (const role of nonAdminRoles) {
      try {
        await rejectStudent({
          userId: 'pending-student',
          actorId: 'attacker-1',
          actorRole: role ?? null,
          providers,
        })
        expect.fail(`Expected rejectStudent to reject role: ${String(role)}`)
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AppError)
        // SAFETY: Checked as AppError above
        const appErr = err as AppError
        expect(appErr.httpStatus).toBe(403)
        expect(appErr.code).toBe(ErrorCode.FORBIDDEN)
      }
    }
  })

  it('strictly rejects non-admin roles for disableStudent with HTTP 403', async () => {
    const domainStore = new MemoryDomainStore()
    const identityProvider = new MemoryIdentityProvider()
    const providers = createAdversarialTestProviders(domainStore, identityProvider)

    domainStore.profiles.set('approved-student', {
      user_id: 'approved-student',
      nis: '1003',
      full_name: 'Approved Student',
      role: 'student',
      lifecycle_status: 'approved',
      gender: null,
    })

    for (const role of nonAdminRoles) {
      try {
        await disableStudent({
          userId: 'approved-student',
          actorId: 'attacker-1',
          actorRole: role ?? null,
          providers,
        })
        expect.fail(`Expected disableStudent to reject role: ${String(role)}`)
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AppError)
        // SAFETY: Checked as AppError above
        const appErr = err as AppError
        expect(appErr.httpStatus).toBe(403)
        expect(appErr.code).toBe(ErrorCode.FORBIDDEN)
      }
    }
  })

  it('strictly rejects non-admin roles for generateStudentResetCode with HTTP 403', async () => {
    const domainStore = new MemoryDomainStore()
    const providers = createAdversarialTestProviders(domainStore)

    domainStore.profiles.set('approved-student', {
      user_id: 'approved-student',
      nis: '1003',
      full_name: 'Approved Student',
      role: 'student',
      lifecycle_status: 'approved',
      gender: null,
    })

    for (const role of nonAdminRoles) {
      try {
        await generateStudentResetCode({
          userId: 'approved-student',
          actorId: 'attacker-1',
          actorRole: role ?? null,
          providers,
        })
        expect.fail(`Expected generateStudentResetCode to reject role: ${String(role)}`)
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AppError)
        // SAFETY: Checked as AppError above
        const appErr = err as AppError
        expect(appErr.httpStatus).toBe(403)
        expect(appErr.code).toBe(ErrorCode.FORBIDDEN)
      }
    }
  })

  it('strictly rejects non-admin roles for correctStudentEmail with HTTP 403', async () => {
    const domainStore = new MemoryDomainStore()
    const identityProvider = new MemoryIdentityProvider()
    const providers = createAdversarialTestProviders(domainStore, identityProvider)

    domainStore.profiles.set('approved-student', {
      user_id: 'approved-student',
      nis: '1003',
      full_name: 'Approved Student',
      role: 'student',
      email: 'original@school.sch.id',
      lifecycle_status: 'approved',
      gender: null,
    })

    for (const role of nonAdminRoles) {
      try {
        await correctStudentEmail({
          userId: 'approved-student',
          email: 'hacked@school.sch.id',
          actorId: 'attacker-1',
          actorRole: role ?? null,
          providers,
        })
        expect.fail(`Expected correctStudentEmail to reject role: ${String(role)}`)
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AppError)
        // SAFETY: Checked as AppError above
        const appErr = err as AppError
        expect(appErr.httpStatus).toBe(403)
        expect(appErr.code).toBe(ErrorCode.FORBIDDEN)
      }
    }
  })

  it('strictly rejects non-admin roles for resetStudentFaceEnrollment with HTTP 403', async () => {
    const domainStore = new MemoryDomainStore()
    const providers = createAdversarialTestProviders(domainStore)

    domainStore.profiles.set('approved-student', {
      user_id: 'approved-student',
      nis: '1003',
      full_name: 'Approved Student',
      role: 'student',
      lifecycle_status: 'approved',
      gender: null,
    })

    for (const role of nonAdminRoles) {
      try {
        await resetStudentFaceEnrollment({
          userId: 'approved-student',
          requestId: 'req-admin-reset',
          actorId: 'attacker-1',
          actorRole: role ?? null,
          providers,
        })
        expect.fail(`Expected resetStudentFaceEnrollment to reject role: ${String(role)}`)
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AppError)
        // SAFETY: Checked as AppError above
        const appErr = err as AppError
        expect(appErr.httpStatus).toBe(403)
        expect(appErr.code).toBe(ErrorCode.FORBIDDEN)
      }
    }
  })

  it('forwards the request ID to Robin when an admin resets face enrollment', async () => {
    const domainStore = new MemoryDomainStore()
    const deleteEnrollment = vi.fn(async () => {})
    const providers = {
      ...createAdversarialTestProviders(domainStore),
      robinClient: { ...mockRobinClient, deleteEnrollment },
    }
    domainStore.profiles.set('approved-student', {
      user_id: 'approved-student',
      nis: '1003',
      full_name: 'Approved Student',
      role: 'student',
      lifecycle_status: 'approved',
      gender: null,
    })

    await resetStudentFaceEnrollment({
      userId: 'approved-student',
      requestId: 'req-admin-reset',
      actorId: 'school-admin-1',
      actorRole: 'school_admin',
      providers,
    })

    expect(deleteEnrollment).toHaveBeenCalledWith(undefined, 'req-admin-reset', 'approved-student')
  })

  it('strictly rejects non-admin roles for class and student enrollment mutations with HTTP 403', async () => {
    const domainStore = new MemoryDomainStore()
    const providers = createAdversarialTestProviders(domainStore)

    const targetPeriod = await domainStore.createAcademicPeriod({
      name: '2026/2027 Ganjil',
      start_date: '2026-07-01',
      end_date: '2026-12-31',
    })
    const targetClass = await domainStore.createClass({
      name: 'XI TKJ 1',
      grade: 11,
      academicPeriodId: targetPeriod.id,
    })

    const nonAdminTargetRoles: IdentityRole[] = ['teacher', 'staff', 'student']
    for (const role of nonAdminTargetRoles) {
      // createClass
      await expect(
        createClass({
          name: 'Malicious Class',
          grade: 10,
          actorId: 'attacker',
          actorRole: role,
          providers,
        }),
      ).rejects.toMatchObject({ httpStatus: 403 })

      // enrollStudent
      await expect(
        enrollStudent({
          userId: 'student-target',
          classId: targetClass.id,
          academicPeriodId: targetPeriod.id,
          actorId: 'attacker',
          actorRole: role,
          providers,
        }),
      ).rejects.toMatchObject({ httpStatus: 403 })

      // transferStudentEnrollment
      await expect(
        transferStudentEnrollment({
          userId: 'student-target',
          toClassId: targetClass.id,
          academicPeriodId: targetPeriod.id,
          actorId: 'attacker',
          actorRole: role,
          providers,
        }),
      ).rejects.toMatchObject({ httpStatus: 403 })

      // promoteStudentEnrollment
      await expect(
        promoteStudentEnrollment({
          userId: 'student-target',
          fromAcademicPeriodId: targetPeriod.id,
          toAcademicPeriodId: targetPeriod.id,
          toClassId: targetClass.id,
          actorId: 'attacker',
          actorRole: role,
          providers,
        }),
      ).rejects.toMatchObject({ httpStatus: 403 })

      // exitStudentEnrollment
      await expect(
        exitStudentEnrollment({
          userId: 'student-target',
          academicPeriodId: targetPeriod.id,
          actorId: 'attacker',
          actorRole: role,
          providers,
        }),
      ).rejects.toMatchObject({ httpStatus: 403 })
    }
  })
})
