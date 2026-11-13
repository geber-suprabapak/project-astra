import { describe, it, expect } from 'vitest'
import {
  getEnrollmentStatus,
  enrollFace,
  deleteEnrollment,
} from '../../../src/modules/enrollment/service.js'
import { ErrorCode } from '../../../src/lib/errors/codes.js'
import {
  createMockEnrollmentProviders,
  createValidEnrollmentFiles,
} from './enrollment-service-harness.js'

describe('enrollment service', () => {
  describe('getEnrollmentStatus', () => {
    it('delegates to robinClient.getEnrollmentStatus on AppProviders', async () => {
      const { providers, mockGetStatus } = createMockEnrollmentProviders()

      const status = await getEnrollmentStatus('token-123', 'req-456', providers)

      expect(mockGetStatus).toHaveBeenCalledWith('token-123', 'req-456')
      expect(status).toEqual({
        status: 'enrolled',
        embeddingCount: 10,
        message: 'Ready',
      })
    })

    it('rejects unapproved profile when userId is provided', async () => {
      const { providers, domainStore } = createMockEnrollmentProviders()
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
      const { providers, domainStore } = createMockEnrollmentProviders()
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
      const { providers, mockEnroll } = createMockEnrollmentProviders()
      const files = createValidEnrollmentFiles(10)

      const result = await enrollFace(files, 'token-123', 'req-456', providers)

      expect(mockEnroll).toHaveBeenCalledWith(files, 'token-123', 'req-456')
      expect(result.status).toBe('ok')
    })

    it('rejects when file count is not exactly 10', async () => {
      const { providers } = createMockEnrollmentProviders()
      const files = createValidEnrollmentFiles(9)

      await expect(enrollFace(files, 'token-123', 'req-456', providers)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed.',
        details: 'Exactly 10 files are required. Got 9.',
      })
    })

    it('rejects when any file is not JPEG', async () => {
      const { providers } = createMockEnrollmentProviders()
      const files = createValidEnrollmentFiles(10)
      files[3].contentType = 'image/png'

      await expect(enrollFace(files, 'token-123', 'req-456', providers)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed.',
        details: 'All files must be JPEG. Got: image/png.',
      })
    })

    it('rejects when any file exceeds 2MB limit', async () => {
      const { providers } = createMockEnrollmentProviders()
      const files = createValidEnrollmentFiles(10)
      files[5].size = 2 * 1024 * 1024 + 1
      files[5].filename = 'too_large.jpg'

      await expect(enrollFace(files, 'token-123', 'req-456', providers)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed.',
        details: 'Each file must be under 2MB. "too_large.jpg" is too large.',
      })
    })

    it('stores file records, object storage, and saves face enrollment with audit log for approved student', async () => {
      const { providers, domainStore, mockEnroll } = createMockEnrollmentProviders()
      domainStore.profiles.set('student-approved', {
        user_id: 'student-approved',
        full_name: 'Approved Student',
        email: 'student@school.sch.id',
        role: 'student',
        lifecycle_status: 'approved',
      })

      const files = createValidEnrollmentFiles(10)
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
      const { providers, domainStore } = createMockEnrollmentProviders()
      domainStore.profiles.set('student-reenroll', {
        user_id: 'student-reenroll',
        full_name: 'Re-enrolling Student',
        email: 'student2@school.sch.id',
        role: 'student',
        lifecycle_status: 'approved',
      })

      const firstFiles = createValidEnrollmentFiles(10)
      await enrollFace(firstFiles, 'token-123', 'req-456', providers, 'student-reenroll')

      const secondFiles = createValidEnrollmentFiles(10)
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
      const { providers, domainStore, mockDeleteEnrollment } = createMockEnrollmentProviders()
      domainStore.profiles.set('student-del', {
        user_id: 'student-del',
        full_name: 'Deleting Student',
        email: 'del@school.sch.id',
        role: 'student',
        lifecycle_status: 'approved',
      })

      const files = createValidEnrollmentFiles(10)
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
})
