import { describe, it, expect, vi } from 'vitest'
import { getEnrollmentStatus, enrollFace, type EnrollmentFile } from '../../../src/modules/enrollment/service.js'
import type { AppProviders } from '../../../src/providers/types.js'
import { ErrorCode } from '../../../src/lib/errors/codes.js'

function createMockProviders(): {
  providers: AppProviders
  mockGetStatus: ReturnType<typeof vi.fn>
  mockEnroll: ReturnType<typeof vi.fn>
} {
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
    message: 'Enrolled successfully.',
  })

  const providers: AppProviders = {
    domainStore: {} as any,
    objectStorage: {} as any,
    identityProvider: {} as any,
    robinClient: {
      checkReadiness: vi.fn(),
      getEnrollmentStatus: mockGetStatus,
      enroll: mockEnroll,
      identify: vi.fn(),
      deleteEnrollment: vi.fn(),
    },
  }

  return { providers, mockGetStatus, mockEnroll }
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
  })
})
