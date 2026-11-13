import type { JWTPayload } from 'jose'
import { createApp } from '../../../src/app.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { IdentityProvider } from '../../../src/providers/types.js'

export function tokenFor(payload: JWTPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${encodedPayload}.signature`
}

const mockRobinClient = {
  enroll: async () => ({
    success: true,
    data: {
      user_id: 'test',
      status: 'success' as const,
      version: '1',
      created_at: new Date().toISOString(),
      sample_count: 10,
    },
  }),
  verify: async () => ({
    match: true,
    confidence: 0.99,
    threshold: 0.7,
    qualityScore: 0.95,
    processTimeMs: 120,
  }),
  deleteEnrollment: async () => {},
}

export function createTestApp(
  domainStore = new MemoryDomainStore(),
  identityProvider: IdentityProvider = new MemoryIdentityProvider(),
) {
  domainStore.profiles.set('platform-admin-1', {
    user_id: 'platform-admin-1',
    full_name: 'Platform Admin',
    email: 'platform@school.sch.id',
    role: 'platform_admin',
    lifecycle_status: 'approved',
    gender: null,
  })

  domainStore.profiles.set('school-admin-1', {
    user_id: 'school-admin-1',
    full_name: 'School Admin',
    email: 'admin@school.sch.id',
    role: 'school_admin',
    lifecycle_status: 'approved',
    gender: null,
  })

  domainStore.profiles.set('teacher-1', {
    user_id: 'teacher-1',
    full_name: 'Teacher One',
    email: 'teacher@school.sch.id',
    role: 'teacher',
    lifecycle_status: 'approved',
    gender: null,
  })

  domainStore.profiles.set('student-1', {
    user_id: 'student-1',
    full_name: 'Student One',
    email: 'student@school.sch.id',
    role: 'student',
    lifecycle_status: 'approved',
    gender: null,
  })

  return createApp({
    providers: {
      domainStore,
      objectStorage: new MemoryObjectStorage(),
      identityProvider,
      robinClient: mockRobinClient,
    },
  })
}

export const platformAdminToken = tokenFor({
  sub: 'platform-admin-1',
  roles: ['platform_admin'],
  scope: 'openid profile admin:read',
  must_change_password: false,
  mfa_verified: true,
})

export const schoolAdminToken = tokenFor({
  sub: 'school-admin-1',
  roles: ['school_admin'],
  scope: 'openid profile admin:read',
  must_change_password: false,
  mfa_verified: true,
})

export const teacherToken = tokenFor({
  sub: 'teacher-1',
  roles: ['teacher'],
  scope: 'openid profile admin:read',
  must_change_password: false,
  mfa_verified: true,
})

export const studentToken = tokenFor({
  sub: 'student-1',
  roles: ['student'],
  scope: 'openid profile',
  must_change_password: false,
  mfa_verified: true,
})

export const validBackupBody = {
  year_month: '2026-04',
  scope: 'absences',
  format: 'xlsx',
  start_date: '2026-04-01',
  end_date: '2026-04-30',
  checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  record_count: 120,
  byte_length: 8192,
  result: 'completed',
}
