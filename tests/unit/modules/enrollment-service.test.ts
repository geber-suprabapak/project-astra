import { describe, it, expect, vi } from 'vitest'
import {
  getEnrollmentStatus,
  enrollFace,
  deleteEnrollment,
  type EnrollmentFile,
} from '../../../src/modules/enrollment/service.js'
import type { AppProviders } from '../../../src/providers/types.js'
import { AppError } from '../../../src/lib/errors/app-error.js'
import { ErrorCode } from '../../../src/lib/errors/codes.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'

interface MockEnrollmentProviders {
  providers: AppProviders
  domainStore: MemoryDomainStore
  objectStorage: MemoryObjectStorage
  mockGetStatus: ReturnType<typeof vi.fn>
  mockEnroll: ReturnType<typeof vi.fn>
  mockDeleteEnrollment: ReturnType<typeof vi.fn>
}

function createMockProviders(): MockEnrollmentProviders {
  const mockGetStatus = vi.fn().mockResolvedValue({
    status: 'enrolled',
    embeddingCount: 10,
    message: 'Ready',
  })
  const mockEnroll = vi.fn().mockResolvedValue({
    status: 'ok',
    userId: 'user-123',
    samplesReceived: 10,
    embeddingsCreated: 10,
    totalEmbeddings: 10,
    message: 'Enrolled successfully.',
  })
  const mockDeleteEnrollment = vi.fn().mockResolvedValue(undefined)

  const domainStore = new MemoryDomainStore()
  const objectStorage = new MemoryObjectStorage()
  const identityProvider = new MemoryIdentityProvider()

  const providers: AppProviders = {
    domainStore,
    objectStorage,
    identityProvider,
    robinClient: {
      checkReadiness: vi.fn(),
      getEnrollmentStatus: mockGetStatus,
      enroll: mockEnroll,
      identify: vi.fn(),
      deleteEnrollment: mockDeleteEnrollment,
    },
  }

  return { providers, domainStore, objectStorage, mockGetStatus, mockEnroll, mockDeleteEnrollment }
}

function createValidFiles(count = 10): EnrollmentFile[] {
  return Array.from({ length: count }, (_, i) => ({
    buffer: Buffer.from(`fake-jpeg-${i}`),
    contentType: 'image/jpeg',
    filename: `face_${i}.jpg`,
    size: 1024,
  }))
}

