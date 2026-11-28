import { describe, expect, it } from 'vitest'
import { AppError } from '../../../src/lib/errors/app-error.js'
import { classEnrollmentResponseSchema } from '../../../src/modules/admin/schema.js'
import {
  createAcademicPeriod,
  createCalendarException,
  createLocation,
  createSchedule,
  deleteCalendarException,
  deleteSchedule,
  getCalendarException,
  getSchedule,
  listCalendarExceptions,
  listSchedules,
  updateCalendarException,
  updateSchedule,
} from '../../../src/modules/admin/service.js'
import { setupAdminPolicyTest } from './admin-policy-service-harness.js'

describe('Admin Academic Policy Service — Schedules, Locations & Calendar Exceptions', () => {
  describe('Schedules & Locations', () => {
    it('manages schedules and locations CRUD with audit logs', async () => {
      const { providers } = await setupAdminPolicyTest()

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
      const { providers } = await setupAdminPolicyTest()

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

    it('includes school-wide holidays on period filter, allows teacher/staff reads, defaults period is_active to false, and parses nullable enrollment user_id', async () => {
      const { providers } = await setupAdminPolicyTest()

      const draftPeriod = await createAcademicPeriod({
        name: '2027/2028 Ganjil',
        startDate: '2027-07-01',
        endDate: '2027-12-31',
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })
      expect(draftPeriod.is_active).toBe(false)

      const globalHoliday = await createCalendarException({
        date: '2027-08-17',
        reason: 'HUT RI',
        isHoliday: true,
        academicPeriodId: null,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })
      const periodHoliday = await createCalendarException({
        date: '2027-09-01',
        reason: 'Libur Semester',
        isHoliday: true,
        academicPeriodId: draftPeriod.id,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })

      for (const role of ['teacher', 'staff'] as const) {
        const listed = await listCalendarExceptions({
          filter: { academicPeriodId: draftPeriod.id },
          actorRole: role,
          providers,
        })
        expect(listed.map((e) => e.id)).toEqual(
          expect.arrayContaining([globalHoliday.id, periodHoliday.id]),
        )

        const fetched = await getCalendarException({
          id: globalHoliday.id,
          actorRole: role,
          providers,
        })
        expect(fetched.id).toBe(globalHoliday.id)

        const schedules = await listSchedules({
          actorRole: role,
          providers,
        })
        expect(Array.isArray(schedules)).toBe(true)

        await expect(
          createCalendarException({
            date: '2027-10-01',
            reason: 'Unauthorized',
            actorId: 'staff-1',
            actorRole: role,
            providers,
          }),
        ).rejects.toThrow(AppError)
      }

      const parsedUnbound = classEnrollmentResponseSchema.parse({
        id: 'enroll-unbound-1',
        user_id: null,
        class_id: 'class-1',
        academic_period_id: draftPeriod.id,
        status: 'active',
      })
      expect(parsedUnbound.user_id).toBeNull()
    })
  })
})
