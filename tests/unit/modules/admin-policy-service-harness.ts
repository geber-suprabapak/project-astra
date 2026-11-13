import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { RobinClient } from '../../../src/clients/robin/client.js'
import type { AppProviders } from '../../../src/providers/types.js'

const mockRobinClient: RobinClient = {
  checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
  getEnrollmentStatus: async () => ({ status: 'enrolled', embeddingCount: 1, message: 'Ready' }),
  enroll: async () => ({
    status: 'ok',
    userId: 'u1',
    samplesReceived: 1,
    embeddingsCreated: 1,
    message: 'Done',
  }),
  identify: async () => ({
    status: 'match',
    candidateId: 'u1',
    confidence: 0.9,
    threshold: 0.7,
    qualityScore: 0.9,
    processTimeMs: 1,
  }),
  deleteEnrollment: async () => {},
}

export async function setupAdminPolicyTest() {
  const domainStore = new MemoryDomainStore()
  const identityProvider = new MemoryIdentityProvider()
  const objectStorage = new MemoryObjectStorage()
  const providers: AppProviders = {
    domainStore,
    identityProvider,
    objectStorage,
    robinClient: mockRobinClient,
  }
  const school = await domainStore.createSchool({
    name: 'SMK Negeri 2 Banjarmasin',
    slug: 'smkn2-bjm',
  })
  const admin = await domainStore.createInitialSchoolAdmin({
    userId: 'admin-1',
    fullName: 'School Admin',
    email: 'admin@smkn2.sch.id',
  })
  // Reset periods created during bootstrap to have clean slate for testing
  domainStore.academicPeriods = []
  // Create student profile
  domainStore.profiles.set('student-1', {
    user_id: 'student-1',
    full_name: 'Student One',
    nis: '12345',
    role: 'student',
    lifecycle_status: 'approved',
    gender: null,
  })
  return { domainStore, providers, school, admin }
}
