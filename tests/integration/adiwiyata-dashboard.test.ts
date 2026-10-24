import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import type { RobinClient } from '../../src/clients/robin/client.js'
import { createApp } from '../../src/app.js'
import { createAdiwiyataRouter } from '../../src/modules/adiwiyata/routes.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../src/providers/memory/index.js'
import type { AcademicPeriod, Schedule } from '../../src/providers/types.js'

const userId = 'user-adiwiyata-student'
const schoolId = '11111111-1111-1111-1111-111111111111'
const periodId = 'b0000000-0000-0000-0000-000000000001'
const classId = 'c0000000-0000-0000-0000-000000000001'
const otherClassId = 'c0000000-0000-0000-0000-000000000002'
const fixtureUuidSiteId = 'c2000000-0000-0000-0000-000000000020'
const wibTuesday = new Date('2026-09-28T17:30:00.000Z')

const mockRobinClient: RobinClient = {
  checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
  getEnrollmentStatus: async () => ({ status: 'enrolled', embeddingCount: 1, message: 'Ready.' }),
  enroll: async () => ({ imagesProcessed: 1, imagesFailed: 0, totalEmbeddings: 1 }),
  identify: async () => ({ status: 'ok', confidence: 0.9, qualityScore: 0.9, processTimeMs: 1 }),
  deleteEnrollment: async () => {},
}

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
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

