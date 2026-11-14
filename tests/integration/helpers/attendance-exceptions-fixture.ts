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
    .setSubject(claims.sub ?? 'user-1')
    .setIssuedAt()
    .setExpirationTime(expirationTime)
    .sign(new TextEncoder().encode(OIDC_SECRET))
}

export function createIntegrationEnvironment(customRobinClient?: Partial<RobinClient>) {
  const domainStore = new MemoryDomainStore()
  const objectStorage = new MemoryObjectStorage()
  const identityProvider = new MemoryIdentityProvider()

  const defaultRobinClient: RobinClient = {
    checkReadiness: async () => ({ healthy: true }),
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

  // SAFETY: test environment merges defaultRobinClient and partial override to form valid RobinClient
  const robinClient = { ...defaultRobinClient, ...customRobinClient } as RobinClient

  const providers = {
    domainStore,
    objectStorage,
    identityProvider,
    robinClient,
  }

  const app = createApp({ providers })

  return { domainStore, identityProvider, objectStorage, robinClient, providers, app }
}

export async function setupSchoolAndStudent(
  domainStore: MemoryDomainStore,
  identityProvider: MemoryIdentityProvider,
  studentId = 'student-1',
) {
  // 1. School
  await domainStore.createSchool({
    name: 'SMK Negeri 2 Banjarmasin',
    slug: 'smkn2-bjm',
  })

  // 2. Academic Period
  const period = await domainStore.createAcademicPeriod({
    name: '2026/2027 Ganjil',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    isActive: true,
  })

  // 3. Class
  const classRoom = await domainStore.createClass({
    name: 'XII RPL 1',
    academicPeriodId: period.id,
    grade: 12,
  })

  // 4. Student profile & identity
  domainStore.profiles.set(studentId, {
    user_id: studentId,
    full_name: 'Ahmad Dahlan',
    email: `${studentId}@school.sch.id`,
    nis: '1001',
    class_name: 'XII RPL 1',
    role: 'student',
    lifecycle_status: 'approved',
    gender: 'L',
  })
  identityProvider.users.set(studentId, {
    userId: studentId,
    email: `${studentId}@school.sch.id`,
    roles: ['student'],
    scopes: ['openid', 'profile', 'attendance:write'],
  })

  // 5. Class Enrollment
  await domainStore.enrollStudentInClass({
    userId: studentId,
    classId: classRoom.id,
    academicPeriodId: period.id,
  })

  // 6. Geofence Location
  await domainStore.createLocation({
    name: 'Campus Ground',
    latitude: -6.2,
    longitude: 106.816666,
    radiusMeters: 5000,
    isActive: true,
  })

  // 7. Schedule
  const days = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu']
  for (const d of days) {
    await domainStore.createSchedule({
      dayOfWeek: d,
      startTime: '00:00:00',
      endTime: '23:59:59',
      startCheckout: '00:00:00',
      endCheckout: '23:59:59',
      gracePeriodMinutes: 30,
      isActive: true,
      classId: classRoom.id,
      academicPeriodId: period.id,
    })
  }

  // 8. Face Enrollment
  await domainStore.saveFaceEnrollment({
    userId: studentId,
    status: 'enrolled',
    sampleCount: 10,
  })

  // Pre-seed School Admin
  domainStore.profiles.set('school-admin-1', {
    user_id: 'school-admin-1',
    full_name: 'School Admin 1',
    email: 'admin@school.sch.id',
    role: 'school_admin',
    lifecycle_status: 'approved',
  })
  identityProvider.users.set('school-admin-1', {
    userId: 'school-admin-1',
    email: 'admin@school.sch.id',
    roles: ['school_admin'],
    scopes: ['openid', 'profile', 'admin:read', 'admin:write'],
    mfaVerified: true,
    mustChangePassword: false,
  })

  return { period, classRoom }
}
