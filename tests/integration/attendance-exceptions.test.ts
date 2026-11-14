import { describe, expect, it } from 'vitest'
import { AppError } from '../../src/lib/errors/app-error.js'
import {
  createIntegrationEnvironment,
  setupSchoolAndStudent,
  signedOidcToken,
} from './helpers/attendance-exceptions-fixture.js'

describe('Record Face Attendance Integration Tests (Ticket 09)', () => {
  it('POST /v1/mobile/attendance/submit - Happy path records Attendance and Success Attempt', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupSchoolAndStudent(domainStore, identityProvider, 'student-1')

    const studentToken = await signedOidcToken({
      sub: 'student-1',
      roles: ['student'],
      scope: 'attendance:write openid profile',
    })

    const res = await app.request('/v1/mobile/attendance/submit', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action_type: 'check_in',
        image_base64: 'data:image/jpeg;base64,dGVzdA==',
        latitude: -6.2,
        longitude: 106.816666,
      }),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.attendance_type).toBe('check_in')
    expect(body.data.status_label).toBe('Hadir')

    // Verify domain store state
    const attempts = await domainStore.listAttendanceAttempts({ userId: 'student-1' })
    expect(attempts).toHaveLength(1)
    expect(attempts[0].status).toBe('success')

    const attendances = await domainStore.listAttendances({ userId: 'student-1' })
    expect(attendances).toHaveLength(1)
    expect(attendances[0].status).toBe('Hadir')
  })

  it('POST /v1/mobile/attendance/submit - Face non-match creates Attempt (status: failed) and NO Attendance', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment({
      identify: async () => ({
        status: 'not_found',
        confidence: 0.38,
        processTimeMs: 40,
        message: 'Face does not match enrolled face',
      }),
    })
    await setupSchoolAndStudent(domainStore, identityProvider, 'student-1')

    const studentToken = await signedOidcToken({
      sub: 'student-1',
      roles: ['student'],
      scope: 'attendance:write openid profile',
    })

    const res = await app.request('/v1/mobile/attendance/submit', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action_type: 'check_in',
        image_base64: 'data:image/jpeg;base64,dGVzdA==',
        latitude: -6.2,
        longitude: 106.816666,
      }),
    })

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('ATTENDANCE_BLOCKED')

    // Attempt recorded with status failed
    const attempts = await domainStore.listAttendanceAttempts({ userId: 'student-1' })
    expect(attempts).toHaveLength(1)
    expect(attempts[0].status).toBe('failed')
    expect(attempts[0].confidence).toBe(0.38)

    // No attendance persisted
    const attendances = await domainStore.listAttendances({ userId: 'student-1' })
    expect(attendances).toHaveLength(0)
  })

  it('POST /v1/mobile/attendance/submit - Robin timeout yields Observable Error Attempt and NO Attendance', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment({
      identify: async () => {
        throw AppError.upstreamTimeout('Robin')
      },
    })
    await setupSchoolAndStudent(domainStore, identityProvider, 'student-1')

    const studentToken = await signedOidcToken({
      sub: 'student-1',
      roles: ['student'],
      scope: 'attendance:write openid profile',
    })

    const res = await app.request('/v1/mobile/attendance/submit', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action_type: 'check_in',
        image_base64: 'data:image/jpeg;base64,dGVzdA==',
        latitude: -6.2,
        longitude: 106.816666,
      }),
    })

    expect(res.status).toBe(504)

    // Attempt recorded with status error
    const attempts = await domainStore.listAttendanceAttempts({ userId: 'student-1' })
    expect(attempts).toHaveLength(1)
    expect(attempts[0].status).toBe('error')

    // No attendance
    const attendances = await domainStore.listAttendances({ userId: 'student-1' })
    expect(attendances).toHaveLength(0)
  })
})
