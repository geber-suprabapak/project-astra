import sharp from 'sharp'
import { createApp } from '../../../src/app.js'
import type { RobinClient } from '../../../src/clients/robin/client.js'
import { createAdiwiyataRouter } from '../../../src/modules/adiwiyata/routes.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { AcademicPeriod, Schedule } from '../../../src/providers/types.js'

export const userId = 'user-adiwiyata-student'
export const schoolId = '11111111-1111-1111-1111-111111111111'
export const periodId = 'b0000000-0000-0000-0000-000000000001'
export const classId = 'c0000000-0000-0000-0000-000000000001'
export const otherClassId = 'c0000000-0000-0000-0000-000000000002'
export const fixtureUuidSiteId = 'c2000000-0000-0000-0000-000000000020'
export const wibTuesday = new Date('2026-09-28T17:30:00.000Z')

const mockRobinClient: RobinClient = {
  checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
  getEnrollmentStatus: async () => ({ status: 'enrolled', embeddingCount: 1, message: 'Ready.' }),
  enroll: async () => ({ imagesProcessed: 1, imagesFailed: 0, totalEmbeddings: 1 }),
  identify: async () => ({ status: 'ok', confidence: 0.9, qualityScore: 0.9, processTimeMs: 1 }),
  deleteEnrollment: async () => {},
}

export function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: crypto.randomUUID(),
    school_id: schoolId,
    class_id: classId,
    academic_period_id: periodId,
    day_of_week: 'selasa',
    hari: 'selasa',
    mulai_masuk: '06:00:00',
    selesai_masuk: '07:00:00',
    mulai_pulang: '12:00:00',
    selesai_pulang: '14:00:00',
    kompensasi_waktu: 0,
    is_active: true,
    ...overrides,
  }
}

export function createEnvironment() {
  const domainStore = new MemoryDomainStore()
  domainStore.academicPeriods = [
    {
      id: periodId,
      school_id: schoolId,
      name: 'Tahun Ajaran 2026/2027 Ganjil',
      start_date: '2026-07-01',
      end_date: '2026-12-31',
      is_active: true,
    },
  ]
  domainStore.classes = [
    { id: classId, school_id: schoolId, academic_period_id: periodId, name: 'XII RPL 1' },
    { id: otherClassId, school_id: schoolId, academic_period_id: periodId, name: 'XII RPL 2' },
  ]
  domainStore.profiles.set(userId, {
    user_id: userId,
    full_name: 'Siswa Contoh',
    role: 'student',
    lifecycle_status: 'approved',
  })
  domainStore.classEnrollments = [
    {
      id: 'enrollment-1',
      user_id: userId,
      class_id: classId,
      academic_period_id: periodId,
      status: 'active',
    },
  ]
  domainStore.adiwiyataEligibility.set(userId, {
    id: 'eligibility-1',
    user_id: userId,
    added_by: 'admin-1',
    is_active: true,
  })
  domainStore.schedules.clear()
  domainStore.schedules.set('schedule-1', makeSchedule())
  domainStore.adiwiyataSites.set('site-general', {
    id: 'site-general',
    school_id: schoolId,
    name: 'Kolam Lele Galon',
    category: 'lele',
    class_id: null,
    is_active: true,
    sort_order: 1,
    created_by: null,
  })
  domainStore.adiwiyataSites.set('site-own-class', {
    id: 'site-own-class',
    school_id: schoolId,
    name: 'Kebun XII RPL 1',
    category: 'tanaman',
    class_id: classId,
    is_active: true,
    sort_order: 2,
    created_by: null,
  })
  domainStore.adiwiyataSites.set('site-other-class', {
    id: 'site-other-class',
    school_id: schoolId,
    name: 'Kebun XII RPL 2',
    category: 'tanaman',
    class_id: otherClassId,
    is_active: true,
    sort_order: 3,
    created_by: null,
  })
  domainStore.adiwiyataSites.set('site-inactive', {
    id: 'site-inactive',
    school_id: schoolId,
    name: 'Site Nonaktif',
    category: 'tanaman',
    class_id: classId,
    is_active: false,
    sort_order: 4,
    created_by: null,
  })
  domainStore.adiwiyataSites.set(fixtureUuidSiteId, {
    id: fixtureUuidSiteId,
    school_id: schoolId,
    name: 'Kebun UUID',
    category: 'tanaman',
    class_id: null,
    is_active: true,
    sort_order: 5,
    created_by: null,
  })

  const identityProvider = new MemoryIdentityProvider()
  const objectStorage = new MemoryObjectStorage()
  const providers = {
    domainStore,
    identityProvider,
    objectStorage,
    robinClient: mockRobinClient,
  }
  const app = createApp({
    providers,
    adiwiyataRouter: createAdiwiyataRouter({ providers, now: () => wibTuesday }),
  })
  return { app, domainStore, objectStorage }
}

export function period(overrides: Partial<AcademicPeriod> = {}): AcademicPeriod {
  return {
    id: crypto.randomUUID(),
    school_id: schoolId,
    name: 'Periode duplikat',
    start_date: '2026-07-01',
    end_date: '2026-12-31',
    is_active: true,
    ...overrides,
  }
}

export async function dashboard(app: ReturnType<typeof createApp>) {
  return app.request('/v1/adiwiyata/dashboard', {
    headers: { Authorization: `Bearer ${userId}` },
  })
}

export async function reportImage(): Promise<Buffer> {
  return sharp({
    create: { width: 1, height: 1, channels: 3, background: '#29415d' },
  })
    .png()
    .toBuffer()
}

export async function submitReport(
  app: ReturnType<typeof createApp>,
  options: { userId?: string; siteId?: string; extraField?: string } = {},
) {
  const form = new FormData()
  form.append('site_id', options.siteId ?? fixtureUuidSiteId)
  form.append('image', new File([await reportImage()], 'garden.png', { type: 'image/png' }))
  if (options.extraField !== undefined) form.append('caption', options.extraField)
  return app.request('/v1/adiwiyata/reports', {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.userId ?? userId}` },
    body: form,
  })
}
