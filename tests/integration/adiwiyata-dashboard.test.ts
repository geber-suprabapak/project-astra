import { describe, expect, it } from 'vitest'
import {
  classId,
  createEnvironment,
  dashboard,
  fixtureUuidSiteId,
  makeSchedule,
  otherClassId,
  period,
  periodId,
  schoolId,
  userId,
} from './helpers/adiwiyata-dashboard-fixture.js'

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
