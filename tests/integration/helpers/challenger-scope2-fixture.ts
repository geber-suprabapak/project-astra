import { createApp } from '../../../src/app.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { RobinClient } from '../../../src/clients/robin/client.js'

export function createTestEnv() {
  const domainStore = new MemoryDomainStore()
  const objectStorage = new MemoryObjectStorage()
  const identityProvider = new MemoryIdentityProvider()

  const robinClient: RobinClient = {
    checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
    getEnrollmentStatus: async () => ({
      status: 'enrolled',
      embeddingCount: 10,
      message: 'Ready.',
    }),
    enroll: async () => ({ imagesProcessed: 10, imagesFailed: 0, totalEmbeddings: 10 }),
    identify: async () => ({
      status: 'ok',
      confidence: 0.94,
      qualityScore: 0.91,
      processTimeMs: 38,
      message: 'Face verified successfully',
    }),
    deleteEnrollment: async () => {},
  }

  const providers = {
    domainStore,
    objectStorage,
    identityProvider,
    robinClient,
  }

  const app = createApp({ providers })

  return { domainStore, identityProvider, objectStorage, robinClient, providers, app }
}

export async function setupUsers(
  domainStore: MemoryDomainStore,
  identityProvider: MemoryIdentityProvider,
) {
  domainStore.profiles.set('student-1', {
    user_id: 'student-1',
    full_name: 'Approved Student',
    email: 'student1@school.sch.id',
    role: 'student',
    lifecycle_status: 'approved',
  })
  identityProvider.users.set('student-1', {
    userId: 'student-1',
    email: 'student1@school.sch.id',
    roles: ['student'],
    scopes: ['openid', 'profile', 'mobile:access'],
  })

  domainStore.profiles.set('student-pending', {
    user_id: 'student-pending',
    full_name: 'Pending Student',
    email: 'pending@school.sch.id',
    role: 'student',
    lifecycle_status: 'pending',
  })
  identityProvider.users.set('student-pending', {
    userId: 'student-pending',
    email: 'pending@school.sch.id',
    roles: ['student'],
    scopes: ['openid', 'profile', 'mobile:access'],
  })

  domainStore.profiles.set('student-rejected', {
    user_id: 'student-rejected',
    full_name: 'Rejected Student',
    email: 'rejected@school.sch.id',
    role: 'student',
    lifecycle_status: 'rejected',
  })
  identityProvider.users.set('student-rejected', {
    userId: 'student-rejected',
    email: 'rejected@school.sch.id',
    roles: ['student'],
    scopes: ['openid', 'profile', 'mobile:access'],
  })

  domainStore.profiles.set('teacher-1', {
    user_id: 'teacher-1',
    full_name: 'Guru',
    email: 'teacher@school.sch.id',
    role: 'teacher',
    lifecycle_status: 'approved',
  })
  identityProvider.users.set('teacher-1', {
    userId: 'teacher-1',
    email: 'teacher@school.sch.id',
    roles: ['teacher'],
    scopes: ['openid', 'profile', 'mobile:access', 'admin:read'],
  })

  domainStore.profiles.set('admin-1', {
    user_id: 'admin-1',
    full_name: 'Admin',
    email: 'admin@school.sch.id',
    role: 'school_admin',
    lifecycle_status: 'approved',
  })
  identityProvider.users.set('admin-1', {
    userId: 'admin-1',
    email: 'admin@school.sch.id',
    roles: ['school_admin'],
    scopes: [
      'openid',
      'profile',
      'mobile:access',
      'admin:read',
      'files:read:any',
      'files:delete:any',
    ],
    mfaVerified: true,
    mustChangePassword: false,
  })
}
