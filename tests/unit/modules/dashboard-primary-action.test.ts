import { describe, it, expect } from 'vitest'
import { computePrimaryAction } from '../../../src/modules/dashboard/service.js'
import type { AttendanceStatus } from '../../../src/modules/dashboard/service.js'
import type { Schedule } from '../../../src/providers/types.js'

const baseSchedule: Schedule = {
  hari: 'senin',
  mulai_masuk: '06:30:00',
  selesai_masuk: '08:30:00',
  mulai_pulang: '14:00:00',
  selesai_pulang: '16:00:00',
  kompensasi_waktu: 30,
  is_active: true,
}

const pendingStatus: AttendanceStatus = {
  today: 'pending',
  hasCheckedIn: false,
  hasCheckedOut: false,
  checkInStatus: null,
}

describe('computePrimaryAction', () => {
  it('returns DEPENDENCY_UNAVAILABLE when Robin is unhealthy', () => {
    const result = computePrimaryAction({
      robinHealthy: false,
      enrollmentStatus: 'enrolled',
      hasActivePermit: false,
      schedule: baseSchedule,
      attendanceStatus: pendingStatus,
      baseDateWIB: '2026-04-21',
    })
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.reason_code).toBe('DEPENDENCY_UNAVAILABLE')
      expect(result.reason_message).toContain('unavailable')
    }
  })

  it('returns ENROLLMENT_REQUIRED when not enrolled', () => {
    const result = computePrimaryAction({
      robinHealthy: true,
      enrollmentStatus: 'not_enrolled',
      hasActivePermit: false,
      schedule: baseSchedule,
      attendanceStatus: pendingStatus,
      baseDateWIB: '2026-04-21',
    })
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.reason_code).toBe('ENROLLMENT_REQUIRED')
      expect(result.reason_message).toContain('enrollment')
    }
  })

  it('returns ATTENDANCE_BLOCKED when has active permit', () => {
    const result = computePrimaryAction({
      robinHealthy: true,
      enrollmentStatus: 'enrolled',
      hasActivePermit: true,
      schedule: baseSchedule,
      attendanceStatus: pendingStatus,
      baseDateWIB: '2026-04-21',
    })
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.reason_code).toBe('ATTENDANCE_BLOCKED')
      expect(result.reason_message).toContain('permit')
    }
  })

  it('returns ATTENDANCE_BLOCKED when no schedule', () => {
    const result = computePrimaryAction({
      robinHealthy: true,
      enrollmentStatus: 'enrolled',
      hasActivePermit: false,
      schedule: null,
      attendanceStatus: pendingStatus,
      baseDateWIB: '2026-04-21',
    })
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.reason_code).toBe('ATTENDANCE_BLOCKED')
    }
  })
})
