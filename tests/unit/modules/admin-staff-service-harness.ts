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
    userId: 'platform-admin-1',
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

export interface AdminStaffTestProvidersContext {
  providers: AppProviders
  domainStore: MemoryDomainStore
  identityProvider: MemoryIdentityProvider
}

export function createAdminStaffTestProviders(): AdminStaffTestProvidersContext {
  const domainStore = new MemoryDomainStore()
  const identityProvider = new MemoryIdentityProvider()
  const providers: AppProviders = {
    domainStore,
    objectStorage: new MemoryObjectStorage(),
    identityProvider,
    robinClient: mockRobinClient,
  }
  return { providers, domainStore, identityProvider }
}
