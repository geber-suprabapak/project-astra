import { describe, expect, it } from 'vitest'
import { AppError } from '../../../src/lib/errors/app-error.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { RobinClient } from '../../../src/clients/robin/client.js'
import type { AppProviders } from '../../../src/providers/types.js'
import {
  createAcademicPeriod,
  createCalendarException,
  createClass,
  createLocation,
  createSchedule,
  deleteCalendarException,
  deleteSchedule,
  enrollStudent,
  exitStudentEnrollment,
  getCalendarException,
  getSchedule,
  listAcademicPeriods,
  listCalendarExceptions,
  listClasses,
  listClassEnrollments,
  listSchedules,
  promoteStudentEnrollment,
  setActiveAcademicPeriod,
  transferStudentEnrollment,
  updateAcademicPeriod,
  updateCalendarException,
  updateClass,
  updateSchedule,
} from '../../../src/modules/admin/service.js'

const mockRobinClient: RobinClient = {
  checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
  getEnrollmentStatus: async () => ({ status: 'enrolled', embeddingCount: 1, message: 'Ready' }),
  enroll: async () => ({ status: 'ok', userId: 'u1', samplesReceived: 1, embeddingsCreated: 1, message: 'Done' }),
  identify: async () => ({ status: 'match', candidateId: 'u1', confidence: 0.9, threshold: 0.7, qualityScore: 0.9, processTimeMs: 1 }),
  deleteEnrollment: async () => {},
}

interface TestSetup {
  domainStore: MemoryDomainStore
  providers: AppProviders
}

function createTestSetup(): TestSetup {
  const domainStore = new MemoryDomainStore()
  const identityProvider = new MemoryIdentityProvider()
  const objectStorage = new MemoryObjectStorage()
  const providers: AppProviders = {
    domainStore,
    identityProvider,
    objectStorage,
    robinClient: mockRobinClient,
  }
  return { domainStore, providers }
}

