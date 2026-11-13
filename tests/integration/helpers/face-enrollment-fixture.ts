import { vi } from 'vitest'
import { SignJWT, type JWTPayload } from 'jose'
import { createApp } from '../../../src/app.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { RobinClient } from '../../../src/clients/robin/client.js'

const OIDC_SECRET = 'test-secret-at-least-32-chars-long-12345'

export async function signedOidcToken(
  claims: JWTPayload,
  audience = 'astra-api',
  expirationTime: string | number = '5m',
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('http://logto.test/oidc')
    .setAudience(audience)
    .setSubject(claims.sub ?? 'student-1')
    .setIssuedAt()
    .setExpirationTime(expirationTime)
    .sign(new TextEncoder().encode(OIDC_SECRET))
}

export function createTestEnvironment() {
  const domainStore = new MemoryDomainStore()
  const objectStorage = new MemoryObjectStorage()
  const identityProvider = new MemoryIdentityProvider()

  let enrollmentStatus: 'enrolled' | 'not_enrolled' = 'not_enrolled'
  const mockRobinEnroll = vi.fn().mockImplementation(async () => {
    enrollmentStatus = 'enrolled'
    return {
      status: 'ok',
      userId: 'student-1',
      samplesReceived: 10,
      embeddingsCreated: 10,
      totalEmbeddings: 10,
      message: 'Face enrolled successfully.',
    }
  })

  const mockRobinDelete = vi.fn().mockImplementation(async () => {
    enrollmentStatus = 'not_enrolled'
  })

  const mockRobinClient: RobinClient = {
    checkReadiness: async () => ({ healthy: true }),
    getEnrollmentStatus: async () => ({
      status: enrollmentStatus,
      embeddingCount: enrollmentStatus === 'enrolled' ? 10 : 0,
      message: enrollmentStatus === 'enrolled' ? 'Enrolled.' : 'Not enrolled.',
    }),
    enroll: mockRobinEnroll,
    identify: async () => ({ processTimeMs: 12 }),
    deleteEnrollment: mockRobinDelete,
  }

  // Pre-seed helper
  const seedStudent = (
    id: string,
    lifecycleStatus: 'approved' | 'pending' | 'rejected' | 'disabled',
  ) => {
    domainStore.profiles.set(id, {
      user_id: id,
      full_name: `Student ${id}`,
      email: `${id}@school.sch.id`,
      nis: `NIS-${id}`,
      class_name: 'XII RPL 1',
      role: 'student',
      lifecycle_status: lifecycleStatus,
      gender: 'L',
    })
    identityProvider.users.set(id, {
      userId: id,
      email: `${id}@school.sch.id`,
      roles: ['student'],
      scopes: ['openid', 'profile'],
    })
  }

  seedStudent('student-approved', 'approved')
  seedStudent('student-pending', 'pending')
  seedStudent('student-rejected', 'rejected')
  seedStudent('student-disabled', 'disabled')
  seedStudent('student-reenroll', 'approved')
  seedStudent('student-del', 'approved')
  seedStudent('student-target', 'approved')
  seedStudent('student-files', 'approved')

  // Pre-seed school admin
  domainStore.profiles.set('school-admin-1', {
    user_id: 'school-admin-1',
    full_name: 'School Admin',
    email: 'admin@school.sch.id',
    role: 'school_admin',
    lifecycle_status: 'approved',
    gender: null,
  })
  identityProvider.users.set('school-admin-1', {
    userId: 'school-admin-1',
    email: 'admin@school.sch.id',
    roles: ['school_admin'],
    scopes: ['openid', 'profile', 'admin:read', 'student:manage'],
    mfaVerified: true,
    mustChangePassword: false,
  })

  const app = createApp({
    providers: {
      domainStore,
      objectStorage,
      identityProvider,
      robinClient: mockRobinClient,
    },
  })

  return { app, domainStore, objectStorage, mockRobinEnroll, mockRobinDelete }
}

export function createTenJpegFormData(): FormData {
  const formData = new FormData()
  for (let i = 0; i < 10; i++) {
    const file = new File([Buffer.from(`test-jpeg-sample-${i}`)], `image_${i + 1}.jpg`, {
      type: 'image/jpeg',
    })
    formData.append('files', file)
  }
  return formData
}
