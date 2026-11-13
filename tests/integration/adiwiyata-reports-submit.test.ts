import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  classId,
  createEnvironment,
  dashboard,
  fixtureUuidSiteId,
  makeSchedule,
  otherClassId,
  periodId,
  reportImage,
  submitReport,
  userId,
  wibTuesday,
} from './helpers/adiwiyata-dashboard-fixture.js'

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
