import { describe, expect, it } from 'vitest'
import {
  createManualAttendance,
  listAttendanceAttempts,
  getAttendanceAttempt,
} from '../../../src/modules/admin/service.js'
import { createTestEnvironment, setupStudentAttendance } from './attendance-exceptions-harness.js'

describe('Manual Attendance & Attempt Audit Trail (Ticket 09)', () => {
  it('Authorized staff (school_admin) creates manual attendance with reason and related attempt audit trail', async () => {
    const { domainStore, providers } = createTestEnvironment()
    await setupStudentAttendance(domainStore, 'student-1')

    // Create a failed attempt first
    const failedAttempt = await domainStore.recordAttendanceAttempt({
      userId: 'student-1',
      actionType: 'check_in',
      status: 'failed',
      reason: 'Camera glare prevented face recognition',
      confidence: 0.35,
      latitude: -6.2,
      longitude: 106.816666,
      processTimeMs: 120,
    })

    // Staff creates manual attendance referencing the failed attempt
    const manualRecord = await createManualAttendance({
      userId: 'student-1',
      actionType: 'check_in',
      status: 'Hadir',
      reason: 'Student verified in person by teacher after camera glare defect',
      attemptId: failedAttempt.id,
      actorId: 'staff-admin-1',
      actorRole: 'school_admin',
      providers,
    })

    expect(manualRecord.user_id).toBe('student-1')
    expect(manualRecord.status).toBe('Hadir')
    expect(manualRecord.action_type).toBe('check_in')

    // Check attendance in domain store
    const attendances = await domainStore.listAttendances({ userId: 'student-1' })
    expect(attendances).toHaveLength(1)
    expect(attendances[0].status).toBe('Hadir')

    // Check audit logs
    const logs = await domainStore.getAuditLogs('attendance', manualRecord.id)
    expect(logs.length).toBeGreaterThan(0)
    const log = logs[0]
    expect(log.action).toBe('create_manual_attendance')
    expect(log.actor_id).toBe('staff-admin-1')
    expect(log.details?.reason).toBe(
      'Student verified in person by teacher after camera glare defect',
    )
    expect(log.details?.attempt_id).toBe(failedAttempt.id)
    expect(log.details?.attempt_status).toBe('failed')
    expect(log.details?.attempt_reason).toBe('Camera glare prevented face recognition')

    await expect(
      createManualAttendance({
        userId: 'student-1',
        actionType: 'check_in',
        status: 'Hadir',
        reason: 'Duplicate synthetic record',
        attemptId: failedAttempt.id,
        actorId: 'staff-admin-1',
        actorRole: 'school_admin',
        providers,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', httpStatus: 409 })
    expect(await domainStore.listAttendances({ userId: 'student-1' })).toHaveLength(1)
    expect(await domainStore.getAuditLogs('attendance')).toHaveLength(1)
  })

  it('does not leave manual attendance or partial audit when audit persistence fails', async () => {
    const { domainStore, providers } = createTestEnvironment()
    await setupStudentAttendance(domainStore, 'student-1')
    const failedAttempt = await domainStore.recordAttendanceAttempt({
      userId: 'student-1',
      actionType: 'check_in',
      status: 'failed',
    })
    const insertAuditLog = domainStore.insertAuditLog.bind(domainStore)
    domainStore.insertAuditLog = async (entry) => {
      await insertAuditLog(entry)
      throw new Error('synthetic audit acknowledgment failure')
    }

    await expect(
      createManualAttendance({
        userId: 'student-1',
        actionType: 'check_in',
        status: 'Hadir',
        reason: 'Verified in person after retry',
        attemptId: failedAttempt.id,
        actorId: 'school-admin-1',
        actorRole: 'school_admin',
        providers,
      }),
    ).rejects.toThrow('synthetic audit acknowledgment failure')

    expect(await domainStore.listAttendances({ userId: 'student-1' })).toHaveLength(0)
    expect(await domainStore.getAuditLogs('attendance')).toHaveLength(0)
  })

  it('Teacher cannot create manual attendance', async () => {
    const { domainStore, providers } = createTestEnvironment()
    await setupStudentAttendance(domainStore, 'student-1')

    await expect(
      createManualAttendance({
        userId: 'student-1',
        actionType: 'check_in',
        status: 'Hadir',
        reason: 'Manual check-in by homeroom teacher',
        actorId: 'teacher-1',
        actorRole: 'teacher',
        providers,
      }),
    ).rejects.toThrow('Access denied.')
  })

  it('Platform administrator can create manual attendance while teacher is denied', async () => {
    const { domainStore, providers } = createTestEnvironment()
    await setupStudentAttendance(domainStore, 'student-1')
    const attempt = await domainStore.recordAttendanceAttempt({
      userId: 'student-1',
      actionType: 'check_in',
      status: 'failed',
    })

    await expect(
      createManualAttendance({
        userId: 'student-1',
        actionType: 'check_in',
        status: 'Hadir',
        reason: 'Verified in person after failed check-in',
        attemptId: attempt.id,
        actorId: 'teacher-1',
        actorRole: 'teacher',
        providers,
      }),
    ).rejects.toThrow('Access denied.')
    expect(await domainStore.listAttendances({ userId: 'student-1' })).toHaveLength(0)

    const record = await createManualAttendance({
      userId: 'student-1',
      actionType: 'check_in',
      status: 'Hadir',
      reason: 'Verified in person after failed check-in',
      attemptId: attempt.id,
      actorId: 'platform-admin-1',
      actorRole: 'platform_admin',
      providers,
    })
    expect(record.user_id).toBe('student-1')
  })

  it('Requires a related attendance attempt for manual attendance', async () => {
    const { domainStore, providers } = createTestEnvironment()
    await setupStudentAttendance(domainStore, 'student-1')

    await expect(
      createManualAttendance({
        userId: 'student-1',
        actionType: 'check_in',
        status: 'Hadir',
        reason: 'Manual check-in after verification failure',
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      }),
    ).rejects.toThrow('Validation failed.')
  })

  it('Unauthorized actor (student) cannot create manual attendance (throws 403)', async () => {
    const { domainStore, providers } = createTestEnvironment()
    await setupStudentAttendance(domainStore, 'student-1')

    await expect(
      createManualAttendance({
        userId: 'student-1',
        actionType: 'check_in',
        status: 'Hadir',
        reason: 'Self override',
        actorId: 'student-1',
        actorRole: 'student',
        providers,
      }),
    ).rejects.toThrow('Access denied.')
  })

  it('Cannot create manual attendance for unapproved student (throws 409)', async () => {
    const { domainStore, providers } = createTestEnvironment()
    await setupStudentAttendance(domainStore, 'student-pending')

    // Set student to pending
    domainStore.profiles.set('student-pending', {
      user_id: 'student-pending',
      full_name: 'Pending Student',
      nis: '9999',
      role: 'student',
      lifecycle_status: 'pending',
    })

    await expect(
      createManualAttendance({
        userId: 'student-pending',
        actionType: 'check_in',
        status: 'Hadir',
        reason: 'Manual attendance for pending student',
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      }),
    ).rejects.toThrow('Cannot record manual attendance for student who is not approved.')
  })

  it('Referencing non-existent attempt throws 404', async () => {
    const { domainStore, providers } = createTestEnvironment()
    await setupStudentAttendance(domainStore, 'student-1')

    await expect(
      createManualAttendance({
        userId: 'student-1',
        actionType: 'check_in',
        status: 'Hadir',
        reason: 'Test non-existent attempt',
        attemptId: 'non-existent-attempt-id',
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      }),
    ).rejects.toThrow('Referenced attendance attempt not found.')
  })

  it('Referencing attempt of a different student throws 422', async () => {
    const { domainStore, providers } = createTestEnvironment()
    await setupStudentAttendance(domainStore, 'student-1')
    await setupStudentAttendance(domainStore, 'student-2')

    const attemptStudent2 = await domainStore.recordAttendanceAttempt({
      userId: 'student-2',
      actionType: 'check_in',
      status: 'failed',
      reason: 'Failed face check',
    })

    await expect(
      createManualAttendance({
        userId: 'student-1',
        actionType: 'check_in',
        status: 'Hadir',
        reason: 'Wrong student attempt',
        attemptId: attemptStudent2.id,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      }),
    ).rejects.toThrow('Validation failed.')
  })

  it('Rejects an attempt for a different attendance action', async () => {
    const { domainStore, providers } = createTestEnvironment()
    await setupStudentAttendance(domainStore, 'student-1')
    const checkInAttempt = await domainStore.recordAttendanceAttempt({
      userId: 'student-1',
      actionType: 'check_in',
      status: 'failed',
      reason: 'Face verification failed',
    })

    await expect(
      createManualAttendance({
        userId: 'student-1',
        actionType: 'check_out',
        status: 'Pulang',
        reason: 'Manual checkout after verification failure',
        attemptId: checkInAttempt.id,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      }),
    ).rejects.toThrow('Validation failed.')
  })

  it('requires a failed/error attempt on the same WIB calendar date', async () => {
    const { domainStore, providers } = createTestEnvironment()
    await setupStudentAttendance(domainStore, 'student-1')
    const boundaryAttempt = await domainStore.recordAttendanceAttempt({
      userId: 'student-1',
      actionType: 'check_in',
      status: 'error',
      reason: 'Camera unavailable',
    })
    const attemptIndex = domainStore.attendanceAttempts.findIndex(
      (attempt) => attempt.id === boundaryAttempt.id,
    )
    domainStore.attendanceAttempts[attemptIndex] = {
      ...boundaryAttempt,
      created_at: '2026-08-21T17:00:00.000Z',
    }

    const record = await createManualAttendance({
      userId: 'student-1',
      actionType: 'check_in',
      status: 'Hadir',
      date: '2026-08-22',
      reason: 'Verified in person after camera outage',
      attemptId: boundaryAttempt.id,
      actorId: 'school-admin-1',
      actorRole: 'school_admin',
      providers,
    })
    expect(record.date).toBe('2026-08-22')

    const previousDayAttempt = await domainStore.recordAttendanceAttempt({
      userId: 'student-1',
      actionType: 'check_in',
      status: 'failed',
      reason: 'Attempt one second before WIB midnight',
    })
    const previousIndex = domainStore.attendanceAttempts.findIndex(
      (attempt) => attempt.id === previousDayAttempt.id,
    )
    domainStore.attendanceAttempts[previousIndex] = {
      ...previousDayAttempt,
      created_at: '2026-08-21T16:59:59.999Z',
    }

    await expect(
      createManualAttendance({
        userId: 'student-1',
        actionType: 'check_in',
        status: 'Hadir',
        date: '2026-08-22',
        reason: 'Invalid previous-day attempt',
        attemptId: previousDayAttempt.id,
        actorId: 'school-admin-1',
        actorRole: 'school_admin',
        providers,
      }),
    ).rejects.toThrow('Validation failed.')
    expect(await domainStore.listAttendances({ userId: 'student-1' })).toHaveLength(1)
  })

  it('Rejects a successful attendance attempt for manual attendance', async () => {
    const { domainStore, providers } = createTestEnvironment()
    await setupStudentAttendance(domainStore, 'student-1')
    const successfulAttempt = await domainStore.recordAttendanceAttempt({
      userId: 'student-1',
      actionType: 'check_in',
      status: 'success',
      reason: 'Face verified successfully',
    })

    await expect(
      createManualAttendance({
        userId: 'student-1',
        actionType: 'check_in',
        status: 'Hadir',
        reason: 'Correct successful attempt',
        attemptId: successfulAttempt.id,
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      }),
    ).rejects.toThrow('Validation failed.')
  })

  it('listAttendanceAttempts and getAttendanceAttempt support querying and filtering', async () => {
    const { domainStore, providers } = createTestEnvironment()
    await setupStudentAttendance(domainStore, 'student-1')
    await setupStudentAttendance(domainStore, 'student-2')

    const a1 = await domainStore.recordAttendanceAttempt({
      userId: 'student-1',
      actionType: 'check_in',
      status: 'success',
    })
    const a2 = await domainStore.recordAttendanceAttempt({
      userId: 'student-1',
      actionType: 'check_out',
      status: 'failed',
    })
    await domainStore.recordAttendanceAttempt({
      userId: 'student-2',
      actionType: 'check_in',
      status: 'error',
    })

    // Filter by user and status
    const student1Failed = await listAttendanceAttempts({
      filter: { userId: 'student-1', status: 'failed' },
      actorRole: 'school_admin',
      providers,
    })
    expect(student1Failed).toHaveLength(1)
    expect(student1Failed[0].id).toBe(a2.id)

    // Get single
    const fetched = await getAttendanceAttempt({
      id: a1.id,
      actorRole: 'teacher',
      providers,
    })
    expect(fetched.id).toBe(a1.id)
    expect(fetched.status).toBe('success')
  })
})