describe('enrollment service', () => {
  describe('getEnrollmentStatus', () => {
    it('delegates to robinClient.getEnrollmentStatus on AppProviders', async () => {
      const { providers, mockGetStatus } = createMockProviders()

      const status = await getEnrollmentStatus('token-123', 'req-456', providers)

      expect(mockGetStatus).toHaveBeenCalledWith('token-123', 'req-456')
      expect(status).toEqual({
        status: 'enrolled',
        embeddingCount: 10,
        message: 'Ready',
      })
    })

    it('rejects unapproved profile when userId is provided', async () => {
      const { providers, domainStore } = createMockProviders()
      domainStore.profiles.set('student-pending', {
        user_id: 'student-pending',
        full_name: 'Pending Student',
        email: 'pending@school.sch.id',
        role: 'student',
        lifecycle_status: 'pending',
      })

      await expect(
        getEnrollmentStatus('token-123', 'req-456', providers, 'student-pending'),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      })
    })

    it('rejects non-student profile when userId is provided', async () => {
      const { providers, domainStore } = createMockProviders()
      domainStore.profiles.set('staff-1', {
        user_id: 'staff-1',
        full_name: 'Staff User',
        email: 'staff@school.sch.id',
        role: 'staff',
        lifecycle_status: 'approved',
      })

      await expect(
        getEnrollmentStatus('token-123', 'req-456', providers, 'staff-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      })
    })
  })

  describe('enrollFace', () => {
    it('succeeds with 10 valid JPEG images under 2MB', async () => {
      const { providers, mockEnroll } = createMockProviders()
      const files = createValidFiles(10)

      const result = await enrollFace(files, 'token-123', 'req-456', providers)

      expect(mockEnroll).toHaveBeenCalledWith(files, 'token-123', 'req-456')
      expect(result.status).toBe('ok')
    })

    it('rejects when file count is not exactly 10', async () => {
      const { providers } = createMockProviders()
      const files = createValidFiles(9)

      await expect(enrollFace(files, 'token-123', 'req-456', providers)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed.',
        details: 'Exactly 10 files are required. Got 9.',
      })
    })

    it('rejects when any file is not JPEG', async () => {
      const { providers } = createMockProviders()
      const files = createValidFiles(10)
      files[3].contentType = 'image/png'

      await expect(enrollFace(files, 'token-123', 'req-456', providers)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed.',
        details: 'All files must be JPEG. Got: image/png.',
      })
    })

    it('rejects when any file exceeds 2MB limit', async () => {
      const { providers } = createMockProviders()
      const files = createValidFiles(10)
      files[5].size = 2 * 1024 * 1024 + 1
      files[5].filename = 'too_large.jpg'

      await expect(enrollFace(files, 'token-123', 'req-456', providers)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed.',
        details: 'Each file must be under 2MB. "too_large.jpg" is too large.',
      })
    })

    it('stores file records, object storage, and saves face enrollment with audit log for approved student', async () => {
      const { providers, domainStore, mockEnroll } = createMockProviders()
      domainStore.profiles.set('student-approved', {
        user_id: 'student-approved',
        full_name: 'Approved Student',
        email: 'student@school.sch.id',
        role: 'student',
        lifecycle_status: 'approved',
      })

      const files = createValidFiles(10)
      const result = await enrollFace(files, 'token-123', 'req-456', providers, 'student-approved')

      expect(mockEnroll).toHaveBeenCalledWith(files, 'token-123', 'req-456')
      expect(result.status).toBe('ok')

      const storedFiles = await domainStore.listFiles({
        userId: 'student-approved',
        purpose: 'face_enrollment',
      })
      expect(storedFiles.filter((f) => f.lifecycle === 'available')).toHaveLength(10)

      const enrollmentRecord = await domainStore.getFaceEnrollment('student-approved')
      expect(enrollmentRecord).not.toBeNull()
      expect(enrollmentRecord?.status).toBe('enrolled')
      expect(enrollmentRecord?.sample_count).toBe(10)

      const auditLogs = await domainStore.getAuditLogs('face_enrollment', 'student-approved')
      expect(auditLogs.length).toBeGreaterThan(0)
      expect(auditLogs[0].action).toBe('face_enrollment:enrolled')
    })

    it('replaces face enrollment idempotently upon re-enrollment', async () => {
      const { providers, domainStore } = createMockProviders()
      domainStore.profiles.set('student-reenroll', {
        user_id: 'student-reenroll',
        full_name: 'Re-enrolling Student',
        email: 'student2@school.sch.id',
        role: 'student',
        lifecycle_status: 'approved',
      })

      const firstFiles = createValidFiles(10)
      await enrollFace(firstFiles, 'token-123', 'req-456', providers, 'student-reenroll')

      const secondFiles = createValidFiles(10)
      await enrollFace(secondFiles, 'token-123', 'req-456', providers, 'student-reenroll')

      const storedFiles = await domainStore.listFiles({
        userId: 'student-reenroll',
        purpose: 'face_enrollment',
        lifecycle: 'available',
      })
      expect(storedFiles).toHaveLength(10)
    })
  })

  describe('deleteEnrollment', () => {
    it('clears face enrollment, removes files, and logs audit record', async () => {
      const { providers, domainStore, mockDeleteEnrollment } = createMockProviders()
      domainStore.profiles.set('student-del', {
        user_id: 'student-del',
        full_name: 'Deleting Student',
        email: 'del@school.sch.id',
        role: 'student',
        lifecycle_status: 'approved',
      })

      const files = createValidFiles(10)
      await enrollFace(files, 'token-123', 'req-456', providers, 'student-del')

      await deleteEnrollment({
        userId: 'student-del',
        token: 'token-123',
        requestId: 'req-456',
        providers,
      })

      expect(mockDeleteEnrollment).toHaveBeenCalledWith('token-123', 'req-456', 'student-del')

      const activeFiles = await domainStore.listFiles({
        userId: 'student-del',
        purpose: 'face_enrollment',
        lifecycle: 'available',
      })
      expect(activeFiles).toHaveLength(0)

      const faceRecord = await domainStore.getFaceEnrollment('student-del')
      expect(faceRecord?.status).toBe('not_enrolled')

      const auditLogs = await domainStore.getAuditLogs('face_enrollment', 'student-del')
      const deleteLog = auditLogs.find((l) => l.action === 'face_enrollment:deleted')
      expect(deleteLog).toBeDefined()
    })
  })

  // A07 failure-injection coverage: every external-provider boundary in the
  // replacement and deletion flows is injected against Memory providers and a
  // mocked Robin client, asserting the observable state stays explicit and a
  // retry can complete or reconcile without claiming an incomplete
  // replacement/deletion succeeded.
  describe('replacement and deletion failure recovery (A07)', () => {
    function seedApprovedStudent(domainStore: MemoryDomainStore, userId: string) {
      domainStore.profiles.set(userId, {
        user_id: userId,
        full_name: `Student ${userId}`,
        email: `${userId}@school.sch.id`,
        role: 'student',
        lifecycle_status: 'approved',
      })
    }

    async function activeFileIds(
      domainStore: MemoryDomainStore,
      userId: string,
    ): Promise<string[]> {
      const files = await domainStore.listFiles({
        userId,
        purpose: 'face_enrollment',
        lifecycle: 'available',
      })
      return files.map((f) => f.id).sort()
    }

    async function enrolledAuditCount(
      domainStore: MemoryDomainStore,
      userId: string,
    ): Promise<number> {
      const logs = await domainStore.getAuditLogs('face_enrollment', userId)
      return logs.filter((l) => l.action === 'face_enrollment:enrolled').length
    }

    it('Robin enroll failure leaves the previous enrollment intact and a retry completes', async () => {
      const { providers, domainStore, mockEnroll } = createMockProviders()
      seedApprovedStudent(domainStore, 'student-a07-1')
      const firstFiles = createValidFiles(10)
      await enrollFace(firstFiles, 'token-123', 'req-456', providers, 'student-a07-1')
      const baselineIds = await activeFileIds(domainStore, 'student-a07-1')
      expect(baselineIds).toHaveLength(10)

      mockEnroll.mockRejectedValueOnce(AppError.dependencyUnavailable('Robin'))

      await expect(
        enrollFace(createValidFiles(10), 'token-123', 'req-456', providers, 'student-a07-1'),
      ).rejects.toMatchObject({ code: ErrorCode.DEPENDENCY_UNAVAILABLE })

      // Nothing was mutated before the failed Robin boundary.
      expect(await activeFileIds(domainStore, 'student-a07-1')).toEqual(baselineIds)
      expect((await domainStore.getFaceEnrollment('student-a07-1'))?.status).toBe('enrolled')
      expect(await enrolledAuditCount(domainStore, 'student-a07-1')).toBe(1)

      // Retry completes the replacement.
      await expect(
        enrollFace(createValidFiles(10), 'token-123', 'req-456', providers, 'student-a07-1'),
      ).resolves.toMatchObject({ status: 'ok' })
      expect(await activeFileIds(domainStore, 'student-a07-1')).toHaveLength(10)
      expect((await domainStore.getFaceEnrollment('student-a07-1'))?.status).toBe('enrolled')
    })

    it('replacement object-write failure rolls back new records and preserves the previous enrollment', async () => {
      const { providers, domainStore, objectStorage } = createMockProviders()
      seedApprovedStudent(domainStore, 'student-a07-2')
      await enrollFace(createValidFiles(10), 'token-123', 'req-456', providers, 'student-a07-2')
      const baselineIds = await activeFileIds(domainStore, 'student-a07-2')

      const originalUpload = objectStorage.uploadFaceEnrollmentImage.bind(objectStorage)
      let uploadCalls = 0
      const uploadSpy = vi
        .spyOn(objectStorage, 'uploadFaceEnrollmentImage')
        .mockImplementation(async (...args) => {
          uploadCalls++
          if (uploadCalls === 5) throw AppError.storageUploadFailed()
          return originalUpload(...args)
        })

      await expect(
        enrollFace(createValidFiles(10), 'token-123', 'req-456', providers, 'student-a07-2'),
      ).rejects.toMatchObject({ code: ErrorCode.STORAGE_UPLOAD_FAILED })
      expect(uploadCalls).toBe(5)

      // The four records created before the failure were rolled back; only the
      // previous ten records remain active.
      expect(await activeFileIds(domainStore, 'student-a07-2')).toEqual(baselineIds)
      expect((await domainStore.getFaceEnrollment('student-a07-2'))?.status).toBe('enrolled')

      uploadSpy.mockRestore()
      await expect(
        enrollFace(createValidFiles(10), 'token-123', 'req-456', providers, 'student-a07-2'),
      ).resolves.toMatchObject({ status: 'ok' })
      expect(await activeFileIds(domainStore, 'student-a07-2')).toHaveLength(10)
    })

    it('metadata record-write failure rolls back created records and a retry completes', async () => {
      const { providers, domainStore } = createMockProviders()
      seedApprovedStudent(domainStore, 'student-a07-2b')
      await enrollFace(createValidFiles(10), 'token-123', 'req-456', providers, 'student-a07-2b')
      const baselineIds = await activeFileIds(domainStore, 'student-a07-2b')

      const originalCreate = domainStore.createFileRecord.bind(domainStore)
      let createCalls = 0
      const createSpy = vi
        .spyOn(domainStore, 'createFileRecord')
        .mockImplementation(async (...args) => {
          createCalls++
          if (createCalls === 3) throw AppError.internal('record write failed')
          return originalCreate(...args)
        })

      await expect(
        enrollFace(createValidFiles(10), 'token-123', 'req-456', providers, 'student-a07-2b'),
      ).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR })

      expect(await activeFileIds(domainStore, 'student-a07-2b')).toEqual(baselineIds)

      createSpy.mockRestore()
      await expect(
        enrollFace(createValidFiles(10), 'token-123', 'req-456', providers, 'student-a07-2b'),
      ).resolves.toMatchObject({ status: 'ok' })
      expect(await activeFileIds(domainStore, 'student-a07-2b')).toHaveLength(10)
    })

    it('rollback failure never masks the original object-write error and a retry reconciles leftovers', async () => {
      const { providers, domainStore, objectStorage } = createMockProviders()
      seedApprovedStudent(domainStore, 'student-a07-2c')
      await enrollFace(createValidFiles(10), 'token-123', 'req-456', providers, 'student-a07-2c')

      // Fail the object write at #5 and fail every rollback delete as well.
      const originalUpload = objectStorage.uploadFaceEnrollmentImage.bind(objectStorage)
      let uploadCalls = 0
      const uploadSpy = vi
        .spyOn(objectStorage, 'uploadFaceEnrollmentImage')
        .mockImplementation(async (...args) => {
          uploadCalls++
          if (uploadCalls === 5) throw AppError.storageUploadFailed()
          return originalUpload(...args)
        })
      const deleteSpy = vi
        .spyOn(domainStore, 'deleteFileRecord')
        .mockRejectedValue(AppError.internal('rollback failed'))

      // The ORIGINAL storage error surfaces, not the rollback error.
      await expect(
        enrollFace(createValidFiles(10), 'token-123', 'req-456', providers, 'student-a07-2c'),
      ).rejects.toMatchObject({ code: ErrorCode.STORAGE_UPLOAD_FAILED })
      expect(uploadCalls).toBe(5)

      // Rollback was attempted for every created record and left the four
      // created records in place, on top of the previous ten.
      expect(deleteSpy).toHaveBeenCalledTimes(4)
      expect(await activeFileIds(domainStore, 'student-a07-2c')).toHaveLength(14)
      expect((await domainStore.getFaceEnrollment('student-a07-2c'))?.status).toBe('enrolled')

      uploadSpy.mockRestore()
      deleteSpy.mockRestore()
      // The retry snapshots the leftovers as pre-existing and retires them
      // after Robin confirms, returning to exactly ten active records.
      await expect(
        enrollFace(createValidFiles(10), 'token-123', 'req-456', providers, 'student-a07-2c'),
      ).resolves.toMatchObject({ status: 'ok' })
      expect(await activeFileIds(domainStore, 'student-a07-2c')).toHaveLength(10)
      expect((await domainStore.getFaceEnrollment('student-a07-2c'))?.status).toBe('enrolled')
    })

    it('old-record cleanup failure after Robin confirmation stays explicit and a retry reconciles to exactly ten', async () => {
      const { providers, domainStore, mockEnroll } = createMockProviders()
      seedApprovedStudent(domainStore, 'student-a07-3')
      await enrollFace(createValidFiles(10), 'token-123', 'req-456', providers, 'student-a07-3')

      // deleteFileRecord is first called by the post-Robin cleanup of the
      // previous records; fail that boundary once.
      const deleteSpy = vi
        .spyOn(domainStore, 'deleteFileRecord')
        .mockRejectedValueOnce(AppError.internal('cleanup failed'))

      await expect(
        enrollFace(createValidFiles(10), 'token-123', 'req-456', providers, 'student-a07-3'),
      ).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR })
      expect(mockEnroll).toHaveBeenCalledTimes(2)

      // Robin already confirmed the replacement, so the new records exist and
      // the stale previous records are still active — explicit, never a false
      // success claim.
      expect(await activeFileIds(domainStore, 'student-a07-3')).toHaveLength(20)
      expect((await domainStore.getFaceEnrollment('student-a07-3'))?.status).toBe('enrolled')

      deleteSpy.mockRestore()
      await expect(
        enrollFace(createValidFiles(10), 'token-123', 'req-456', providers, 'student-a07-3'),
      ).resolves.toMatchObject({ status: 'ok' })
      expect(await activeFileIds(domainStore, 'student-a07-3')).toHaveLength(10)
      expect((await domainStore.getFaceEnrollment('student-a07-3'))?.status).toBe('enrolled')
    })

    it('first-enrollment state-update failure reconciles through the status read', async () => {
      const { providers, domainStore } = createMockProviders()
      seedApprovedStudent(domainStore, 'student-a07-4')

      const saveSpy = vi
        .spyOn(domainStore, 'saveFaceEnrollment')
        .mockRejectedValueOnce(AppError.internal('state update failed'))

      await expect(
        enrollFace(createValidFiles(10), 'token-123', 'req-456', providers, 'student-a07-4'),
      ).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR })
      saveSpy.mockRestore()

      // Robin (mock) confirmed, records are in place, but no Astra state yet —
      // never a new enrolled state unsupported by Robin, and none saved here.
      expect(await activeFileIds(domainStore, 'student-a07-4')).toHaveLength(10)
      expect(await domainStore.getFaceEnrollment('student-a07-4')).toBeNull()

      // The existing status-read reconciliation persists 'enrolled' from
      // Robin's answer.
      const status = await getEnrollmentStatus('token-123', 'req-456', providers, 'student-a07-4')
      expect(status.status).toBe('enrolled')
      expect((await domainStore.getFaceEnrollment('student-a07-4'))?.status).toBe('enrolled')
    })

    it('audit failure fails the request but the committed state stays consistent and a retry completes', async () => {
      const { providers, domainStore } = createMockProviders()
      seedApprovedStudent(domainStore, 'student-a07-5')
      await enrollFace(createValidFiles(10), 'token-123', 'req-456', providers, 'student-a07-5')
      expect(await enrolledAuditCount(domainStore, 'student-a07-5')).toBe(1)

      const auditSpy = vi
        .spyOn(domainStore, 'insertAuditLog')
        .mockRejectedValueOnce(AppError.internal('audit failed'))

      await expect(
        enrollFace(createValidFiles(10), 'token-123', 'req-456', providers, 'student-a07-5'),
      ).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR })
      auditSpy.mockRestore()

      expect(await activeFileIds(domainStore, 'student-a07-5')).toHaveLength(10)
      expect((await domainStore.getFaceEnrollment('student-a07-5'))?.status).toBe('enrolled')
      expect(await enrolledAuditCount(domainStore, 'student-a07-5')).toBe(1)

      await expect(
        enrollFace(createValidFiles(10), 'token-123', 'req-456', providers, 'student-a07-5'),
      ).resolves.toMatchObject({ status: 'ok' })
      expect(await activeFileIds(domainStore, 'student-a07-5')).toHaveLength(10)
      expect(await enrolledAuditCount(domainStore, 'student-a07-5')).toBe(2)
    })

    it('Robin delete failure keeps the Astra enrollment intact and a retry completes', async () => {
      const { providers, domainStore, mockDeleteEnrollment } = createMockProviders()
      seedApprovedStudent(domainStore, 'student-a07-6')
      await enrollFace(createValidFiles(10), 'token-123', 'req-456', providers, 'student-a07-6')
      const baselineIds = await activeFileIds(domainStore, 'student-a07-6')

      mockDeleteEnrollment.mockRejectedValueOnce(AppError.dependencyUnavailable('Robin'))

      await expect(
        deleteEnrollment({
          userId: 'student-a07-6',
          token: 'token-123',
          requestId: 'req-456',
          providers,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.DEPENDENCY_UNAVAILABLE })

      // Astra did not clear anything Robin did not delete.
      expect(await activeFileIds(domainStore, 'student-a07-6')).toEqual(baselineIds)
      expect((await domainStore.getFaceEnrollment('student-a07-6'))?.status).toBe('enrolled')
      const logs = await domainStore.getAuditLogs('face_enrollment', 'student-a07-6')
      expect(logs.some((l) => l.action === 'face_enrollment:deleted')).toBe(false)

      await expect(
        deleteEnrollment({
          userId: 'student-a07-6',
          token: 'token-123',
          requestId: 'req-456',
          providers,
        }),
      ).resolves.toBeUndefined()
      expect(await activeFileIds(domainStore, 'student-a07-6')).toHaveLength(0)
      expect((await domainStore.getFaceEnrollment('student-a07-6'))?.status).toBe('not_enrolled')
    })

    it('object cleanup failure after Robin delete is explicit and a retry completes', async () => {
      const { providers, domainStore, objectStorage } = createMockProviders()
      seedApprovedStudent(domainStore, 'student-a07-7')
      await enrollFace(createValidFiles(10), 'token-123', 'req-456', providers, 'student-a07-7')

      const imagesSpy = vi
        .spyOn(objectStorage, 'deleteFaceEnrollmentImages')
        .mockRejectedValueOnce(AppError.storageUploadFailed())

      await expect(
        deleteEnrollment({
          userId: 'student-a07-7',
          token: 'token-123',
          requestId: 'req-456',
          providers,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.STORAGE_UPLOAD_FAILED })

      expect(await activeFileIds(domainStore, 'student-a07-7')).toHaveLength(10)
      expect((await domainStore.getFaceEnrollment('student-a07-7'))?.status).toBe('enrolled')

      imagesSpy.mockRestore()
      await expect(
        deleteEnrollment({
          userId: 'student-a07-7',
          token: 'token-123',
          requestId: 'req-456',
          providers,
        }),
      ).resolves.toBeUndefined()
      expect(await activeFileIds(domainStore, 'student-a07-7')).toHaveLength(0)
      expect((await domainStore.getFaceEnrollment('student-a07-7'))?.status).toBe('not_enrolled')
    })

    it('audit failure after a completed deletion stays reconcilable and a retry completes', async () => {
      const { providers, domainStore } = createMockProviders()
      seedApprovedStudent(domainStore, 'student-a07-8')
      await enrollFace(createValidFiles(10), 'token-123', 'req-456', providers, 'student-a07-8')

      const auditSpy = vi
        .spyOn(domainStore, 'insertAuditLog')
        .mockRejectedValueOnce(AppError.internal('audit failed'))

      await expect(
        deleteEnrollment({
          userId: 'student-a07-8',
          token: 'token-123',
          requestId: 'req-456',
          providers,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR })
      auditSpy.mockRestore()

      // Astra state was fully cleared; only the audit entry is missing.
      expect(await activeFileIds(domainStore, 'student-a07-8')).toHaveLength(0)
      expect((await domainStore.getFaceEnrollment('student-a07-8'))?.status).toBe('not_enrolled')

      await expect(
        deleteEnrollment({
          userId: 'student-a07-8',
          token: 'token-123',
          requestId: 'req-456',
          providers,
        }),
      ).resolves.toBeUndefined()
      const logs = await domainStore.getAuditLogs('face_enrollment', 'student-a07-8')
      expect(logs.some((l) => l.action === 'face_enrollment:deleted')).toBe(true)
    })
  })
})
