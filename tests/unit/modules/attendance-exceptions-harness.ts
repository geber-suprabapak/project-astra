import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { RobinClient } from '../../../src/clients/robin/client.js'
import type { AppProviders } from '../../../src/providers/types.js'

export function createTestEnvironment(customRobinClient?: Partial<RobinClient>) {
  const domainStore = new MemoryDomainStore()
  const identityProvider = new MemoryIdentityProvider()
  const objectStorage = new MemoryObjectStorage()

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
      confidence: 0.95,
      qualityScore: 0.92,
      processTimeMs: 45,
      message: 'Face verified successfully',
    }),
    deleteEnrollment: async () => {},
  }

  // SAFETY: test environment merges defaultRobinClient and partial override to form valid RobinClient
  const robinClient = { ...defaultRobinClient, ...customRobinClient } as RobinClient

  const providers: AppProviders = {
    domainStore,
    identityProvider,
    objectStorage,
    robinClient,
  }

  return { domainStore, identityProvider, objectStorage, robinClient, providers }
}

export async function setupStudentAttendance(
  domainStore: MemoryDomainStore,
  studentId = 'student-1',
) {
  // 1. School
  await domainStore.createSchool({
    name: 'SMK Negeri 2 Banjarmasin',
    slug: 'smkn2-bjm',
  })

  // 2. Academic Period (covers current year/month)
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

  // 4. Student profile
  domainStore.profiles.set(studentId, {
    user_id: studentId,
    full_name: 'Budi Santoso',
    nis: '1001',
    class_name: 'XII RPL 1',
    role: 'student',
    lifecycle_status: 'approved',
    gender: 'L',
  })

  // 5. Class Enrollment
  await domainStore.enrollStudentInClass({
    userId: studentId,
    classId: classRoom.id,
    academicPeriodId: period.id,
  })

  // 6. Geofence location (-6.2, 106.816666 with 5000m radius)
  await domainStore.createLocation({
    name: 'Main Campus',
    latitude: -6.2,
    longitude: 106.816666,
    radiusMeters: 5000,
    isActive: true,
  })

  // 7. Schedule for all days with broad windows
  const days = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu']
  for (const day of days) {
    await domainStore.createSchedule({
      dayOfWeek: day,
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

  // 8. Face enrollment
  await domainStore.saveFaceEnrollment({
    userId: studentId,
    status: 'enrolled',
    sampleCount: 10,
  })

  return { period, classRoom }
}
