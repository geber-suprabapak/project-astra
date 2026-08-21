import { describe, expect, it } from 'vitest'
import { submit } from '../../../src/modules/attendance/service.js'
import {
  createManualAttendance,
  listAttendanceAttempts,
  getAttendanceAttempt,
} from '../../../src/modules/admin/service.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { RobinClient } from '../../../src/clients/robin/client.js'
import type { AppProviders } from '../../../src/providers/types.js'
import { AppError } from '../../../src/lib/errors/app-error.js'

function createTestEnvironment(customRobinClient?: Partial<RobinClient>) {
  const domainStore = new MemoryDomainStore()
  const identityProvider = new MemoryIdentityProvider()
  const objectStorage = new MemoryObjectStorage()

  const defaultRobinClient: RobinClient = {
    checkReadiness: async () => ({ healthy: true }),
    getEnrollmentStatus: async () => ({
      status: 'enrolled',
      embeddingCount: 10,
      message: 'Ready.',
    }),
    enroll: async () => ({ imagesProcessed: 10, imagesFailed: 0, totalEmbeddings: 10 }),
    identify: async () => ({
      status: 'ok',
      confidence: 0.95,
      qualityScore: 0.92,
      processTimeMs: 45,
      message: 'Face verified successfully',
    }),
    deleteEnrollment: async () => {},
  }

  // SAFETY: test environment merges defaultRobinClient and partial override to form valid RobinClient
  const robinClient = { ...defaultRobinClient, ...customRobinClient } as RobinClient

  const providers: AppProviders = {
    domainStore,
    identityProvider,
    objectStorage,
    robinClient,
  }

  return { domainStore, identityProvider, objectStorage, robinClient, providers }
}

async function setupStudentAttendance(domainStore: MemoryDomainStore, studentId = 'student-1') {
  // 1. School
  await domainStore.createSchool({
    name: 'SMK Negeri 2 Banjarmasin',
    slug: 'smkn2-bjm',
  })

  // 2. Academic Period (covers current year/month)
  const period = await domainStore.createAcademicPeriod({
    name: '2026/2027 Ganjil',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    isActive: true,
  })

  // 3. Class
  const classRoom = await domainStore.createClass({
    name: 'XII RPL 1',
    academicPeriodId: period.id,
    grade: 12,
  })

  // 4. Student profile
  domainStore.profiles.set(studentId, {
    user_id: studentId,
    full_name: 'Budi Santoso',
    nis: '1001',
    class_name: 'XII RPL 1',
    role: 'student',
    lifecycle_status: 'approved',
    gender: 'L',
  })

  // 5. Class Enrollment
  await domainStore.enrollStudentInClass({
    userId: studentId,
    classId: classRoom.id,
    academicPeriodId: period.id,
  })

  // 6. Geofence location (-6.2, 106.816666 with 5000m radius)
  await domainStore.createLocation({
    name: 'Main Campus',
    latitude: -6.2,
    longitude: 106.816666,
    radiusMeters: 5000,
    isActive: true,
  })

  // 7. Schedule for all days with broad windows
  const days = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu']
  for (const day of days) {
    await domainStore.createSchedule({
      dayOfWeek: day,
      startTime: '00:00:00',
      endTime: '23:59:59',
      startCheckout: '00:00:00',
      endCheckout: '23:59:59',
      gracePeriodMinutes: 30,
      isActive: true,
      classId: classRoom.id,
      academicPeriodId: period.id,
    })
  }

  // 8. Face enrollment
  await domainStore.saveFaceEnrollment({
    userId: studentId,
    status: 'enrolled',
    sampleCount: 10,
  })

  return { period, classRoom }
}

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
  })

  it('Authorized teacher creates manual attendance successfully', async () => {
    const { domainStore, providers } = createTestEnvironment()
    await setupStudentAttendance(domainStore, 'student-1')

    const manualRecord = await createManualAttendance({
      userId: 'student-1',
      actionType: 'check_in',
      status: 'Hadir',
      reason: 'Manual check-in by homeroom teacher',
      actorId: 'teacher-1',
      actorRole: 'teacher',
      providers,
    })

    expect(manualRecord.status).toBe('Hadir')
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
