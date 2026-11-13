import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { AppProviders } from '../../../src/providers/types.js'

export function createFilesTestProviders(): AppProviders {
  const domainStore = new MemoryDomainStore()
  const objectStorage = new MemoryObjectStorage()
  const identityProvider = new MemoryIdentityProvider()

  domainStore.profiles.set('student-1', {
    user_id: 'student-1',
    full_name: 'Student One',
    email: 'student1@school.sch.id',
    role: 'student',
    lifecycle_status: 'approved',
  })

  domainStore.profiles.set('student-pending', {
    user_id: 'student-pending',
    full_name: 'Pending Student',
    email: 'pending@school.sch.id',
    role: 'student',
    lifecycle_status: 'pending',
  })

  domainStore.profiles.set('staff-1', {
    user_id: 'staff-1',
    full_name: 'Staff Member',
    email: 'staff@school.sch.id',
    role: 'staff',
    lifecycle_status: 'approved',
  })

  return {
    domainStore,
    objectStorage,
    identityProvider,
    robinClient: {
      checkReadiness: async () => ({ healthy: true }),
      getEnrollmentStatus: async () => ({ status: 'not_enrolled', embeddingCount: 0 }),
      enroll: async () => ({ totalEmbeddings: 10 }),
      identify: async () => ({ processTimeMs: 10 }),
      deleteEnrollment: async () => {},
    },
  }
}
