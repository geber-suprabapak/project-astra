import { describe, expect, it } from 'vitest'
import { AppError } from '../../../src/lib/errors/app-error.js'
import {
  createAcademicPeriod,
  createClass,
  enrollStudent,
  exitStudentEnrollment,
  listAcademicPeriods,
  listClasses,
  listClassEnrollments,
  promoteStudentEnrollment,
  setActiveAcademicPeriod,
  transferStudentEnrollment,
  updateAcademicPeriod,
  updateClass,
} from '../../../src/modules/admin/service.js'
import { setupAdminPolicyTest } from './admin-policy-service-harness.js'

describe('Admin Academic Policy Service', () => {
  describe('Academic Periods', () => {
    it('creates, lists, updates, and activates academic periods with audit logs', async () => {
      const { domainStore, providers } = await setupAdminPolicyTest()

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
      const { providers } = await setupAdminPolicyTest()
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
      const { providers } = await setupAdminPolicyTest()
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
      const { providers } = await setupAdminPolicyTest()
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
      const { providers } = await setupAdminPolicyTest()
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
      const { providers } = await setupAdminPolicyTest()
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
      const { providers } = await setupAdminPolicyTest()
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
})
