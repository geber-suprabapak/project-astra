import type { JWTPayload } from 'jose'
import { createApp } from '../../../src/app.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { RobinClient } from '../../../src/clients/robin/client.js'
import type { AttendanceRecord } from '../../../src/providers/types.js'

const dummyRobinClient: RobinClient = {
  checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
  getEnrollmentStatus: async () => ({
    status: 'not_enrolled',
    embeddingCount: 0,
    message: 'No enrollment found.',
  }),
  enroll: async () => ({
    status: 'ok',
    userId: 'admin-user-1',
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

export function tokenFor(payload: JWTPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${encodedPayload}.signature`
}

export const adminToken = tokenFor({
  sub: 'admin-user-1',
  scope: 'openid profile admin:read',
})

export const baseHeaders = {
  'X-Astra-Contract-Version': 'v1',
}

export const adminHeaders = {
  Authorization: `Bearer ${adminToken}`,
  'X-Astra-Contract-Version': 'v1',
}

export function createAttendances(count: number, baseDate = '2026-09-04'): AttendanceRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `attendance-${index.toString().padStart(5, '0')}`,
    user_id: `student-${index % 10}`,
    date: baseDate,
    status: 'Hadir',
    action_type: 'check_in',
    latitude: null,
    longitude: null,
    created_at: new Date(Date.UTC(2026, 8, 4, 0, 0, index)).toISOString(),
  }))
}

export function createTestApp(store?: MemoryDomainStore) {
  const domainStore = store ?? new MemoryDomainStore()
  domainStore.profiles.set('admin-user-1', {
    user_id: 'admin-user-1',
    full_name: 'School Admin',
    email: 'admin@school.sch.id',
    role: 'school_admin',
    lifecycle_status: 'approved',
    gender: null,
  })

  return {
    app: createApp({
      providers: {
        domainStore,
        objectStorage: new MemoryObjectStorage(),
        identityProvider: new MemoryIdentityProvider(),
        robinClient: dummyRobinClient,
      },
    }),
    domainStore,
  }
}
