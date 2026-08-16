import { describe, it, expect } from 'vitest'
import {
  computeActionType,
  computeInsertStatus,
  base64ByteSize,
} from '../../../src/modules/attendance/mapper.js'
import type { AttendanceStatus } from '../../../src/modules/dashboard/service.js'

const pending: AttendanceStatus = {
  today: 'pending',
  hasCheckedIn: false,
  hasCheckedOut: false,
  checkInStatus: null,
}
const checkedIn: AttendanceStatus = {
  today: 'present',
  hasCheckedIn: true,
  hasCheckedOut: false,
  checkInStatus: 'Hadir',
}
const done: AttendanceStatus = {
  today: 'present',
  hasCheckedIn: true,
  hasCheckedOut: true,
  checkInStatus: 'Hadir',
}

describe('computeActionType', () => {
  it('returns check_in when not checked in', () => {
    expect(computeActionType(pending)).toBe('check_in')
  })

  it('returns check_out when checked in but not checked out', () => {
    expect(computeActionType(checkedIn)).toBe('check_out')
  })

  it('returns done when both checked in and out', () => {
    expect(computeActionType(done)).toBe('done')
  })
})

describe('computeInsertStatus', () => {
  it('returns Hadir for check_in on time', () => {
    expect(computeInsertStatus('check_in', false)).toBe('Hadir')
  })

  it('returns Terlambat for late check_in', () => {
    expect(computeInsertStatus('check_in', true)).toBe('Terlambat')
  })

  it('returns Pulang for check_out', () => {
    expect(computeInsertStatus('check_out', false)).toBe('Pulang')
    expect(computeInsertStatus('check_out', true)).toBe('Pulang')
  })
})

describe('base64ByteSize', () => {
  it('approximates byte size correctly', () => {
    const b64 = Buffer.from('hello world').toString('base64')
    expect(base64ByteSize(b64)).toBe(11)
  })
})
