import type { JWTPayload } from 'jose'
import { createApp } from '../../../src/app.js'
import type { RobinClient } from '../../../src/clients/robin/client.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'

export function tokenFor(payload: JWTPayload): string {
  const fullPayload = {
    scope: 'openid profile',
    ...payload,
  }
  const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url')
  return `header.${encodedPayload}.signature`
}

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
  await domainStore.createSchool({
    name: 'SMK Negeri 2 Banjarmasin',
    slug: 'smkn2-bjm',
  })

  // Student 1 (Approved)
  domainStore.profiles.set('student-1', {
    user_id: 'student-1',
    full_name: 'Budi Santoso',
    email: 'student1@school.sch.id',
    nis: '1001',
    class_name: 'XII RPL 1',
    absence_number: '05',
    role: 'student',
    lifecycle_status: 'approved',
    gender: 'L',
  })
  identityProvider.users.set('student-1', {
    userId: 'student-1',
    email: 'student1@school.sch.id',
    roles: ['student'],
    scopes: ['openid', 'profile', 'leave:submit', 'leave:read'],
  })

  // Student Pending
  domainStore.profiles.set('student-pending', {
    user_id: 'student-pending',
    full_name: 'Pending Student',
    email: 'pending@school.sch.id',
    nis: '1003',
    class_name: 'XII RPL 1',
    role: 'student',
    lifecycle_status: 'pending',
    gender: 'L',
  })
  identityProvider.users.set('student-pending', {
    userId: 'student-pending',
    email: 'pending@school.sch.id',
    roles: ['student'],
    scopes: ['openid', 'profile'],
  })

  // School Admin
  domainStore.profiles.set('admin-1', {
    user_id: 'admin-1',
    full_name: 'Admin Sekolah',
    email: 'admin@school.sch.id',
    role: 'school_admin',
    lifecycle_status: 'approved',
  })
  identityProvider.users.set('admin-1', {
    userId: 'admin-1',
    email: 'admin@school.sch.id',
    roles: ['school_admin'],
    scopes: ['openid', 'profile', 'admin:read', 'admin:write', 'leave:read', 'leave:approve'],
    mfaVerified: true,
    mustChangePassword: false,
  })

  // Platform Admin
  domainStore.profiles.set('platform-admin-1', {
    user_id: 'platform-admin-1',
    full_name: 'Platform Admin',
    email: 'superadmin@platform.sch.id',
    role: 'platform_admin',
    lifecycle_status: 'approved',
  })
  identityProvider.users.set('platform-admin-1', {
    userId: 'platform-admin-1',
    email: 'superadmin@platform.sch.id',
    roles: ['platform_admin'],
    scopes: ['openid', 'profile', 'admin:read', 'admin:write', 'leave:read', 'leave:approve'],
    mfaVerified: true,
    mustChangePassword: false,
  })

  // Teacher
  domainStore.profiles.set('teacher-1', {
    user_id: 'teacher-1',
    full_name: 'Guru Wali Kelas',
    email: 'teacher@school.sch.id',
    role: 'teacher',
    lifecycle_status: 'approved',
  })
  identityProvider.users.set('teacher-1', {
    userId: 'teacher-1',
    email: 'teacher@school.sch.id',
    roles: ['teacher'],
    scopes: ['openid', 'profile', 'admin:read', 'admin:write', 'leave:read', 'leave:approve'],
    mfaVerified: true,
    mustChangePassword: false,
  })

  // Staff (authorized when the access token includes admin:read)
  domainStore.profiles.set('staff-1', {
    user_id: 'staff-1',
    full_name: 'Staff Tata Usaha',
    email: 'staff@school.sch.id',
    role: 'staff',
    lifecycle_status: 'approved',
  })
  identityProvider.users.set('staff-1', {
    userId: 'staff-1',
    email: 'staff@school.sch.id',
    roles: ['staff'],
    scopes: ['openid', 'profile', 'admin:read'],
    mfaVerified: true,
    mustChangePassword: false,
  })
}
