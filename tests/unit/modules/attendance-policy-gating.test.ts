import { describe, expect, it } from 'vitest'
import { runGateChecks } from '../../../src/modules/attendance/service.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { RobinClient } from '../../../src/clients/robin/client.js'
import type { AppProviders } from '../../../src/providers/types.js'

interface GatedEnvironment {
  domainStore: MemoryDomainStore
  providers: AppProviders
}

function createGatedEnvironment(): GatedEnvironment {
  const domainStore = new MemoryDomainStore()
  const identityProvider = new MemoryIdentityProvider()
  const objectStorage = new MemoryObjectStorage()
  const robinClient: RobinClient = {
    checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
    getEnrollmentStatus: async () => ({ status: 'enrolled', embeddingCount: 1, message: 'Enrolled' }),
    enroll: async () => ({ status: 'ok', userId: 'u1', samplesReceived: 1, embeddingsCreated: 1, message: 'Done' }),
    identify: async () => ({ status: 'match', candidateId: 'u1', confidence: 0.9, threshold: 0.7, qualityScore: 0.9, processTimeMs: 1 }),
    deleteEnrollment: async () => {},
  }
  const providers: AppProviders = {
    domainStore,
    identityProvider,
    objectStorage,
    robinClient,
  }
  return { domainStore, providers }
}

