import type { JWTPayload } from 'jose'
import { createApp } from '../../../src/app.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { RobinClient } from '../../../src/clients/robin/client.js'

export function tokenFor(payload: JWTPayload): string {
  const fullPayload = {
    scope: 'openid profile',
    roles: ['student'],
    ...payload,
  }
  const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url')
  return `header.${encodedPayload}.signature`
}

export function createIntegrationEnvironment() {
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

export async function setupTestScenario(
  domainStore: MemoryDomainStore,
  identityProvider: MemoryIdentityProvider,
) {
  // 1. School
  await domainStore.createSchool({
    name: 'SMK Negeri 2 Banjarmasin',
    slug: 'smkn2-bjm',
  })

  // 2. Academic Period & Classes
  const period = await domainStore.createAcademicPeriod({
    name: '2026/2027 Ganjil',
    startDate: '2026-07-01',
    endDate: '2026-12-31',
    isActive: true,
  })

  const classRpl1 = await domainStore.createClass({
    name: 'XII RPL 1',
    grade: 12,
    academicPeriodId: period.id,
  })

  // 3. Approved Student 1
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
    avatar_url: 'avatars/student-1.jpg',
  })
  identityProvider.users.set('student-1', {
    userId: 'student-1',
    email: 'student1@school.sch.id',
    roles: ['student'],
    scopes: ['openid', 'profile'],
  })
  await domainStore.enrollStudentInClass({
    userId: 'student-1',
    classId: classRpl1.id,
    academicPeriodId: period.id,
  })

  // 4. Approved Student 2
  domainStore.profiles.set('student-2', {
    user_id: 'student-2',
    full_name: 'Siti Aminah',
    email: 'student2@school.sch.id',
    nis: '1002',
    class_name: 'XII RPL 1',
    absence_number: '12',
    role: 'student',
    lifecycle_status: 'approved',
    gender: 'P',
  })
  identityProvider.users.set('student-2', {
    userId: 'student-2',
    email: 'student2@school.sch.id',
    roles: ['student'],
    scopes: ['openid', 'profile'],
  })
  await domainStore.enrollStudentInClass({
    userId: 'student-2',
    classId: classRpl1.id,
    academicPeriodId: period.id,
  })

  // 5. Pending Student
  domainStore.profiles.set('student-pending', {
    user_id: 'student-pending',
    full_name: 'Calon Siswa',
    email: 'calon@school.sch.id',
    nis: '1003',
    role: 'student',
    lifecycle_status: 'pending',
  })
  identityProvider.users.set('student-pending', {
    userId: 'student-pending',
    email: 'calon@school.sch.id',
    roles: ['student'],
  })

  // 6. Disabled Student
  domainStore.profiles.set('student-disabled', {
    user_id: 'student-disabled',
    full_name: 'Siswa Nonaktif',
    email: 'nonaktif@school.sch.id',
    nis: '1004',
    role: 'student',
    lifecycle_status: 'disabled',
  })
  identityProvider.users.set('student-disabled', {
    userId: 'student-disabled',
    email: 'nonaktif@school.sch.id',
    roles: ['student'],
  })

  // 7. Seed attendances
  domainStore.attendancesList.push(
    {
      id: 'att-s1-1',
      user_id: 'student-1',
      date: '2026-08-10',
      status: 'Hadir',
      action_type: 'check_in',
      latitude: -7.1234,
      longitude: 112.1234,
      created_at: '2026-08-10T07:05:00.000Z',
    },
    {
      id: 'att-s1-2',
      user_id: 'student-1',
      date: '2026-08-10',
      status: 'Pulang',
      action_type: 'check_out',
      latitude: -7.1234,
      longitude: 112.1234,
      created_at: '2026-08-10T15:00:00.000Z',
    },
    {
      id: 'att-s1-3',
      user_id: 'student-1',
      date: '2026-08-11',
      status: 'Terlambat',
      action_type: 'check_in',
      latitude: -7.1234,
      longitude: 112.1234,
      created_at: '2026-08-11T07:20:00.000Z',
    },
    {
      id: 'att-s2-1',
      user_id: 'student-2',
      date: '2026-08-10',
      status: 'Hadir',
      action_type: 'check_in',
      latitude: -7.1234,
      longitude: 112.1234,
      created_at: '2026-08-10T06:55:00.000Z',
    },
  )

  // 8. Seed leave requests
  domainStore.permits.push(
    {
      id: 'leave-s1-1',
      user_id: 'student-1',
      kategori_izin: 'sakit',
      deskripsi: 'Sakit tifus rawat inap',
      status: true,
      link_foto: 'permits/surat-inap.jpg',
      tanggal: '2026-08-15T00:00:00+07:00',
      approval_status: 'approved',
      created_at: '2026-08-15T06:00:00.000Z',
      rejection_reason: null,
      rejected_at: null,
    },
    {
      id: 'leave-s2-1',
      user_id: 'student-2',
      kategori_izin: 'pergi',
      deskripsi: 'Lomba olimpiade sains',
      status: true,
      link_foto: null,
      tanggal: '2026-08-16T00:00:00+07:00',
      approval_status: 'approved',
      created_at: '2026-08-16T06:00:00.000Z',
      rejection_reason: null,
      rejected_at: null,
    },
  )

  // 9. Calendar holiday
  await domainStore.createCalendarException({
    date: '2026-08-17',
    reason: 'Hari Kemerdekaan RI',
    isHoliday: true,
    academicPeriodId: period.id,
  })

  return { period, classRpl1 }
}
