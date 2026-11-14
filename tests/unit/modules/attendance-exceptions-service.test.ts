import { describe, expect, it } from 'vitest'
import { submit } from '../../../src/modules/attendance/service.js'
import { AppError } from '../../../src/lib/errors/app-error.js'
import { createTestEnvironment, setupStudentAttendance } from './attendance-exceptions-harness.js'

describe('Attendance Face Verification & Attempts (Ticket 09)', () => {
  it('Face verification success creates Attendance Attempt (status: success) and persists Attendance', async () => {
    const { domainStore, providers } = createTestEnvironment()
    await setupStudentAttendance(domainStore, 'student-1')

    const result = await submit({
      userId: 'student-1',
      actionType: 'check_in',
      imageBase64: 'data:image/jpeg;base64,dGVzdA==',
      latitude: -6.2,
      longitude: 106.816666,
      token: 'jwt-student-token',
      requestId: 'req-success-1',
      providers,
    })

    expect(result.attendance_type).toBe('check_in')
    expect(result.status_label).toBe('Hadir')
    expect(result.processed_ms).toBe(45)

    // Check attendance attempts
    const attempts = await domainStore.listAttendanceAttempts({ userId: 'student-1' })
    expect(attempts).toHaveLength(1)
    expect(attempts[0].status).toBe('success')
    expect(attempts[0].action_type).toBe('check_in')
    expect(attempts[0].confidence).toBe(0.95)
    expect(attempts[0].quality_score).toBe(0.92)

    // Check attendances
    const attendances = await domainStore.listAttendances({ userId: 'student-1' })
    expect(attendances).toHaveLength(1)
    expect(attendances[0].status).toBe('Hadir')
    expect(attendances[0].action_type).toBe('check_in')
  })

  it('Robin face non-match creates Attendance Attempt (status: failed) and NEVER creates Attendance', async () => {
    const { domainStore, providers } = createTestEnvironment({
      identify: async () => ({
        status: 'not_found',
        confidence: 0.42,
        qualityScore: 0.85,
        processTimeMs: 60,
        message: 'Face does not match enrolled face',
      }),
    })
    await setupStudentAttendance(domainStore, 'student-1')

    await expect(
      submit({
        userId: 'student-1',
        actionType: 'check_in',
        imageBase64: 'data:image/jpeg;base64,dGVzdA==',
        latitude: -6.2,
        longitude: 106.816666,
        token: 'jwt-student-token',
        requestId: 'req-nonmatch-1',
        providers,
      }),
    ).rejects.toThrow('Face does not match enrolled face')

    // Attendance attempt must be recorded with status 'failed'
    const attempts = await domainStore.listAttendanceAttempts({ userId: 'student-1' })
    expect(attempts).toHaveLength(1)
    expect(attempts[0].status).toBe('failed')
    expect(attempts[0].action_type).toBe('check_in')
    expect(attempts[0].reason).toContain('Face does not match enrolled face')
    expect(attempts[0].confidence).toBe(0.42)

    // Attendance record must NOT exist
    const attendances = await domainStore.listAttendances({ userId: 'student-1' })
    expect(attendances).toHaveLength(0)
  })

  it('malformed empty Robin status never creates a successful Attempt or Attendance', async () => {
    const { domainStore, providers } = createTestEnvironment({
      identify: async () => ({
        status: '',
        processTimeMs: 12,
        message: 'Malformed synthetic result',
      }),
    })
    await setupStudentAttendance(domainStore, 'student-1')

    await expect(
      submit({
        userId: 'student-1',
        actionType: 'check_in',
        imageBase64: 'data:image/jpeg;base64,dGVzdA==',
        latitude: -6.2,
        longitude: 106.816666,
        token: 'jwt-student-token',
        requestId: 'req-malformed-robin-1',
        providers,
      }),
    ).rejects.toThrow()

    const attempts = await domainStore.listAttendanceAttempts({ userId: 'student-1' })
    expect(attempts).toHaveLength(1)
    expect(attempts[0].status).not.toBe('success')

    const attendances = await domainStore.listAttendances({ userId: 'student-1' })
    expect(attendances).toHaveLength(0)
  })

  it('replayed check-in after a committed check-in does not create a second Attendance', async () => {
    let robinCalls = 0
    const { domainStore, providers } = createTestEnvironment({
      identify: async () => {
        robinCalls += 1
        return {
          status: 'ok',
          confidence: 0.95,
          processTimeMs: 12,
          message: 'Face verified successfully',
        }
      },
    })
    await setupStudentAttendance(domainStore, 'student-1')

    const first = await submit({
      userId: 'student-1',
      actionType: 'check_in',
      imageBase64: 'data:image/jpeg;base64,dGVzdA==',
      latitude: -6.2,
      longitude: 106.816666,
      token: 'jwt-student-token',
      requestId: 'req-replay-first',
      providers,
    })

    await expect(
      submit({
        userId: 'student-1',
        actionType: 'check_in',
        imageBase64: 'data:image/jpeg;base64,dGVzdA==',
        latitude: -6.2,
        longitude: 106.816666,
        token: 'jwt-student-token',
        requestId: 'req-replay-second',
        providers,
      }),
    ).rejects.toThrow("Expected action type 'check_out', got 'check_in'.")

    const attempts = await domainStore.listAttendanceAttempts({ userId: 'student-1' })
    const attendances = await domainStore.listAttendances({ userId: 'student-1' })
    expect(first.attendance_type).toBe('check_in')
    expect(robinCalls).toBe(1)
    expect(attempts).toHaveLength(1)
    expect(attendances).toHaveLength(1)
  })

  it('serializes concurrent same-action submissions after Robin verification', async () => {
    let identifyCalls = 0
    let releaseIdentifies: (() => void) | undefined
    const bothIdentified = new Promise<void>((resolve) => {
      releaseIdentifies = resolve
    })
    const { domainStore, providers } = createTestEnvironment({
      identify: async () => {
        identifyCalls += 1
        if (identifyCalls === 2) releaseIdentifies?.()
        await bothIdentified
        return {
          status: 'ok',
          confidence: 0.95,
          processTimeMs: 12,
          message: 'Face verified successfully',
        }
      },
    })
    await setupStudentAttendance(domainStore, 'student-1')

    const submissions = await Promise.allSettled([
      submit({
        userId: 'student-1',
        actionType: 'check_in',
        imageBase64: 'data:image/jpeg;base64,dGVzdA==',
        latitude: -6.2,
        longitude: 106.816666,
        token: 'jwt-student-token',
        requestId: 'req-concurrent-first',
        providers,
      }),
      submit({
        userId: 'student-1',
        actionType: 'check_in',
        imageBase64: 'data:image/jpeg;base64,dGVzdA==',
        latitude: -6.2,
        longitude: 106.816666,
        token: 'jwt-student-token',
        requestId: 'req-concurrent-second',
        providers,
      }),
    ])

    expect(submissions.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = submissions.find((result) => result.status === 'rejected')
    expect(rejected?.status).toBe('rejected')
    if (rejected?.status === 'rejected') {
      expect(rejected.reason).toMatchObject({ code: 'ATTENDANCE_BLOCKED', httpStatus: 409 })
    }
    expect(identifyCalls).toBe(2)
    expect(await domainStore.listAttendances({ userId: 'student-1' })).toHaveLength(1)
    expect(
      await domainStore.listAttendanceAttempts({ userId: 'student-1', status: 'success' }),
    ).toHaveLength(1)
  })

  it('Attendance save failure never leaves a successful Attempt without a record', async () => {
    const { domainStore, providers } = createTestEnvironment()
    await setupStudentAttendance(domainStore, 'student-1')
    domainStore.saveAttendanceRecord = async () => ({
      success: false,
      message: 'Synthetic persistence failure',
    })

    await expect(
      submit({
        userId: 'student-1',
        actionType: 'check_in',
        imageBase64: 'data:image/jpeg;base64,dGVzdA==',
        latitude: -6.2,
        longitude: 106.816666,
        token: 'jwt-student-token',
        requestId: 'req-save-failure',
        providers,
      }),
    ).rejects.toThrow('Failed to save attendance record: Synthetic persistence failure')

    const attempts = await domainStore.listAttendanceAttempts({ userId: 'student-1' })
    const attendances = await domainStore.listAttendances({ userId: 'student-1' })
    expect(attempts.some((attempt) => attempt.status === 'success')).toBe(false)
    expect(attendances).toHaveLength(0)
  })

  it('Robin 400 Bad Request (low quality / no face) creates Attendance Attempt (status: failed) and NEVER creates Attendance', async () => {
    const { domainStore, providers } = createTestEnvironment({
      identify: async () => {
        throw AppError.attendanceBlocked('No face detected in image.')
      },
    })
    await setupStudentAttendance(domainStore, 'student-1')

    await expect(
      submit({
        userId: 'student-1',
        actionType: 'check_in',
        imageBase64: 'data:image/jpeg;base64,dGVzdA==',
        latitude: -6.2,
        longitude: 106.816666,
        token: 'jwt-student-token',
        requestId: 'req-lowqual-1',
        providers,
      }),
    ).rejects.toThrow('No face detected in image.')

    const attempts = await domainStore.listAttendanceAttempts({ userId: 'student-1' })
    expect(attempts).toHaveLength(1)
    expect(attempts[0].status).toBe('failed')
    expect(attempts[0].reason).toBe('No face detected in image.')

    const attendances = await domainStore.listAttendances({ userId: 'student-1' })
    expect(attendances).toHaveLength(0)
  })

  it('Robin upstream timeout creates Attendance Attempt (status: error) and NEVER creates Attendance', async () => {
    const { domainStore, providers } = createTestEnvironment({
      identify: async () => {
        throw AppError.upstreamTimeout('Robin')
      },
    })
    await setupStudentAttendance(domainStore, 'student-1')

    await expect(
      submit({
        userId: 'student-1',
        actionType: 'check_in',
        imageBase64: 'data:image/jpeg;base64,dGVzdA==',
        latitude: -6.2,
        longitude: 106.816666,
        token: 'jwt-student-token',
        requestId: 'req-timeout-1',
        providers,
      }),
    ).rejects.toThrow('Request to Robin timed out.')

    const attempts = await domainStore.listAttendanceAttempts({ userId: 'student-1' })
    expect(attempts).toHaveLength(1)
    expect(attempts[0].status).toBe('error')
    expect(attempts[0].reason).toContain('timeout')

    const attendances = await domainStore.listAttendances({ userId: 'student-1' })
    expect(attendances).toHaveLength(0)
  })

  it('Robin dependency unavailable (503) creates Attendance Attempt (status: error) and NEVER creates Attendance', async () => {
    const { domainStore, providers } = createTestEnvironment({
      identify: async () => {
        throw AppError.dependencyUnavailable('Robin')
      },
    })
    await setupStudentAttendance(domainStore, 'student-1')

    await expect(
      submit({
        userId: 'student-1',
        actionType: 'check_in',
        imageBase64: 'data:image/jpeg;base64,dGVzdA==',
        latitude: -6.2,
        longitude: 106.816666,
        token: 'jwt-student-token',
        requestId: 'req-unavail-1',
        providers,
      }),
    ).rejects.toThrow('Service dependency unavailable: Robin.')

    const attempts = await domainStore.listAttendanceAttempts({ userId: 'student-1' })
    expect(attempts).toHaveLength(1)
    expect(attempts[0].status).toBe('error')
    expect(attempts[0].reason).toContain('unavailable')

    const attendances = await domainStore.listAttendances({ userId: 'student-1' })
    expect(attendances).toHaveLength(0)
  })

  it('Astra blocks attendance and prevents Robin invocation when geofence or schedule policy fails', async () => {
    let robinIdentifyCalled = false
    const { domainStore, providers } = createTestEnvironment({
      identify: async () => {
        robinIdentifyCalled = true
        return { status: 'ok', processTimeMs: 10 }
      },
    })
    await setupStudentAttendance(domainStore, 'student-1')

    // Submit with coordinates far outside geofence (e.g. latitude: 10.0, longitude: 20.0)
    await expect(
      submit({
        userId: 'student-1',
        actionType: 'check_in',
        imageBase64: 'data:image/jpeg;base64,dGVzdA==',
        latitude: 10.0,
        longitude: 20.0,
        token: 'jwt-student-token',
        requestId: 'req-geofence-fail',
        providers,
      }),
    ).rejects.toThrow()

    // Robin identify must NOT be called when pre-Robin gates fail
    expect(robinIdentifyCalled).toBe(false)
  })
})