describe('Attendance Policy Gating & Priority Matching', () => {
  const setupGatedEnvironment = async () => {
    const { domainStore, providers } = createGatedEnvironment()
    const school = await domainStore.createSchool({
      name: 'SMK Negeri 2 Banjarmasin',
      slug: 'smkn2-bjm',
    })

    // Setup student profile
    domainStore.profiles.set('student-1', {
      user_id: 'student-1',
      full_name: 'Ahmad Dahlan',
      nis: '1001',
      role: 'student',
      lifecycle_status: 'approved',
      gender: null,
    })

    return { domainStore, providers, school }
  }

  it('rejects attendance when no active academic period is configured', async () => {
    const { providers } = await setupGatedEnvironment()

    // Deactivate all periods
    const periods = await providers.domainStore.listAcademicPeriods()
    for (const p of periods) {
      await providers.domainStore.updateAcademicPeriod(p.id, { isActive: false })
    }

    const gate = await runGateChecks(
      {
        userId: 'student-1',
        latitude: -3.316694,
        longitude: 114.590111,
        token: 'test-token',
        requestId: 'req-1',
      },
      providers,
    )

    expect(gate.allowed).toBe(false)
    expect(gate.reasonCode).toBe('ATTENDANCE_BLOCKED')
    expect(gate.reason).toContain('No active academic period configured')
  })

  it('rejects attendance when student has no active class enrollment for current period', async () => {
    const { providers } = await setupGatedEnvironment()

    await providers.domainStore.createAcademicPeriod({
      name: '2026/2027 Ganjil',
      startDate: '2026-07-01',
      endDate: '2026-12-31',
      isActive: true,
    })

    const gate = await runGateChecks(
      {
        userId: 'student-1',
        latitude: -3.316694,
        longitude: 114.590111,
        token: 'test-token',
        requestId: 'req-2',
      },
      providers,
    )

    expect(gate.allowed).toBe(false)
    expect(gate.reasonCode).toBe('ATTENDANCE_BLOCKED')
    expect(gate.reason).toContain('Student has no active class enrollment')
  })

  it('rejects attendance when today is a calendar holiday exception', async () => {
    const { providers } = await setupGatedEnvironment()

    const period = await providers.domainStore.createAcademicPeriod({
      name: '2026/2027 Ganjil',
      startDate: '2026-07-01',
      endDate: '2026-12-31',
      isActive: true,
    })
    const cls = await providers.domainStore.createClass({
      name: 'XII RPL 1',
      grade: 12,
      academicPeriodId: period.id,
    })
    await providers.domainStore.enrollStudentInClass({
      userId: 'student-1',
      classId: cls.id,
      academicPeriodId: period.id,
    })

    const todayWIB = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
    await providers.domainStore.createCalendarException({
      date: todayWIB,
      reason: 'Hari Guru Nasional',
      isHoliday: true,
      academicPeriodId: period.id,
    })

    const gate = await runGateChecks(
      {
        userId: 'student-1',
        latitude: -3.316694,
        longitude: 114.590111,
        token: 'test-token',
        requestId: 'req-3',
      },
      providers,
    )

    expect(gate.allowed).toBe(false)
    expect(gate.reasonCode).toBe('ATTENDANCE_BLOCKED')
    expect(gate.reason).toContain('Hari Guru Nasional')
  })

  it('rejects attendance when no active schedule exists for today', async () => {
    const { providers } = await setupGatedEnvironment()

    const period = await providers.domainStore.createAcademicPeriod({
      name: '2026/2027 Ganjil',
      startDate: '2026-07-01',
      endDate: '2026-12-31',
      isActive: true,
    })
    const cls = await providers.domainStore.createClass({
      name: 'XII RPL 1',
      grade: 12,
      academicPeriodId: period.id,
    })
    await providers.domainStore.enrollStudentInClass({
      userId: 'student-1',
      classId: cls.id,
      academicPeriodId: period.id,
    })

    // Delete all schedules
    const schedules = await providers.domainStore.listSchedules()
    for (const s of schedules) {
      if (s.id) await providers.domainStore.deleteSchedule(s.id)
    }

    const gate = await runGateChecks(
      {
        userId: 'student-1',
        latitude: -3.316694,
        longitude: 114.590111,
        token: 'test-token',
        requestId: 'req-4',
      },
      providers,
    )

    expect(gate.allowed).toBe(false)
    expect(gate.reasonCode).toBe('ATTENDANCE_BLOCKED')
    expect(gate.reason).toContain('No active schedule for today')
  })

  it('rejects attendance when student is outside geofence radius', async () => {
    const { providers } = await setupGatedEnvironment()

    const period = await providers.domainStore.createAcademicPeriod({
      name: '2026/2027 Ganjil',
      startDate: '2026-07-01',
      endDate: '2026-12-31',
      isActive: true,
    })
    const cls = await providers.domainStore.createClass({
      name: 'XII RPL 1',
      grade: 12,
      academicPeriodId: period.id,
    })
    await providers.domainStore.enrollStudentInClass({
      userId: 'student-1',
      classId: cls.id,
      academicPeriodId: period.id,
    })

    const dayMap = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu']
    const todayDay = dayMap[new Date(Date.now() + 7 * 60 * 60 * 1000).getUTCDay()]

    // Schedule covering whole day specifically for this class
    await providers.domainStore.createSchedule({
      classId: cls.id,
      academicPeriodId: period.id,
      dayOfWeek: todayDay,
      startTime: '00:00:00',
      endTime: '23:59:59',
      startCheckout: '00:00:00',
      endCheckout: '23:59:59',
      gracePeriodMinutes: 30,
    })

    // Set school location at (-3.316694, 114.590111) with radius 50m
    const locations = await providers.domainStore.listLocations()
    for (const l of locations) {
      await providers.domainStore.deleteLocation(l.id)
    }
    await providers.domainStore.createLocation({
      name: 'Kampus Utama',
      latitude: -3.316694,
      longitude: 114.590111,
      radiusMeters: 50,
      isActive: true,
    })

    // Student coordinates far away (-6.200000, 106.816666 - Jakarta)
    const gate = await runGateChecks(
      {
        userId: 'student-1',
        latitude: -6.2,
        longitude: 106.816666,
        token: 'test-token',
        requestId: 'req-5',
      },
      providers,
    )

    expect(gate.allowed).toBe(false)
    expect(gate.reason).toContain('Di luar radius lokasi sekolah')
  })

  it('selects schedule by highest specificity: Class + Period over general', async () => {
    const { providers } = createGatedEnvironment()
    const period1 = await providers.domainStore.createAcademicPeriod({
      name: '2026/2027 Ganjil',
      startDate: '2026-07-01',
      endDate: '2026-12-31',
      isActive: true,
    })
    const classA = await providers.domainStore.createClass({
      name: 'X RPL 1',
      grade: 10,
      academicPeriodId: period1.id,
    })

    // General schedule
    await providers.domainStore.createSchedule({
      dayOfWeek: 'senin',
      startTime: '07:00',
      endTime: '08:00',
      startCheckout: '15:00',
      endCheckout: '17:00',
    })

    // Specific schedule for classA + period1
    const specific = await providers.domainStore.createSchedule({
      classId: classA.id,
      academicPeriodId: period1.id,
      dayOfWeek: 'senin',
      startTime: '06:30',
      endTime: '07:30',
      startCheckout: '14:00',
      endCheckout: '16:00',
    })

    const matched = await providers.domainStore.getActiveSchedule('senin', {
      classId: classA.id,
      academicPeriodId: period1.id,
    })

    expect(matched?.id).toBe(specific.id)
    expect(matched?.mulai_masuk).toBe('06:30')
  })
})
