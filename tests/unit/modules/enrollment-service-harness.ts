import { vi } from 'vitest'
import type { EnrollmentFile } from '../../../src/modules/enrollment/service.js'
import type { AppProviders } from '../../../src/providers/types.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'

export interface MockEnrollmentProviders {
  providers: AppProviders
  domainStore: MemoryDomainStore
  objectStorage: MemoryObjectStorage
  mockGetStatus: ReturnType<typeof vi.fn>
  mockEnroll: ReturnType<typeof vi.fn>
  mockDeleteEnrollment: ReturnType<typeof vi.fn>
}

export function createMockEnrollmentProviders(): MockEnrollmentProviders {
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

export function createValidEnrollmentFiles(count = 10): EnrollmentFile[] {
  return Array.from({ length: count }, (_, i) => ({
    buffer: Buffer.from(`fake-jpeg-${i}`),
    contentType: 'image/jpeg',
    filename: `face_${i}.jpg`,
    size: 1024,
  }))
}
