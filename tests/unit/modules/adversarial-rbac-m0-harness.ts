import type { JWTPayload } from 'jose'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { RobinClient } from '../../../src/clients/robin/client.js'
import type { AppProviders, IdentityRole } from '../../../src/providers/types.js'

export const mockRobinClient: RobinClient = {
  checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
  getEnrollmentStatus: async () => ({
    status: 'not_enrolled',
    embeddingCount: 0,
    message: 'No enrollment found.',
  }),
  enroll: async () => ({
    status: 'ok',
    userId: 'student-target',
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

export function createAdversarialTestProviders(
  domainStore = new MemoryDomainStore(),
  identityProvider = new MemoryIdentityProvider(),
): AppProviders {
  return {
    domainStore,
    objectStorage: new MemoryObjectStorage(),
    identityProvider,
    robinClient: mockRobinClient,
  }
}

export function tokenFor(payload: JWTPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${encodedPayload}.signature`
}

function toAdversarialRole(value: string): IdentityRole {
  // SAFETY: Intentionally casting arbitrary strings to test service runtime boundary enforcement
  return value as IdentityRole
}

export const adminRoles: IdentityRole[] = ['platform_admin', 'school_admin']
export const nonAdminRoles: (IdentityRole | null | undefined)[] = [
  'teacher',
  'staff',
  'student',
  null,
  undefined,
  toAdversarialRole('guru'),
  toAdversarialRole('wali_kelas'),
  toAdversarialRole('siswa'),
  toAdversarialRole('admin'),
  toAdversarialRole('root'),
  toAdversarialRole('superadmin'),
  toAdversarialRole(''),
  toAdversarialRole('__proto__'),
  toAdversarialRole('constructor'),
]
export { toAdversarialRole }
