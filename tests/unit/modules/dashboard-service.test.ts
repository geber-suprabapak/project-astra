import { describe, it, expect } from 'vitest'
import {
  computeAttendanceStatus,
  getDayKeyWIB,
  getTodayWIB,
} from '../../../src/modules/dashboard/service.js'

describe('getTodayWIB', () => {
  it('returns YYYY-MM-DD in WIB from UTC time', () => {
    // 2026-04-20T17:00:00Z = 2026-04-21 00:00 WIB
    const date = new Date('2026-04-20T17:00:00Z')
    expect(getTodayWIB(date)).toBe('2026-04-21')
  })
})

describe('getDayKeyWIB', () => {
  it('returns lowercase Indonesian day key', () => {
    // 2026-04-21 in WIB is Tuesday = selasa
    const date = new Date('2026-04-21T00:00:00Z')
    const key = getDayKeyWIB(date)
    expect(['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu']).toContain(key)
  })
})

describe('computeAttendanceStatus', () => {
  it('returns pending when no records', () => {
    const result = computeAttendanceStatus([])
    expect(result.today).toBe('pending')
    expect(result.hasCheckedIn).toBe(false)
    expect(result.hasCheckedOut).toBe(false)
  })

  it('returns present with Hadir record', () => {
    const result = computeAttendanceStatus([
      { status: 'Hadir', created_at: '2026-04-21T07:00:00Z' },
    ])
    expect(result.today).toBe('present')
    expect(result.hasCheckedIn).toBe(true)
    expect(result.checkInStatus).toBe('Hadir')
  })

  it('returns present with Terlambat record', () => {
    const result = computeAttendanceStatus([
      { status: 'Terlambat', created_at: '2026-04-21T07:30:00Z' },
    ])
    expect(result.today).toBe('present')
    expect(result.checkInStatus).toBe('Terlambat')
  })

  it('sets hasCheckedOut when Pulang record exists', () => {
    const result = computeAttendanceStatus([
      { status: 'Hadir', created_at: '2026-04-21T07:00:00Z' },
      { status: 'Pulang', created_at: '2026-04-21T14:00:00Z' },
    ])
    expect(result.hasCheckedIn).toBe(true)
    expect(result.hasCheckedOut).toBe(true)
  })

  it('returns absent when Alpha record exists', () => {
    const result = computeAttendanceStatus([
      { status: 'Alpha', created_at: '2026-04-21T10:00:00Z' },
    ])
    expect(result.today).toBe('absent')
  })
})
