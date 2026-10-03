import { describe, it, expect, vi } from 'vitest'
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

    it('rejects generic Adiwiyata evidence upload intents', async () => {
      const providers = createTestProviders()
      await expect(
        createUploadIntent({
          userId: 'student-1',
          purpose: 'adiwiyata_report',
          contentType: 'image/jpeg',
          providers,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })
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

    it('keeps pending Adiwiyata metadata under report-transaction control', async () => {
      const providers = createTestProviders()
      const file = await providers.domainStore.createFileRecord({
        userId: 'student-1',
        purpose: 'adiwiyata_report',
        objectPath: 'reports/pending.jpg',
        contentType: 'image/jpeg',
        lifecycle: 'pending_upload',
      })
      providers.objectStorage.objects.set(file.object_path, {
        buffer: Buffer.from('evidence'),
        contentType: 'image/jpeg',
      })

      await expect(
        confirmFileUpload({
          userId: 'student-1',
          fileId: file.id,
          providers,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
      await expect(
        deleteFile({
          userId: 'student-1',
          fileId: file.id,
          providers,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })

      expect((await providers.domainStore.getFileRecord(file.id))?.lifecycle).toBe('pending_upload')
      expect(providers.objectStorage.objects.has(file.object_path)).toBe(true)
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

    it('allows only an owner or an approved Astra administrator with scope to read Adiwiyata evidence', async () => {
      const providers = createTestProviders()
      providers.domainStore.profiles.set('teacher-1', {
        user_id: 'teacher-1',
        full_name: 'Teacher',
        role: 'teacher',
        lifecycle_status: 'approved',
      })
      providers.domainStore.profiles.set('school-admin-1', {
        user_id: 'school-admin-1',
        full_name: 'School Admin',
        role: 'school_admin',
        lifecycle_status: 'approved',
      })
      providers.domainStore.profiles.set('platform-admin-pending', {
        user_id: 'platform-admin-pending',
        full_name: 'Pending Admin',
        role: 'platform_admin',
        lifecycle_status: 'pending',
      })
      const file = await providers.domainStore.createFileRecord({
        userId: 'student-1',
        purpose: 'adiwiyata_report',
        objectPath: 'reports/private.jpg',
        contentType: 'image/jpeg',
        lifecycle: 'available',
      })

      providers.objectStorage.getSignedAdiwiyataReportUrl = async () =>
        'https://storage.local/private'
      const owner = await getFile({ userId: 'student-1', fileId: file.id, providers })
      expect(owner.download_url).toBe('https://storage.local/private')

      await expect(
        getFile({
          userId: 'teacher-1',
          fileId: file.id,
          userScopes: ['files:read:any'],
          providers,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN })
      await expect(
        getFile({
          userId: 'school-admin-1',
          fileId: file.id,
          userScopes: ['files:read:any'],
          providers,
        }),
      ).resolves.toMatchObject({
        file: { id: file.id },
        download_url: 'https://storage.local/private',
      })
      await expect(
        getFile({
          userId: 'platform-admin-pending',
          fileId: file.id,
          userScopes: ['files:read:any'],
          providers,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN })
    })

    it('does not issue a report URL after the file retention deadline', async () => {
      const providers = createTestProviders()
      const file = await providers.domainStore.createFileRecord({
        userId: 'student-1',
        purpose: 'adiwiyata_report',
        objectPath: 'reports/expired.jpg',
        contentType: 'image/jpeg',
        lifecycle: 'available',
      })
      providers.domainStore.files.get(file.id)!.created_at = '2024-01-01T00:00:00.000Z'
      const signedUrl = vi.fn(async () => 'https://storage.local/expired')
      providers.objectStorage.getSignedAdiwiyataReportUrl = signedUrl

      const result = await getFile({ userId: 'student-1', fileId: file.id, providers })

      expect(result.download_url).toBeNull()
      expect(signedUrl).not.toHaveBeenCalled()
    })

    it('caps a photo URL at the exact 365-day file deadline and preserves metadata afterward', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      try {
        const providers = createTestProviders()
        const file = await providers.domainStore.createFileRecord({
          userId: 'student-1',
          purpose: 'adiwiyata_report',
          objectPath: 'reports/deadline.jpg',
          contentType: 'image/jpeg',
          lifecycle: 'available',
        })
        providers.domainStore.files.get(file.id)!.created_at = '2025-09-30T00:00:00.000Z'
        const signedUrl = vi.fn(async () => 'https://storage.local/bounded')
        providers.objectStorage.getSignedAdiwiyataReportUrl = signedUrl
        vi.setSystemTime(new Date('2026-09-29T23:59:58.500Z'))
        expect(
          (await getFile({ userId: 'student-1', fileId: file.id, providers })).download_url,
        ).toBe('https://storage.local/bounded')
        expect(signedUrl).toHaveBeenLastCalledWith(file.object_path, 1)
        vi.setSystemTime(new Date('2026-09-30T00:00:00.000Z'))
        const expired = await getFile({ userId: 'student-1', fileId: file.id, providers })
        expect(expired.download_url).toBeNull()
        expect(expired.file.lifecycle).toBe('available')
        expect(signedUrl).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
