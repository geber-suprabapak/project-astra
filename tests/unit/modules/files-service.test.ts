import { describe, it, expect } from 'vitest'
import {
  createUploadIntent,
  confirmFileUpload,
  getFile,
  deleteFile,
} from '../../../src/modules/files/service.js'
import { ErrorCode } from '../../../src/lib/errors/codes.js'
import { AppError } from '../../../src/lib/errors/app-error.js'
import { createFilesTestProviders } from './files-service-harness.js'

describe('files service', () => {
  describe('createUploadIntent', () => {
    it('creates upload intent for approved user and routes avatar to avatars bucket', async () => {
      const providers = createFilesTestProviders()
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
      const providers = createFilesTestProviders()
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
      const providers = createFilesTestProviders()
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
      const providers = createFilesTestProviders()
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
      const providers = createFilesTestProviders()
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
      const providers = createFilesTestProviders()
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
    it('confirms file upload and updates lifecycle to available after the object exists', async () => {
      const providers = createFilesTestProviders()
      const intent = await createUploadIntent({
        userId: 'student-1',
        purpose: 'permit_attachment',
        contentType: 'image/jpeg',
        providers,
      })
      providers.objectStorage.objects.set(intent.object_path, {
        buffer: Buffer.from('uploaded-bytes'),
        contentType: 'image/jpeg',
      })

      const confirmed = await confirmFileUpload({
        userId: 'student-1',
        fileId: intent.file_id,
        providers,
      })

      expect(confirmed.lifecycle).toBe('available')
    })

    it('is idempotent when the owner confirms an already available file again', async () => {
      const providers = createFilesTestProviders()
      const intent = await createUploadIntent({
        userId: 'student-1',
        purpose: 'permit_attachment',
        contentType: 'image/jpeg',
        providers,
      })
      providers.objectStorage.objects.set(intent.object_path, {
        buffer: Buffer.from('uploaded-bytes'),
        contentType: 'image/jpeg',
      })
      await confirmFileUpload({ userId: 'student-1', fileId: intent.file_id, providers })

      const second = await confirmFileUpload({
        userId: 'student-1',
        fileId: intent.file_id,
        providers,
      })

      expect(second.lifecycle).toBe('available')
    })

    it('keeps the file pending and never promotes it when no object was uploaded', async () => {
      const providers = createFilesTestProviders()
      const intent = await createUploadIntent({
        userId: 'student-1',
        purpose: 'avatar',
        contentType: 'image/jpeg',
        providers,
      })

      await expect(
        confirmFileUpload({ userId: 'student-1', fileId: intent.file_id, providers }),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })

      const record = await providers.domainStore.getFileRecord(intent.file_id)
      expect(record?.lifecycle).toBe('pending_upload')
      expect(providers.objectStorage.objects.has(intent.object_path)).toBe(false)
    })

    it('rejects the file when the stored content type does not match the intent', async () => {
      const providers = createFilesTestProviders()
      const intent = await createUploadIntent({
        userId: 'student-1',
        purpose: 'permit_attachment',
        contentType: 'application/pdf',
        providers,
      })
      providers.objectStorage.objects.set(intent.object_path, {
        buffer: Buffer.from('not-a-pdf'),
        contentType: 'image/jpeg',
      })

      await expect(
        confirmFileUpload({ userId: 'student-1', fileId: intent.file_id, providers }),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })

      const record = await providers.domainStore.getFileRecord(intent.file_id)
      expect(record?.lifecycle).toBe('rejected')
    })

    it('returns a rejected record unchanged on re-confirmation and keeps its download denied', async () => {
      const providers = createFilesTestProviders()
      const intent = await createUploadIntent({
        userId: 'student-1',
        purpose: 'permit_attachment',
        contentType: 'application/pdf',
        providers,
      })
      providers.objectStorage.objects.set(intent.object_path, {
        buffer: Buffer.from('not-a-pdf'),
        contentType: 'image/jpeg',
      })
      await expect(
        confirmFileUpload({ userId: 'student-1', fileId: intent.file_id, providers }),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })

      // Explicit lifecycle rule: re-confirmation never promotes a rejected record —
      // it echoes the stored 'rejected' state (HTTP 200 to the caller) and the object
      // check is not re-run. Download stays denied; a new intent is required.
      const reconfirmed = await confirmFileUpload({
        userId: 'student-1',
        fileId: intent.file_id,
        providers,
      })
      expect(reconfirmed.lifecycle).toBe('rejected')

      await expect(
        getFile({ userId: 'student-1', fileId: intent.file_id, userScopes: [], providers }),
      ).rejects.toMatchObject({ code: ErrorCode.RESOURCE_NOT_FOUND })
      const record = await providers.domainStore.getFileRecord(intent.file_id)
      expect(record?.lifecycle).toBe('rejected')
    })

    it('rejects the file when the stored size does not match the intent', async () => {
      const providers = createFilesTestProviders()
      const intent = await createUploadIntent({
        userId: 'student-1',
        purpose: 'avatar',
        contentType: 'image/jpeg',
        sizeBytes: 1000,
        providers,
      })
      providers.objectStorage.objects.set(intent.object_path, {
        buffer: Buffer.alloc(512),
        contentType: 'image/jpeg',
      })

      await expect(
        confirmFileUpload({ userId: 'student-1', fileId: intent.file_id, providers }),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })

      const record = await providers.domainStore.getFileRecord(intent.file_id)
      expect(record?.lifecycle).toBe('rejected')
    })

    it('keeps the file pending when the provider cannot verify objects (no statObject)', async () => {
      const providers = createFilesTestProviders()
      const intent = await createUploadIntent({
        userId: 'student-1',
        purpose: 'avatar',
        contentType: 'image/jpeg',
        providers,
      })
      providers.objectStorage.objects.set(intent.object_path, {
        buffer: Buffer.from('uploaded-bytes'),
        contentType: 'image/jpeg',
      })
      // SAFETY: shadows the prototype method with an own undefined property so the
      // optional verification capability is absent and confirmation fails closed.
      Object.defineProperty(providers.objectStorage, 'statObject', { value: undefined })

      await expect(
        confirmFileUpload({ userId: 'student-1', fileId: intent.file_id, providers }),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })

      const record = await providers.domainStore.getFileRecord(intent.file_id)
      expect(record?.lifecycle).toBe('pending_upload')
    })

    it('keeps the file pending when storage verification fails with a dependency error', async () => {
      const providers = createFilesTestProviders()
      const intent = await createUploadIntent({
        userId: 'student-1',
        purpose: 'avatar',
        contentType: 'image/jpeg',
        providers,
      })
      providers.objectStorage.statObject = async () => {
        throw AppError.dependencyUnavailable('object storage')
      }

      await expect(
        confirmFileUpload({ userId: 'student-1', fileId: intent.file_id, providers }),
      ).rejects.toMatchObject({ code: ErrorCode.DEPENDENCY_UNAVAILABLE })

      const record = await providers.domainStore.getFileRecord(intent.file_id)
      expect(record?.lifecycle).toBe('pending_upload')
    })

    it('rejects confirming file owned by another user', async () => {
      const providers = createFilesTestProviders()
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
      const providers = createFilesTestProviders()
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
})