describe('Admin Academic Policy Service', () => {
  const setup = async () => {
    const { domainStore, providers } = createTestSetup()
    const school = await domainStore.createSchool({
      name: 'SMK Negeri 2 Banjarmasin',
      slug: 'smkn2-bjm',
    })
    const admin = await domainStore.createInitialSchoolAdmin({
      userId: 'admin-1',
      fullName: 'School Admin',
      email: 'admin@smkn2.sch.id',
    })
    // Reset periods created during bootstrap to have clean slate for testing
    domainStore.academicPeriods = []
    // Create student profile
    domainStore.profiles.set('student-1', {
      user_id: 'student-1',
      full_name: 'Student One',
      nis: '12345',
      role: 'student',
      lifecycle_status: 'approved',
      gender: null,
    })
    return { domainStore, providers, school, admin }
  }

  describe('Academic Periods', () => {
    it('creates, lists, updates, and activates academic periods with audit logs', async () => {
      const { domainStore, providers } = await setup()

      const period1 = await createAcademicPeriod({
        name: '2026/2027 Ganjil',
        startDate: '2026-07-01',
        endDate: '2026-12-31',
        isActive: true,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })
      expect(period1.id).toBeDefined()
      expect(period1.is_active).toBe(true)

      const period2 = await createAcademicPeriod({
        name: '2026/2027 Genap',
        startDate: '2027-01-01',
        endDate: '2027-06-30',
        isActive: false,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })
      expect(period2.is_active).toBe(false)

      const list = await listAcademicPeriods({
        actorRole: 'school_admin',
        providers,
      })
      expect(list.length).toBe(2)

      const updated = await updateAcademicPeriod({
        id: period1.id,
        name: '2026/2027 Semester 1',
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })
      expect(updated.name).toBe('2026/2027 Semester 1')

      const activated = await setActiveAcademicPeriod({
        id: period2.id,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })
      expect(activated.id).toBe(period2.id)
      expect(activated.is_active).toBe(true)

      const activeList = await listAcademicPeriods({
        filter: { isActive: true },
        actorRole: 'school_admin',
        providers,
      })
      expect(activeList.length).toBe(1)
      expect(activeList[0].id).toBe(period2.id)

      // Audit logs
      const logs = domainStore.auditLogs
      const periodLogs = logs.filter((l) => l.entity_type === 'academic_period')
      expect(periodLogs.length).toBe(4) // 2 creates, 1 update, 1 set-active
    })

    it('rejects unauthorized actor roles', async () => {
      const { providers } = await setup()
      await expect(
        createAcademicPeriod({
          name: '2026/2027 Ganjil',
          startDate: '2026-07-01',
          endDate: '2026-12-31',
          actorId: 'student-1',
          actorRole: 'student',
          providers,
        }),
      ).rejects.toThrow(AppError)
    })
  })

  describe('Classes & Enrollments Lifecycle', () => {
    it('manages class creation and update', async () => {
      const { providers } = await setup()
      const cls = await createClass({
        name: 'XII RPL 1',
        grade: 12,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })
      expect(cls.id).toBeDefined()
      expect(cls.name).toBe('XII RPL 1')

      const updated = await updateClass({
        id: cls.id,
        name: 'XII RPL A',
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })
      expect(updated.name).toBe('XII RPL A')

      const classes = await listClasses({
        actorRole: 'school_admin',
        providers,
      })
      expect(classes.some((c) => c.id === cls.id)).toBe(true)
    })

    it('enforces student enrollment invariant: at most one active class per academic period', async () => {
      const { providers } = await setup()
      const period = await createAcademicPeriod({
        name: '2026/2027 Ganjil',
        startDate: '2026-07-01',
        endDate: '2026-12-31',
        isActive: true,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })
      const class1 = await createClass({
        name: 'X RPL 1',
        grade: 10,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })
      const class2 = await createClass({
        name: 'X RPL 2',
        grade: 10,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })

      // First enrollment
      const enrollment = await enrollStudent({
        userId: 'student-1',
        classId: class1.id,
        academicPeriodId: period.id,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })
      expect(enrollment.status).toBe('active')

      // Profile class_name should be updated
      const profile = await providers.domainStore.getUserProfile('student-1')
      expect(profile.class_name).toBe('X RPL 1')

      // Second enrollment in same academic period must throw 409 Conflict
      await expect(
        enrollStudent({
          userId: 'student-1',
          classId: class2.id,
          academicPeriodId: period.id,
          actorId: 'admin-1',
          actorRole: 'school_admin',
          providers,
        }),
      ).rejects.toThrow(AppError)
    })

    it('transfers student enrollment to another class in the same period preserving history', async () => {
      const { providers } = await setup()
      const period = await createAcademicPeriod({
        name: '2026/2027 Ganjil',
        startDate: '2026-07-01',
        endDate: '2026-12-31',
        isActive: true,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })
      const class1 = await createClass({
        name: 'X RPL 1',
        grade: 10,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })
      const class2 = await createClass({
        name: 'X RPL 2',
        grade: 10,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })

      await enrollStudent({
        userId: 'student-1',
        classId: class1.id,
        academicPeriodId: period.id,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })

      const transferResult = await transferStudentEnrollment({
        userId: 'student-1',
        toClassId: class2.id,
        academicPeriodId: period.id,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })

      expect(transferResult.previous.status).toBe('transferred')
      expect(transferResult.current.status).toBe('active')
      expect(transferResult.current.class_name).toBe('X RPL 2')

      const profile = await providers.domainStore.getUserProfile('student-1')
      expect(profile.class_name).toBe('X RPL 2')

      // History should show both
      const history = await listClassEnrollments({
        userId: 'student-1',
        actorRole: 'school_admin',
        providers,
      })
      expect(history.length).toBe(2)
      expect(history.find((h) => h.status === 'transferred')).toBeDefined()
      expect(history.find((h) => h.status === 'active')).toBeDefined()
    })

    it('promotes student enrollment to next academic period preserving history', async () => {
      const { providers } = await setup()
      const period1 = await createAcademicPeriod({
        name: '2025/2026 Genap',
        startDate: '2026-01-01',
        endDate: '2026-06-30',
        isActive: false,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })
      const period2 = await createAcademicPeriod({
        name: '2026/2027 Ganjil',
        startDate: '2026-07-01',
        endDate: '2026-12-31',
        isActive: true,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })
      const class10 = await createClass({
        name: 'X RPL 1',
        grade: 10,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })
      const class11 = await createClass({
        name: 'XI RPL 1',
        grade: 11,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })

      await enrollStudent({
        userId: 'student-1',
        classId: class10.id,
        academicPeriodId: period1.id,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })

      const promoteResult = await promoteStudentEnrollment({
        userId: 'student-1',
        fromAcademicPeriodId: period1.id,
        toAcademicPeriodId: period2.id,
        toClassId: class11.id,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })

      expect(promoteResult.previous.status).toBe('promoted')
      expect(promoteResult.current.status).toBe('active')
      expect(promoteResult.current.class_name).toBe('XI RPL 1')

      const profile = await providers.domainStore.getUserProfile('student-1')
      expect(profile.class_name).toBe('XI RPL 1')
    })

    it('exits student enrollment with graduated / archived status', async () => {
      const { providers } = await setup()
      const period = await createAcademicPeriod({
        name: '2026/2027 Ganjil',
        startDate: '2026-07-01',
        endDate: '2026-12-31',
        isActive: true,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })
      const cls = await createClass({
        name: 'XII RPL 1',
        grade: 12,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })

      await enrollStudent({
        userId: 'student-1',
        classId: cls.id,
        academicPeriodId: period.id,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })

      const exitResult = await exitStudentEnrollment({
        userId: 'student-1',
        academicPeriodId: period.id,
        status: 'graduated',
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })

      expect(exitResult.status).toBe('graduated')

      const active = await providers.domainStore.getActiveClassEnrollment('student-1', period.id)
      expect(active).toBeNull()
    })
  })

  describe('Schedules & Locations', () => {
    it('manages schedules and locations CRUD with audit logs', async () => {
      const { providers } = await setup()

      const loc = await createLocation({
        name: 'Kampus Utama SMKN 2',
        latitude: -3.316694,
        longitude: 114.590111,
        radiusMeters: 150,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })
      expect(loc.name).toBe('Kampus Utama SMKN 2')

      const sched = await createSchedule({
        dayOfWeek: 'senin',
        startTime: '07:00',
        endTime: '08:00',
        startCheckout: '15:00',
        endCheckout: '17:00',
        gracePeriodMinutes: 15,
        locationId: loc.id,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })
      expect(sched.hari).toBe('senin')
      expect(sched.kompensasi_waktu).toBe(15)

      const fetchedSched = await getSchedule({
        id: sched.id!,
        actorRole: 'school_admin',
        providers,
      })
      expect(fetchedSched.id).toBe(sched.id)

      const updatedSched = await updateSchedule({
        id: sched.id!,
        startTime: '06:45',
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })
      expect(updatedSched.mulai_masuk).toBe('06:45')

      await deleteSchedule({
        id: sched.id!,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })

      const schedList = await listSchedules({
        actorRole: 'school_admin',
        providers,
      })
      expect(schedList.some((s) => s.id === sched.id)).toBe(false)
    })
  })

  describe('Calendar Exceptions', () => {
    it('manages holiday and exception entries with audit logs', async () => {
      const { providers } = await setup()

      const exc = await createCalendarException({
        date: '2026-08-17',
        reason: 'Hari Kemerdekaan RI',
        isHoliday: true,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })
      expect(exc.date).toBe('2026-08-17')
      expect(exc.is_holiday).toBe(true)

      const fetched = await getCalendarException({
        id: exc.id,
        actorRole: 'school_admin',
        providers,
      })
      expect(fetched.reason).toBe('Hari Kemerdekaan RI')

      const updated = await updateCalendarException({
        id: exc.id,
        reason: 'HUT RI ke-81',
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })
      expect(updated.reason).toBe('HUT RI ke-81')

      const list = await listCalendarExceptions({
        actorRole: 'school_admin',
        providers,
      })
      expect(list.some((e) => e.id === exc.id)).toBe(true)

      await deleteCalendarException({
        id: exc.id,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })

      const afterList = await listCalendarExceptions({
        actorRole: 'school_admin',
        providers,
      })
      expect(afterList.some((e) => e.id === exc.id)).toBe(false)
    })
  })
})
