import { describe, expect, it, vi } from 'vitest'
import {
  adminNoPhotosToken,
  adminToken,
  classId,
  createEnvironment,
  foreignSiteId,
  makeSchedule,
  noAdminScopeToken,
  oldClassId,
  otherSchoolClassId,
  otherSchoolId,
  pendingAdminToken,
  periodId,
  reportAt,
  reportDate,
  request,
  schoolId,
  seedReport,
  siteId,
  studentAdminScopeToken,
} from './helpers/adiwiyata-admin-reports-fixture.js'

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
})
