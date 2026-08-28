import { describe, it, expect } from 'vitest'
import {
  createUploadIntent,
  confirmFileUpload,
  getFile,
  deleteFile,
} from '../../../src/modules/files/service.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { AppProviders } from '../../../src/providers/types.js'
import { ErrorCode } from '../../../src/lib/errors/codes.js'

function createTestProviders(): AppProviders {
  const domainStore = new MemoryDomainStore()
  const objectStorage = new MemoryObjectStorage()
  const identityProvider = new MemoryIdentityProvider()

  domainStore.profiles.set('student-1', {
    user_id: 'student-1',
    full_name: 'Student One',
    email: 'student1@school.sch.id',
    role: 'student',
    lifecycle_status: 'approved',
  })

  domainStore.profiles.set('student-pending', {
    user_id: 'student-pending',
    full_name: 'Pending Student',
    email: 'pending@school.sch.id',
    role: 'student',
    lifecycle_status: 'pending',
  })

  domainStore.profiles.set('staff-1', {
    user_id: 'staff-1',
    full_name: 'Staff Member',
    email: 'staff@school.sch.id',
    role: 'staff',
    lifecycle_status: 'approved',
  })

  return {
    domainStore,
    objectStorage,
    identityProvider,
    robinClient: {
      checkReadiness: async () => ({ healthy: true }),
      getEnrollmentStatus: async () => ({ status: 'not_enrolled', embeddingCount: 0 }),
      enroll: async () => ({ totalEmbeddings: 10 }),
      identify: async () => ({ processTimeMs: 10 }),
      deleteEnrollment: async () => {},
    },
  }
}

describe('files service', () => {
  describe('createUploadIntent', () => {
    it('creates upload intent for approved user and routes avatar to avatars bucket', async () => {
      const providers = createTestProviders()
      let capturedBucket: string | undefined
      providers.objectStorage.getPresignedUploadUrl = async (params) => {
        capturedBucket = params.bucket
        return `https://storage.local/upload/${encodeURIComponent(params.key)}`
      }

      const intent = await createUploadIntent({
        userId: 'student-1',
        purpose: 'avatar',
        contentType: 'image/jpeg',
        sizeBytes: 1024 * 1024,
        providers,
      })

      expect(intent.file_id).toBeDefined()
      expect(intent.upload_url).toBeDefined()
      expect(intent.purpose).toBe('avatar')
      expect(capturedBucket).toBe('avatars')

      const fileRecord = await providers.domainStore.getFileRecord(intent.file_id)
      expect(fileRecord).not.toBeNull()
      expect(fileRecord?.lifecycle).toBe('pending_upload')
    })

    it('routes permit_attachment upload intent to perizinan bucket', async () => {
      const providers = createTestProviders()
      let capturedBucket: string | undefined
      providers.objectStorage.getPresignedUploadUrl = async (params) => {
        capturedBucket = params.bucket
        return `https://storage.local/upload/${encodeURIComponent(params.key)}`
      }

      const intent = await createUploadIntent({
        userId: 'student-1',
        purpose: 'permit_attachment',
        contentType: 'application/pdf',
        sizeBytes: 50 * 1024,
        providers,
      })

      expect(intent.file_id).toBeDefined()
      expect(intent.purpose).toBe('permit_attachment')
      expect(capturedBucket).toBe('perizinan')
    })

    it('rejects unapproved user', async () => {
      const providers = createTestProviders()
      await expect(
        createUploadIntent({
          userId: 'student-pending',
          purpose: 'avatar',
          contentType: 'image/jpeg',
          providers,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      })
    })

    it('rejects invalid content type', async () => {
      const providers = createTestProviders()
      await expect(
        createUploadIntent({
          userId: 'student-1',
          purpose: 'avatar',
          contentType: 'application/exe',
          providers,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
      })
    })

    it('rejects oversized file', async () => {
      const providers = createTestProviders()
      await expect(
        createUploadIntent({
          userId: 'student-1',
          purpose: 'avatar',
          contentType: 'image/jpeg',
          sizeBytes: 6 * 1024 * 1024,
          providers,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
      })
    })
  })

  describe('confirmFileUpload', () => {
    it('confirms file upload and updates lifecycle to available', async () => {
      const providers = createTestProviders()
      const intent = await createUploadIntent({
        userId: 'student-1',
        purpose: 'permit_attachment',
        contentType: 'image/jpeg',
        providers,
      })

      const confirmed = await confirmFileUpload({
        userId: 'student-1',
        fileId: intent.file_id,
        providers,
      })

      expect(confirmed.lifecycle).toBe('available')
    })

    it('rejects confirming file owned by another user', async () => {
      const providers = createTestProviders()
      const intent = await createUploadIntent({
        userId: 'student-1',
        purpose: 'permit_attachment',
        contentType: 'image/jpeg',
        providers,
      })

      await expect(
        confirmFileUpload({
          userId: 'staff-1',
          fileId: intent.file_id,
          providers,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      })
    })
  })

  describe('getFile and deleteFile', () => {
    it('authorizes file download for owner and privileged staff', async () => {
      const providers = createTestProviders()
      const intent = await createUploadIntent({
        userId: 'student-1',
        purpose: 'avatar',
        contentType: 'image/jpeg',
        providers,
      })
      await confirmFileUpload({
        userId: 'student-1',
        fileId: intent.file_id,
        providers,
      })

      const ownerView = await getFile({
        userId: 'student-1',
        fileId: intent.file_id,
        userScopes: [],
        providers,
      })
      expect(ownerView.file.id).toBe(intent.file_id)
      expect(ownerView.download_url).toBeDefined()

      const staffView = await getFile({
        userId: 'staff-1',
        fileId: intent.file_id,
        userScopes: ['files:read:any'],
        providers,
      })
      expect(staffView.file.id).toBe(intent.file_id)
    })

    it('deletes file and marks lifecycle as deleted', async () => {
      const providers = createTestProviders()
      const intent = await createUploadIntent({
        userId: 'student-1',
        purpose: 'avatar',
        contentType: 'image/jpeg',
        providers,
      })
      await confirmFileUpload({
        userId: 'student-1',
        fileId: intent.file_id,
        providers,
      })
      providers.objectStorage.objects.set(intent.object_path, {
        buffer: Buffer.from('fixture'),
        contentType: 'image/jpeg',
      })

      await deleteFile({
        userId: 'student-1',
        fileId: intent.file_id,
        userScopes: [],
        providers,
      })

      const record = await providers.domainStore.getFileRecord(intent.file_id)
      expect(record?.lifecycle).toBe('deleted')
      expect(providers.objectStorage.objects.has(intent.object_path)).toBe(false)
    })
  })
})
