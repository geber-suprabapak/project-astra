import type { JWTPayload } from 'jose'
import { createApp } from '../../../src/app.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { Schedule } from '../../../src/providers/types.js'

export const schoolId = '11111111-1111-1111-1111-111111111111'
export const otherSchoolId = '22222222-2222-2222-2222-222222222222'
export const periodId = 'b0000000-0000-0000-0000-000000000001'
export const oldPeriodId = 'b0000000-0000-0000-0000-000000000002'
export const classId = 'c0000000-0000-0000-0000-000000000001'
export const oldClassId = 'c0000000-0000-0000-0000-000000000002'
export const otherSchoolClassId = 'c0000000-0000-0000-0000-000000000003'
export const siteId = 'd0000000-0000-0000-0000-000000000001'
export const foreignSiteId = 'd0000000-0000-0000-0000-000000000002'
export const reportDate = '2026-09-29'
export const reportAt = '2026-09-29T03:00:00.000Z'

function tokenFor(payload: JWTPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${encodedPayload}.signature`
}

export const adminToken = tokenFor({
  sub: 'report-admin',
  scope: 'openid profile mobile:access admin:read files:read:any',
})
export const adminNoPhotosToken = tokenFor({
  sub: 'report-admin',
  scope: 'openid profile mobile:access admin:read',
})
export const noAdminScopeToken = tokenFor({
  sub: 'report-admin',
  scope: 'openid profile mobile:access files:read:any',
})
export const studentAdminScopeToken = tokenFor({
  sub: 'report-student',
  scope: 'openid profile mobile:access admin:read files:read:any',
})
export const pendingAdminToken = tokenFor({
  sub: 'report-pending-admin',
  scope: 'openid profile mobile:access admin:read files:read:any',
})

export function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 'report-schedule',
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
      name: 'Periode aktif',
      start_date: '2026-07-01',
      end_date: '2026-12-31',
      is_active: true,
    },
  ]
  domainStore.classes = [
    { id: classId, school_id: schoolId, academic_period_id: periodId, name: 'XII RPL 1' },
    { id: oldClassId, school_id: schoolId, academic_period_id: oldPeriodId, name: 'XI RPL 1' },
    {
      id: otherSchoolClassId,
      school_id: otherSchoolId,
      academic_period_id: periodId,
      name: 'XII RPL 1',
    },
  ]
  for (const [userId, role, lifecycle_status, full_name] of [
    ['report-admin', 'school_admin', 'approved', 'Admin Sekolah'],
    ['report-student', 'student', 'approved', 'Siswa Satu'],
    ['report-student-2', 'student', 'approved', 'Siswa Dua'],
    ['report-student-3', 'student', 'approved', 'Siswa Tiga'],
    ['report-pending-admin', 'school_admin', 'pending', 'Admin Pending'],
  ] as const) {
    domainStore.profiles.set(userId, { user_id: userId, role, lifecycle_status, full_name })
  }
  domainStore.adiwiyataSites.set(siteId, {
    id: siteId,
    school_id: schoolId,
    name: 'Kebun Umum',
    category: 'tanaman',
    class_id: null,
    is_active: true,
    sort_order: 0,
    created_by: 'report-admin',
  })
  domainStore.adiwiyataSites.set(foreignSiteId, {
    id: foreignSiteId,
    school_id: otherSchoolId,
    name: 'Kebun Sekolah Lain',
    category: 'tanaman',
    class_id: null,
    is_active: true,
    sort_order: 0,
    created_by: 'report-admin',
  })
  domainStore.schedules.clear()
  domainStore.schedules.set('report-schedule', makeSchedule())
  domainStore.classEnrollments = ['report-student', 'report-student-2', 'report-student-3'].map(
    (user_id, index) => ({
      id: `report-enrollment-${index}`,
      student_id: `report-student-record-${index}`,
      user_id,
      class_id: classId,
      academic_period_id: periodId,
      status: 'active',
    }),
  )
  for (const [index, user_id] of [
    'report-student',
    'report-student-2',
    'report-student-3',
  ].entries()) {
    const student_id = `report-student-record-${index}`
    domainStore.students.set(student_id, {
      id: student_id,
      nis: `900${index}`,
      full_name: domainStore.profiles.get(user_id)!.full_name!,
      gender: null,
    })
    domainStore.studentBindings.set(student_id, { student_id, user_id })
    domainStore.adiwiyataEligibility.set(user_id, {
      id: `report-eligibility-${index}`,
      user_id,
      added_by: 'report-admin',
      is_active: true,
    })
  }

  const providers = {
    domainStore,
    objectStorage: new MemoryObjectStorage(),
    identityProvider: new MemoryIdentityProvider(),
    robinClient: {
      checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
      getEnrollmentStatus: async () => ({
        status: 'enrolled' as const,
        embeddingCount: 1,
        message: 'Ready.',
      }),
      enroll: async () => ({ imagesProcessed: 1, imagesFailed: 0, totalEmbeddings: 1 }),
      identify: async () => ({
        status: 'ok' as const,
        confidence: 0.9,
        qualityScore: 0.9,
        processTimeMs: 1,
      }),
      deleteEnrollment: async () => {},
    },
  }
  return { app: createApp({ providers }), domainStore }
}

export function seedReport(
  domainStore: MemoryDomainStore,
  params: {
    id: string
    userId: string
    date?: string
    classId?: string
    siteId?: string
    verifiedAt?: string | null
    verifiedBy?: string | null
    fileCreatedAt?: string
  },
) {
  const fileId = `f${params.id.slice(1)}`
  const fileCreatedAt = params.fileCreatedAt ?? reportAt
  domainStore.files.set(fileId, {
    id: fileId,
    user_id: params.userId,
    purpose: 'adiwiyata_report',
    object_path: `reports/${params.id}.jpg`,
    content_type: 'image/jpeg',
    size_bytes: 512,
    lifecycle: 'available',
    created_at: fileCreatedAt,
    updated_at: fileCreatedAt,
  })
  domainStore.adiwiyataReports.set(params.id, {
    id: params.id,
    site_id: params.siteId ?? siteId,
    class_id: params.classId ?? classId,
    reported_by: params.userId,
    file_id: fileId,
    report_date: params.date ?? reportDate,
    created_at: reportAt,
    verified_at: params.verifiedAt ?? null,
    verified_by: params.verifiedBy ?? null,
  })
  return { fileId }
}

export async function request(
  app: ReturnType<typeof createApp>,
  path: string,
  token?: string,
  method = 'GET',
) {
  return app.request(path, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}
