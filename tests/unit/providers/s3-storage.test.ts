import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { S3ObjectStorage } from '../../../src/providers/storage/s3-storage.js'
import { AppError } from '../../../src/lib/errors/app-error.js'
import { ErrorCode } from '../../../src/lib/errors/codes.js'

describe('S3ObjectStorage', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  const storageOptions = {
    endpoint: 'http://localhost:9000',
    region: 'us-east-1',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    bucketAvatars: 'avatars',
    bucketPermits: 'perizinan',
    forcePathStyle: true,
  }

  describe('checkHealth', () => {
    it('returns true when S3 returns 200 OK', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
      const storage = new S3ObjectStorage(storageOptions)

      const isHealthy = await storage.checkHealth()
      expect(isHealthy).toBe(true)
    })

    it('returns false when S3 returns 403 Forbidden (unauthorized/invalid credentials)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('Access Denied', { status: 403 }))
      const storage = new S3ObjectStorage(storageOptions)

      const isHealthy = await storage.checkHealth()
      expect(isHealthy).toBe(false)
    })

    it('returns false when S3 returns 404 Not Found (missing bucket)', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(new Response('Bucket Not Found', { status: 404 }))
      const storage = new S3ObjectStorage(storageOptions)

      const isHealthy = await storage.checkHealth()
      expect(isHealthy).toBe(false)
    })

    it('returns false when S3 returns 500 or 503 Internal Error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('Internal Error', { status: 500 }))
      const storage = new S3ObjectStorage(storageOptions)

      const isHealthy = await storage.checkHealth()
      expect(isHealthy).toBe(false)
    })

    it('returns false when network request throws or times out', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'))
      const storage = new S3ObjectStorage(storageOptions)

      const isHealthy = await storage.checkHealth()
      expect(isHealthy).toBe(false)
    })
  })

  describe('uploadAvatar and uploadPermitAttachment error sanitization', () => {
    it('sanitizes S3 upload error details without leaking raw XML to caller', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          '<Error><Code>AccessDenied</Code><Message>Secret Key invalid</Message></Error>',
          {
            status: 403,
          },
        ),
      )
      const storage = new S3ObjectStorage(storageOptions)

      try {
        await storage.uploadAvatar('user-1', Buffer.from('test-image'), 'image/jpeg')
        expect.unreachable()
      } catch (err) {
        expect(err).toBeInstanceOf(AppError)
        // SAFETY: err is verified as AppError by expect(err).toBeInstanceOf(AppError)
        const appErr = err as AppError
        expect(appErr.code).toBe(ErrorCode.STORAGE_UPLOAD_FAILED)
        expect(appErr.httpStatus).toBe(502)
        expect(appErr.message).toBe('File upload failed.')
        expect(appErr.details).toBeUndefined()
      }
    })

    it('sanitizes S3 permit attachment error details without leaking network error to caller', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:9000'))
      const storage = new S3ObjectStorage(storageOptions)

      try {
        await storage.uploadPermitAttachment('user-1', Buffer.from('test-image'), 'image/jpeg')
        expect.unreachable()
      } catch (err) {
        expect(err).toBeInstanceOf(AppError)
        // SAFETY: err is verified as AppError by expect(err).toBeInstanceOf(AppError)
        const appErr = err as AppError
        expect(appErr.code).toBe(ErrorCode.STORAGE_UPLOAD_FAILED)
        expect(appErr.httpStatus).toBe(502)
        expect(appErr.message).toBe('File upload failed.')
        expect(appErr.details).toBeUndefined()
      }
    })
  })
})