function createEnvironment() {
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

function period(overrides: Partial<AcademicPeriod> = {}): AcademicPeriod {
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

async function dashboard(app: ReturnType<typeof createApp>) {
  return app.request('/v1/adiwiyata/dashboard', {
    headers: { Authorization: `Bearer ${userId}` },
  })
}

async function reportImage(): Promise<Buffer> {
  return sharp({
    create: { width: 1, height: 1, channels: 3, background: '#29415d' },
  })
    .png()
    .toBuffer()
}

async function submitReport(
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

describe('GET /v1/adiwiyata/dashboard', () => {
  it('requires authentication and returns a clear eligibility error for unapproved identities', async () => {
    const { app, domainStore } = createEnvironment()
    const unauthenticated = await app.request('/v1/adiwiyata/dashboard')
    expect(unauthenticated.status).toBe(401)

    domainStore.profiles.delete(userId)
    const noProfile = await dashboard(app)
    expect(noProfile.status).toBe(403)
    expect((await noProfile.json()).error.code).toBe('ADIWIYATA_NOT_ELIGIBLE')

    domainStore.profiles.set(userId, {
      user_id: userId,
      full_name: 'Siswa Contoh',
      role: 'student',
      lifecycle_status: 'pending',
    })
    const pending = await dashboard(app)
    expect(pending.status).toBe(403)
    expect((await pending.json()).error.code).toBe('ADIWIYATA_NOT_ELIGIBLE')
  })

  it('requires the Student role, active eligibility, and one current active enrollment', async () => {
    const { app, domainStore } = createEnvironment()
    domainStore.profiles.set(userId, {
      user_id: userId,
      full_name: 'Bukan Siswa',
      role: 'teacher',
      lifecycle_status: 'approved',
    })
    let response = await dashboard(app)
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('ADIWIYATA_NOT_ELIGIBLE')

    domainStore.profiles.set(userId, {
      user_id: userId,
      full_name: 'Siswa Contoh',
      role: 'student',
      lifecycle_status: 'approved',
    })
    domainStore.adiwiyataEligibility.get(userId)!.is_active = false
    response = await dashboard(app)
    expect(response.status).toBe(403)

    domainStore.adiwiyataEligibility.get(userId)!.is_active = true
    domainStore.classEnrollments = []
    response = await dashboard(app)
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('ADIWIYATA_NOT_ELIGIBLE')

    domainStore.classEnrollments = [
      {
        id: 'enrollment-1',
        user_id: userId,
        class_id: classId,
        academic_period_id: periodId,
        status: 'active',
      },
      {
        id: 'enrollment-2',
        user_id: userId,
        class_id: otherClassId,
        academic_period_id: periodId,
        status: 'active',
      },
    ]
    response = await dashboard(app)
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('ADIWIYATA_CONFIGURATION_ERROR')
  })

  it('requires one active period and does not silently select the first when periods are ambiguous', async () => {
    const { app, domainStore } = createEnvironment()
    domainStore.academicPeriods = []
    let response = await dashboard(app)
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('ADIWIYATA_CONFIGURATION_ERROR')

    domainStore.academicPeriods = [period({ id: periodId }), period()]
    response = await dashboard(app)
    expect(response.status).toBe(503)
    expect((await response.json()).error.details.configuration_item).toBe('academic_period')
  })

  it('returns the server WIB date, exact class/general active Sites, and ignores schedule hours', async () => {
    const { app } = createEnvironment()
    const response = await dashboard(app)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toMatchObject({
      date: '2026-09-29',
      timezone: 'Asia/Jakarta',
      academic_period: { id: periodId, name: 'Tahun Ajaran 2026/2027 Ganjil' },
      class: { id: classId, name: 'XII RPL 1' },
      school_day: { is_school_day: true, status: 'scheduled' },
    })
    expect(body.data.sites.map((site: { id: string }) => site.id)).toEqual([
      'site-general',
      'site-own-class',
      fixtureUuidSiteId,
    ])
  })

  it('uses a period-wide general schedule for a class', async () => {
    const { app, domainStore } = createEnvironment()
    domainStore.schedules.clear()
    domainStore.schedules.set(
      'general-tuesday',
      makeSchedule({ id: 'general-tuesday', class_id: null }),
    )

    const response = await dashboard(app)
    expect(response.status).toBe(200)
    expect((await response.json()).data.school_day).toMatchObject({
      is_school_day: true,
      status: 'scheduled',
    })
  })

  it('prefers the exact class schedule over period-wide schedules', async () => {
    const { app, domainStore } = createEnvironment()
    domainStore.schedules.clear()
    domainStore.schedules.set(
      'general-tuesday-1',
      makeSchedule({ id: 'general-tuesday-1', class_id: null }),
    )
    domainStore.schedules.set(
      'general-tuesday-2',
      makeSchedule({ id: 'general-tuesday-2', class_id: null }),
    )
    domainStore.schedules.set('class-tuesday', makeSchedule({ id: 'class-tuesday' }))

    const response = await dashboard(app)
    expect(response.status).toBe(200)
    expect((await response.json()).data.school_day.status).toBe('scheduled')

    domainStore.schedules.clear()
    domainStore.schedules.set(
      'general-tuesday-1',
      makeSchedule({ id: 'general-tuesday-1', class_id: null }),
    )
    domainStore.schedules.set(
      'general-tuesday-2',
      makeSchedule({ id: 'general-tuesday-2', class_id: null }),
    )
    const duplicateGeneral = await dashboard(app)
    expect(duplicateGeneral.status).toBe(503)
    expect((await duplicateGeneral.json()).error.details.matching_rows).toBe(2)
  })

  it('does not use another Class schedule and reports missing or duplicate chosen schedules', async () => {
    const { app, domainStore } = createEnvironment()
    domainStore.schedules.clear()
    domainStore.schedules.set('wrong-class', makeSchedule({ class_id: otherClassId }))
    let response = await dashboard(app)
    expect(response.status).toBe(200)
    expect((await response.json()).data.school_day.status).toBe('not_scheduled')

    domainStore.schedules.set('schedule-1', makeSchedule({ id: 'schedule-1' }))
    domainStore.schedules.set('schedule-2', makeSchedule({ id: 'schedule-2' }))
    response = await dashboard(app)
    expect(response.status).toBe(503)
    expect((await response.json()).error.details.matching_rows).toBe(2)
  })

  it('rejects schedules from another school, period, or the periodless global fallback', async () => {
    const { app, domainStore } = createEnvironment()
    domainStore.schedules.clear()

    domainStore.schedules.set(
      'wrong-school',
      makeSchedule({
        id: 'wrong-school',
        class_id: null,
        school_id: '22222222-2222-2222-2222-222222222222',
      }),
    )
    let response = await dashboard(app)
    expect(response.status).toBe(503)
    expect((await response.json()).error.details.configuration_item).toBe('schedule')

    domainStore.schedules.clear()
    domainStore.schedules.set(
      'wrong-period',
      makeSchedule({
        id: 'wrong-period',
        class_id: null,
        academic_period_id: 'b0000000-0000-0000-0000-000000000009',
      }),
    )
    response = await dashboard(app)
    expect(response.status).toBe(503)
    expect((await response.json()).error.details.configuration_item).toBe('schedule')

    domainStore.schedules.clear()
    domainStore.schedules.set(
      'periodless-global',
      makeSchedule({ id: 'periodless-global', class_id: null, academic_period_id: null }),
    )
    response = await dashboard(app)
    expect(response.status).toBe(503)
    expect((await response.json()).error.details.configuration_item).toBe('schedule')
  })

  it('rejects an enrollment class outside the active period or school', async () => {
    const { app, domainStore } = createEnvironment()
    domainStore.classes[0] = {
      ...domainStore.classes[0]!,
      academic_period_id: 'b0000000-0000-0000-0000-000000000009',
    }

    let response = await dashboard(app)
    expect(response.status).toBe(503)
    expect((await response.json()).error.details.configuration_item).toBe('class')

    domainStore.classes[0] = {
      ...domainStore.classes[0]!,
      academic_period_id: periodId,
      school_id: '22222222-2222-2222-2222-222222222222',
    }
    response = await dashboard(app)
    expect(response.status).toBe(503)
    expect((await response.json()).error.details.configuration_item).toBe('class')
  })

  it('shows not scheduled on an unconfigured weekday and excludes a holiday', async () => {
    const { app, domainStore } = createEnvironment()
    domainStore.schedules.clear()
    domainStore.schedules.set(
      'other-day',
      makeSchedule({ id: 'other-day', day_of_week: 'rabu', hari: 'rabu' }),
    )
    let response = await dashboard(app)
    expect((await response.json()).data.school_day).toMatchObject({
      is_school_day: false,
      status: 'not_scheduled',
    })

    domainStore.calendarExceptions.set('holiday', {
      id: 'holiday',
      school_id: schoolId,
      academic_period_id: periodId,
      date: '2026-09-29',
      reason: 'Libur sekolah',
      is_holiday: true,
    })
    response = await dashboard(app)
    expect((await response.json()).data.school_day).toMatchObject({
      is_school_day: false,
      status: 'holiday',
      reason: 'Libur sekolah',
    })

    domainStore.calendarExceptions.set('other-period', {
      id: 'other-period',
      school_id: schoolId,
      academic_period_id: 'b0000000-0000-0000-0000-000000000009',
      date: '2026-09-29',
      reason: 'Libur periode lain',
      is_holiday: true,
    })
    domainStore.calendarExceptions.delete('holiday')
    response = await dashboard(app)
    expect((await response.json()).data.school_day).toMatchObject({
      is_school_day: false,
      status: 'not_scheduled',
    })

    domainStore.calendarExceptions.set('school-wide-holiday', {
      id: 'school-wide-holiday',
      school_id: schoolId,
      academic_period_id: null,
      date: '2026-09-29',
      reason: 'Libur sekolah umum',
      is_holiday: true,
    })
    response = await dashboard(app)
    expect((await response.json()).data.school_day).toMatchObject({
      is_school_day: false,
      status: 'holiday',
      reason: 'Libur sekolah umum',
    })
  })
})

describe('POST /v1/adiwiyata/reports', () => {
  it('requires authentication, an exact multipart shape, and a decodable matching image', async () => {
    const { app, domainStore } = createEnvironment()
    const unauthenticated = await app.request('/v1/adiwiyata/reports', { method: 'POST' })
    expect(unauthenticated.status).toBe(401)

    const withCaption = await submitReport(app, { extraField: 'client supplied label' })
    expect(withCaption.status).toBe(422)

    const mismatchForm = new FormData()
    mismatchForm.append('site_id', fixtureUuidSiteId)
    mismatchForm.append(
      'image',
      new File([await reportImage()], 'garden.jpg', { type: 'image/jpeg' }),
    )
    const mismatch = await app.request('/v1/adiwiyata/reports', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userId}` },
      body: mismatchForm,
    })
    expect(mismatch.status).toBe(422)
    expect(await domainStore.listFiles({ purpose: 'adiwiyata_report' })).toHaveLength(0)

    const oversized = new FormData()
    oversized.append('site_id', fixtureUuidSiteId)
    oversized.append(
      'image',
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
    )
    const tooLarge = await app.request('/v1/adiwiyata/reports', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userId}` },
      body: oversized,
    })
    expect(tooLarge.status).toBe(422)
    expect(await domainStore.listFiles({ purpose: 'adiwiyata_report' })).toHaveLength(0)
  })

  it('stores a server-authorized JPEG with the approved name, current class, and server WIB date', async () => {
    const { app, domainStore, objectStorage } = createEnvironment()
    domainStore.profiles.get(userId)!.full_name = '  Siswa Contoh  '

    const response = await submitReport(app)

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.data.report).toMatchObject({
      site_id: fixtureUuidSiteId,
      class_id: classId,
      report_date: '2026-09-29',
      created_at: wibTuesday.toISOString(),
    })
    expect(body.data.report).not.toHaveProperty('reported_by')
    const file = await domainStore.getFileRecord(body.data.report.file_id)
    expect(file).toMatchObject({
      purpose: 'adiwiyata_report',
      lifecycle: 'available',
      content_type: 'image/jpeg',
    })
    const stored = objectStorage.objects.get(file!.object_path)
    expect(stored?.contentType).toBe('image/jpeg')
    const metadata = await sharp(stored!.buffer).metadata()
    expect(metadata.format).toBe('jpeg')
    expect(stored!.buffer.length).toBeLessThanOrEqual(2 * 1024 * 1024)
  })

  it('enforces one report per student and Site per WIB date under concurrent submissions', async () => {
    const { app, domainStore } = createEnvironment()

    const responses = await Promise.all([submitReport(app), submitReport(app)])

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409])
    expect(
      await domainStore.listAdiwiyataReports({
        reportedBy: userId,
        siteId: fixtureUuidSiteId,
        reportDate: '2026-09-29',
      }),
    ).toHaveLength(1)
    const files = await domainStore.listFiles({ purpose: 'adiwiyata_report' })
    expect(files.filter((file) => file.lifecycle === 'available')).toHaveLength(1)
    expect(files.filter((file) => file.lifecycle === 'deleted')).toHaveLength(1)
  })

  it('serializes different students on the shared class and Site lock without exposing classmates', async () => {
    const { app, domainStore } = createEnvironment()
    const classmateId = 'user-adiwiyata-classmate'
    domainStore.profiles.set(classmateId, {
      user_id: classmateId,
      full_name: 'Teman Kelas',
      role: 'student',
      lifecycle_status: 'approved',
    })
    domainStore.adiwiyataEligibility.set(classmateId, {
      id: 'eligibility-classmate',
      user_id: classmateId,
      added_by: 'admin-1',
      is_active: true,
    })
    domainStore.classEnrollments.push({
      id: 'enrollment-classmate',
      user_id: classmateId,
      class_id: classId,
      academic_period_id: periodId,
      status: 'active',
    })

    const responses = await Promise.all([
      submitReport(app),
      submitReport(app, { userId: classmateId }),
    ])

    expect(responses.map((response) => response.status)).toEqual([201, 201])
    expect(
      await domainStore.listAdiwiyataReports({
        siteId: fixtureUuidSiteId,
        reportDate: '2026-09-29',
      }),
    ).toHaveLength(2)
    const classmateDashboard = await app.request('/v1/adiwiyata/dashboard', {
      headers: { Authorization: `Bearer ${classmateId}` },
    })
    const site = (await classmateDashboard.json()).data.sites.find(
      (item: { id: string }) => item.id === fixtureUuidSiteId,
    )
    expect(site).toMatchObject({
      coverage_status: 'reported',
      own_report: { file_id: expect.any(String) },
    })
    const otherStudentDashboard = await app.request('/v1/adiwiyata/dashboard', {
      headers: { Authorization: `Bearer ${userId}` },
    })
    const otherStudentSite = (await otherStudentDashboard.json()).data.sites.find(
      (item: { id: string }) => item.id === fixtureUuidSiteId,
    )
    expect(otherStudentSite.own_report.file_id).not.toBe(site.own_report.file_id)
    const ownFile = await domainStore.getFileRecord(otherStudentSite.own_report.file_id)
    expect(otherStudentSite.own_report.file_created_at).toBe(ownFile!.created_at)
    expect(otherStudentSite).not.toHaveProperty('reports')
    expect(otherStudentSite).not.toHaveProperty('reported_by')
  })

  it('keeps a student’s own report visible after an enrollment transfer without permitting a second upload', async () => {
    const { app, domainStore } = createEnvironment()
    const uploaded = await submitReport(app)
    expect(uploaded.status).toBe(201)
    domainStore.classEnrollments = [
      {
        id: 'enrollment-transferred',
        user_id: userId,
        class_id: otherClassId,
        academic_period_id: periodId,
        status: 'active',
      },
    ]
    domainStore.schedules.set(
      'other-class-tuesday',
      makeSchedule({
        id: 'other-class-tuesday',
        class_id: otherClassId,
      }),
    )

    const currentDashboard = await dashboard(app)
    const site = (await currentDashboard.json()).data.sites.find(
      (item: { id: string }) => item.id === fixtureUuidSiteId,
    )
    expect(site).toMatchObject({
      coverage_status: 'missing',
      own_report: { file_id: expect.any(String) },
      can_report: false,
    })
    const retry = await submitReport(app)
    expect(retry.status).toBe(409)
  })

  it('blocks submissions after the current class Site and date are verified', async () => {
    const { app, domainStore } = createEnvironment()
    domainStore.adiwiyataReports.set('verified-report', {
      id: 'verified-report',
      site_id: fixtureUuidSiteId,
      class_id: classId,
      reported_by: 'another-student',
      file_id: 'verified-file',
      report_date: '2026-09-29',
      created_at: wibTuesday.toISOString(),
      verified_at: wibTuesday.toISOString(),
      verified_by: 'admin-1',
    })

    const response = await submitReport(app)

    expect(response.status).toBe(409)
    expect(await domainStore.listFiles({ purpose: 'adiwiyata_report' })).toHaveLength(0)
  })

  it('keeps pending metadata and the object when DB commit status cannot be confirmed', async () => {
    const { app, domainStore, objectStorage } = createEnvironment()
    domainStore.submitAdiwiyataReport = async () => {
      throw new Error('database reply lost')
    }

    const response = await submitReport(app)

    expect(response.status).toBe(500)
    const [file] = await domainStore.listFiles({ purpose: 'adiwiyata_report' })
    expect(file?.lifecycle).toBe('pending_upload')
    expect(objectStorage.objects.has(file!.object_path)).toBe(true)
  })

  it('returns the committed report when its DB acknowledgment is lost', async () => {
    const { app, domainStore, objectStorage } = createEnvironment()
    const submit = domainStore.submitAdiwiyataReport.bind(domainStore)
    domainStore.submitAdiwiyataReport = async (params) => {
      await submit(params)
      throw new Error('commit acknowledgment lost')
    }

    const response = await submitReport(app)

    expect(response.status).toBe(201)
    expect(
      await domainStore.listAdiwiyataReports({ siteId: fixtureUuidSiteId, reportedBy: userId }),
    ).toHaveLength(1)
    const [file] = await domainStore.listFiles({ purpose: 'adiwiyata_report' })
    expect(file?.lifecycle).toBe('available')
    expect(objectStorage.objects.has(file!.object_path)).toBe(true)
  })

  it('retains the pending row when uncertain object cleanup fails', async () => {
    const { app, domainStore, objectStorage } = createEnvironment()
    const upload = objectStorage.uploadAdiwiyataReport.bind(objectStorage)
    objectStorage.uploadAdiwiyataReport = async (path, image) => {
      await upload(path, image)
      throw new Error('PUT response lost')
    }
    objectStorage.deleteObject = async () => {
      throw new Error('DELETE response lost')
    }

    const response = await submitReport(app)

    expect(response.status).toBe(502)
    const [file] = await domainStore.listFiles({ purpose: 'adiwiyata_report' })
    expect(file?.lifecycle).toBe('pending_upload')
    expect(objectStorage.objects.has(file!.object_path)).toBe(true)
  })
})
