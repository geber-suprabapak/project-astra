import { describe, expect, it } from 'vitest'
import {
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
  })
})
