import { describe, expect, it, vi } from 'vitest'
import type { JWTPayload } from 'jose'
import { createApp } from '../../src/app.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../src/providers/memory/index.js'
import type { Schedule } from '../../src/providers/types.js'

const schoolId = '11111111-1111-1111-1111-111111111111'
const otherSchoolId = '22222222-2222-2222-2222-222222222222'
const periodId = 'b0000000-0000-0000-0000-000000000001'
const oldPeriodId = 'b0000000-0000-0000-0000-000000000002'
const classId = 'c0000000-0000-0000-0000-000000000001'
const oldClassId = 'c0000000-0000-0000-0000-000000000002'
const otherSchoolClassId = 'c0000000-0000-0000-0000-000000000003'
const siteId = 'd0000000-0000-0000-0000-000000000001'
const foreignSiteId = 'd0000000-0000-0000-0000-000000000002'
const reportDate = '2026-09-29'
const reportAt = '2026-09-29T03:00:00.000Z'

function tokenFor(payload: JWTPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${encodedPayload}.signature`
}

const adminToken = tokenFor({
  sub: 'report-admin',
  scope: 'openid profile mobile:access admin:read files:read:any',
})
const adminNoPhotosToken = tokenFor({
  sub: 'report-admin',
  scope: 'openid profile mobile:access admin:read',
})
const noAdminScopeToken = tokenFor({
  sub: 'report-admin',
  scope: 'openid profile mobile:access files:read:any',
})
const studentAdminScopeToken = tokenFor({
  sub: 'report-student',
  scope: 'openid profile mobile:access admin:read files:read:any',
})
const pendingAdminToken = tokenFor({
  sub: 'report-pending-admin',
  scope: 'openid profile mobile:access admin:read files:read:any',
})

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
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

function createEnvironment() {
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

function seedReport(
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

async function request(
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

describe('Adiwiyata admin reports', () => {
  it('shows today’s expected class–Site pairs once and keeps historical dates limited to actual reports', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(reportAt))
    try {
      const { app, domainStore } = createEnvironment()
      const classSiteId = 'd0000000-0000-0000-0000-000000000003'
      domainStore.adiwiyataSites.set(classSiteId, {
        ...domainStore.adiwiyataSites.get(siteId)!,
        id: classSiteId,
        name: 'Kebun Kelas',
        class_id: classId,
      })
      const today = await request(app, `/v1/admin/adiwiyata/reports?date=${reportDate}`, adminToken)
      const initial = (await today.json()).data
      expect(initial.coverage).toEqual([
        expect.objectContaining({
          class_id: classId,
          site_id: classSiteId,
          coverage_status: 'missing',
          photo_count: 0,
        }),
        expect.objectContaining({
          class_id: classId,
          site_id: siteId,
          coverage_status: 'missing',
          photo_count: 0,
        }),
      ])
      seedReport(domainStore, {
        id: 'e0000000-0000-0000-0000-000000000008',
        userId: 'report-student',
      })
      seedReport(domainStore, {
        id: 'e0000000-0000-0000-0000-000000000009',
        userId: 'report-student-2',
        verifiedAt: reportAt,
        verifiedBy: 'report-admin',
      })
      const reported = (
        await (
          await request(
            app,
            `/v1/admin/adiwiyata/reports?date=${reportDate}&site_id=${siteId}`,
            adminToken,
          )
        ).json()
      ).data
      expect(reported.coverage).toEqual([
        expect.objectContaining({
          class_id: classId,
          site_id: siteId,
          coverage_status: 'verified',
          photo_count: 2,
        }),
      ])
      expect(reported.filter_options.sites).toHaveLength(2)
      const history = (
        await (await request(app, '/v1/admin/adiwiyata/reports?date=2026-09-28', adminToken)).json()
      ).data
      expect(history.coverage).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses scoped schedules and holidays for eligible classes, with general Sites once per class', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(reportAt))
    try {
      const { app, domainStore } = createEnvironment()
      const secondClassId = 'c0000000-0000-0000-0000-000000000004'
      domainStore.classes.push({
        id: secondClassId,
        school_id: schoolId,
        academic_period_id: periodId,
        name: 'XII RPL 2',
      })
      domainStore.schedules.set('general', makeSchedule({ id: 'general', class_id: null }))
      domainStore.schedules.set(
        'general-duplicate',
        makeSchedule({ id: 'general-duplicate', class_id: null }),
      )
      const list = async () =>
        request(app, `/v1/admin/adiwiyata/reports?date=${reportDate}`, adminToken)
      expect((await (await list()).json()).data.coverage).toEqual([
        expect.objectContaining({ class_id: classId, coverage_status: 'missing' }),
      ])
      domainStore.classEnrollments[2]!.class_id = secondClassId
      expect((await list()).status).toBe(503)
      domainStore.schedules.delete('general-duplicate')
      expect((await (await list()).json()).data.coverage).toHaveLength(2)
      domainStore.adiwiyataEligibility.get('report-student-3')!.is_active = false
      expect((await (await list()).json()).data.coverage).toHaveLength(1)
      domainStore.calendarExceptions.set('holiday', {
        id: 'holiday',
        school_id: schoolId,
        academic_period_id: periodId,
        date: reportDate,
        reason: 'Libur sekolah',
        is_holiday: true,
      })
      expect((await (await list()).json()).data.coverage).toEqual([
        expect.objectContaining({ coverage_status: 'not_scheduled', reason: 'Libur sekolah' }),
      ])
      domainStore.calendarExceptions.clear()
      domainStore.schedules.clear()
      domainStore.schedules.set('other-day', makeSchedule({ day_of_week: 'senin', hari: 'senin' }))
      domainStore.schedules.set('foreign', makeSchedule({ school_id: otherSchoolId }))
      expect((await (await list()).json()).data.coverage).toEqual([
        expect.objectContaining({ coverage_status: 'not_scheduled' }),
      ])
      domainStore.schedules.delete('other-day')
      expect((await list()).status).toBe(503)
    } finally {
      vi.useRealTimers()
    }
  })

  it('requires an approved Astra admin with admin:read; files:read:any only controls photo URLs', async () => {
    const { app } = createEnvironment()
    expect((await request(app, '/v1/admin/adiwiyata/reports')).status).toBe(401)
    expect((await request(app, '/v1/admin/adiwiyata/reports', noAdminScopeToken)).status).toBe(403)
    expect((await request(app, '/v1/admin/adiwiyata/reports', studentAdminScopeToken)).status).toBe(
      403,
    )
    expect((await request(app, '/v1/admin/adiwiyata/reports', pendingAdminToken)).status).toBe(403)

    const metadataOnly = await request(
      app,
      `/v1/admin/adiwiyata/reports?date=${reportDate}`,
      adminNoPhotosToken,
    )
    expect(metadataOnly.status).toBe(200)
    expect((await metadataOnly.json()).data.can_view_photos).toBe(false)
    const photoAccess = await request(
      app,
      `/v1/admin/adiwiyata/reports?date=${reportDate}`,
      adminToken,
    )
    expect(photoAccess.status).toBe(200)
    expect((await photoAccess.json()).data.can_view_photos).toBe(true)
  })

  it('validates strict real dates and UUID filters while accepting arbitrary UUID version bits', async () => {
    const { app } = createEnvironment()
    expect(
      (await request(app, '/v1/admin/adiwiyata/reports?date=2026-02-30', adminToken)).status,
    ).toBe(422)
    expect(
      (await request(app, '/v1/admin/adiwiyata/reports?date=2026-2-03', adminToken)).status,
    ).toBe(422)
    expect(
      (await request(app, '/v1/admin/adiwiyata/reports?class_id=nope', adminToken)).status,
    ).toBe(422)
    const zeroUuid = await request(
      app,
      '/v1/admin/adiwiyata/reports?date=2026-09-29&class_id=00000000-0000-0000-0000-000000000001',
      adminToken,
    )
    expect(zeroUuid.status).toBe(200)
  })

  it('returns submitted reports for historical same-school classes and preserves expired metadata', async () => {
    const { app, domainStore } = createEnvironment()
    const oldReportId = '00000000-0000-0000-0000-000000000001'
    const { fileId } = seedReport(domainStore, {
      id: oldReportId,
      userId: 'report-student',
      date: '2025-01-10',
      classId: oldClassId,
      fileCreatedAt: '2025-01-10T00:00:00.000Z',
    })
    seedReport(domainStore, {
      id: 'e0000000-0000-0000-0000-000000000002',
      userId: 'report-student-2',
      date: '2025-01-10',
      classId: otherSchoolClassId,
      siteId: foreignSiteId,
    })

    const response = await request(
      app,
      `/v1/admin/adiwiyata/reports?date=2025-01-10&class_id=${oldClassId}&site_id=${siteId}`,
      adminToken,
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toMatchObject({
      date: '2025-01-10',
      timezone: 'Asia/Jakarta',
      can_view_photos: true,
      reports: [
        {
          id: oldReportId,
          site_id: siteId,
          site_name: 'Kebun Umum',
          category: 'tanaman',
          class_id: oldClassId,
          class_name: 'XI RPL 1',
          reported_by: 'report-student',
          uploader_name: 'Siswa Satu',
          file_id: fileId,
          file_created_at: '2025-01-10T00:00:00.000Z',
          report_date: '2025-01-10',
          photo_url: null,
        },
      ],
    })
    expect(body.data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(body.data.reports).toHaveLength(1)
  })

  it('audits verify/unverify idempotently and reports whether any photo remains verified', async () => {
    const { app, domainStore } = createEnvironment()
    const firstId = 'e0000000-0000-0000-0000-000000000001'
    const secondId = 'e0000000-0000-0000-0000-000000000002'
    seedReport(domainStore, { id: firstId, userId: 'report-student' })
    seedReport(domainStore, { id: secondId, userId: 'report-student-2' })

    const verifyFirst = await request(
      app,
      `/v1/admin/adiwiyata/reports/${firstId}/verify`,
      adminNoPhotosToken,
      'POST',
    )
    expect(verifyFirst.status).toBe(200)
    expect((await verifyFirst.json()).data).toMatchObject({
      report: { id: firstId, verified_by: 'report-admin' },
      coverage_status: 'verified',
    })
    expect(domainStore.auditLogs).toHaveLength(1)
    expect(domainStore.auditLogs[0]).toMatchObject({
      actor_id: 'report-admin',
      action: 'verify',
      entity_type: 'adiwiyata_report',
      entity_id: firstId,
      details: {
        prior_verified_at: null,
        prior_verified_by: null,
        next_verified_by: 'report-admin',
      },
    })

    await request(app, `/v1/admin/adiwiyata/reports/${firstId}/verify`, adminToken, 'POST')
    expect(domainStore.auditLogs).toHaveLength(1)
    const verifySecond = await request(
      app,
      `/v1/admin/adiwiyata/reports/${secondId}/verify`,
      adminToken,
      'POST',
    )
    expect((await verifySecond.json()).data.coverage_status).toBe('verified')
    const unverifyFirst = await request(
      app,
      `/v1/admin/adiwiyata/reports/${firstId}/unverify`,
      adminToken,
      'POST',
    )
    expect((await unverifyFirst.json()).data.coverage_status).toBe('verified')
    const unverifySecond = await request(
      app,
      `/v1/admin/adiwiyata/reports/${secondId}/unverify`,
      adminToken,
      'POST',
    )
    expect((await unverifySecond.json()).data.coverage_status).toBe('reported')
    await request(app, `/v1/admin/adiwiyata/reports/${secondId}/unverify`, adminToken, 'POST')
    expect(domainStore.auditLogs).toHaveLength(4)
    expect(domainStore.adiwiyataReports.get(secondId)).toMatchObject({
      verified_at: null,
      verified_by: null,
    })
  })

  it('shares the upload pair lock with verification and closes later uploads', async () => {
    const { domainStore } = createEnvironment()
    const firstId = 'e0000000-0000-0000-0000-000000000003'
    seedReport(domainStore, { id: firstId, userId: 'report-student' })
    const fileId = 'f0000000-0000-0000-0000-000000000004'
    domainStore.files.set(fileId, {
      id: fileId,
      user_id: 'report-student-2',
      purpose: 'adiwiyata_report',
      object_path: `reports/${fileId}.jpg`,
      content_type: 'image/jpeg',
      size_bytes: 512,
      lifecycle: 'pending_upload',
      created_at: reportAt,
      updated_at: reportAt,
    })

    const upload = domainStore.submitAdiwiyataReport({
      reportId: 'e0000000-0000-0000-0000-000000000004',
      userId: 'report-student-2',
      siteId,
      classId,
      profileName: 'Siswa Dua',
      className: 'XII RPL 1',
      reportDate,
      createdAt: reportAt,
      fileId,
      fileSizeBytes: 512,
    })
    const verify = domainStore.updateAdiwiyataReportVerification({
      reportId: firstId,
      schoolId,
      actorId: 'report-admin',
      verified: true,
      at: reportAt,
    })
    const [uploaded, verified] = await Promise.all([upload, verify])
    expect(uploaded.id).toBe('e0000000-0000-0000-0000-000000000004')
    expect(verified?.coverage_status).toBe('verified')
    expect(domainStore.adiwiyataReports.size).toBe(2)

    const rejectedFileId = 'f0000000-0000-0000-0000-000000000005'
    domainStore.files.set(rejectedFileId, {
      id: rejectedFileId,
      user_id: 'report-student-3',
      purpose: 'adiwiyata_report',
      object_path: `reports/${rejectedFileId}.jpg`,
      content_type: 'image/jpeg',
      size_bytes: 512,
      lifecycle: 'pending_upload',
      created_at: reportAt,
      updated_at: reportAt,
    })
    await expect(
      domainStore.submitAdiwiyataReport({
        reportId: 'e0000000-0000-0000-0000-000000000005',
        userId: 'report-student-3',
        siteId,
        classId,
        profileName: 'Siswa Tiga',
        className: 'XII RPL 1',
        reportDate,
        createdAt: reportAt,
        fileId: rejectedFileId,
        fileSizeBytes: 512,
      }),
    ).rejects.toMatchObject({ httpStatus: 409 })
  })

  it('rolls back failed verification audit without deleting a concurrent unrelated audit', async () => {
    const { domainStore } = createEnvironment()
    const reportId = 'e0000000-0000-0000-0000-000000000006'
    seedReport(domainStore, { id: reportId, userId: 'report-student' })
    const originalInsert = domainStore.insertAuditLog.bind(domainStore)
    let markEntered!: () => void
    let unblock!: () => void
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      unblock = resolve
    })
    domainStore.insertAuditLog = async (entry) => {
      if (entry.entity_type === 'adiwiyata_report') {
        markEntered()
        await gate
        await originalInsert(entry)
        throw new Error('simulated audit acknowledgment failure')
      }
      return originalInsert(entry)
    }

    const mutation = domainStore.updateAdiwiyataReportVerification({
      reportId,
      schoolId,
      actorId: 'report-admin',
      verified: true,
      at: reportAt,
    })
    await entered
    await originalInsert({
      actor_id: 'other-admin',
      action: 'unrelated',
      entity_type: 'another_entity',
      entity_id: 'unrelated-id',
    })
    unblock()
    await expect(mutation).rejects.toThrow('simulated audit acknowledgment failure')
    expect(domainStore.adiwiyataReports.get(reportId)).toMatchObject({
      verified_at: null,
      verified_by: null,
    })
    expect(domainStore.auditLogs).toHaveLength(1)
    expect(domainStore.auditLogs[0]).toMatchObject({
      actor_id: 'other-admin',
      action: 'unrelated',
      entity_id: 'unrelated-id',
    })
  })

  it('returns not found for a report outside the active school', async () => {
    const { app, domainStore } = createEnvironment()
    const foreignReportId = 'e0000000-0000-0000-0000-000000000007'
    seedReport(domainStore, {
      id: foreignReportId,
      userId: 'report-student',
      siteId: foreignSiteId,
      classId: otherSchoolClassId,
    })
    const response = await request(
      app,
      `/v1/admin/adiwiyata/reports/${foreignReportId}/verify`,
      adminToken,
      'POST',
    )
    expect(response.status).toBe(404)
    expect(domainStore.auditLogs).toHaveLength(0)
  })
})
