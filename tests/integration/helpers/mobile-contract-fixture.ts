import { createApp } from '../../../src/app.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { RobinClient } from '../../../src/clients/robin/client.js'
import { getDayKeyWIB } from '../../../src/modules/dashboard/service.js'

export function createMockRobinClient(): RobinClient {
  return {
    checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
    getEnrollmentStatus: async () => ({
      status: 'enrolled',
      embeddingCount: 1,
      message: 'Ready',
    }),
    enroll: async () => ({
      status: 'ok',
      userId: 'student-123',
      samplesReceived: 10,
      embeddingsCreated: 10,
      message: 'Face enrolled successfully.',
    }),
    identify: async () => ({
      status: 'ok',
      candidateId: 'student-123',
      confidence: 0.95,
      threshold: 0.7,
      qualityScore: 0.92,
      processTimeMs: 85,
    }),
    deleteEnrollment: async () => {},
  }
}

export function createMobileContractEnvironment() {
  const domainStore = new MemoryDomainStore()
  const objectStorage = new MemoryObjectStorage()
  const identityProvider = new MemoryIdentityProvider()
  const robinClient = createMockRobinClient()

  const userId = 'student-123'
  const token = 'student-123'
  const authHeader = `Bearer ${token}`

  domainStore.profiles.set(userId, {
    user_id: userId,
    full_name: 'Budi Santoso',
    email: 'budi@sekolah.sch.id',
    nis: '12345',
    class_name: 'XII RPL 1',
    absence_number: '10',
    avatar_url: 'student-123/avatar.jpg',
    role: 'student',
    lifecycle_status: 'approved',
    gender: 'L',
  })

  const dayKey = getDayKeyWIB()
  domainStore.schedules.clear()
  domainStore.schedules.set(dayKey, {
    id: `sched-${dayKey}`,
    hari: dayKey,
    day_of_week: dayKey,
    mulai_masuk: '00:00:00',
    selesai_masuk: '23:59:59',
    mulai_pulang: '00:00:00',
    selesai_pulang: '23:59:59',
    kompensasi_waktu: 30,
    is_active: true,
  })

  const activePeriod = domainStore.academicPeriods.find((p) => p.is_active)
  const activeClass = domainStore.classes[0]
  if (activePeriod && activeClass) {
    domainStore.classEnrollments.push({
      id: 'enroll-student-123',
      user_id: userId,
      class_id: activeClass.id,
      academic_period_id: activePeriod.id,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  }

  identityProvider.passwords.set('budi@sekolah.sch.id', 'current-password123')

  const app = createApp({
    providers: { domainStore, objectStorage, identityProvider, robinClient },
  })

  return {
    domainStore,
    objectStorage,
    identityProvider,
    robinClient,
    app,
    userId,
    token,
    authHeader,
  }
}
