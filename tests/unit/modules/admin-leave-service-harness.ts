import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { RobinClient } from '../../../src/clients/robin/client.js'

export function setupAdminLeaveTestEnvironment() {
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

  const providers = {
    domainStore,
    objectStorage,
    identityProvider,
    robinClient: defaultRobinClient,
  }

  // Setup students
  domainStore.profiles.set('student-1', {
    user_id: 'student-1',
    full_name: 'Budi Santoso',
    nis: '1001',
    class_name: 'XII RPL 1',
    absence_number: '05',
    role: 'student',
    lifecycle_status: 'approved',
  })

  domainStore.profiles.set('student-2', {
    user_id: 'student-2',
    full_name: 'Siti Aminah',
    nis: '1002',
    class_name: 'XII TKJ 2',
    absence_number: '12',
    role: 'student',
    lifecycle_status: 'approved',
  })

  // Setup staff/admin users
  domainStore.profiles.set('admin-1', {
    user_id: 'admin-1',
    full_name: 'Kepala Sekolah',
    role: 'school_admin',
    lifecycle_status: 'approved',
  })

  domainStore.profiles.set('teacher-1', {
    user_id: 'teacher-1',
    full_name: 'Wali Kelas XII RPL 1',
    role: 'teacher',
    lifecycle_status: 'approved',
  })

  domainStore.profiles.set('staff-1', {
    user_id: 'staff-1',
    full_name: 'Tata Usaha',
    role: 'staff',
    lifecycle_status: 'approved',
  })

  return { domainStore, objectStorage, identityProvider, providers }
}
