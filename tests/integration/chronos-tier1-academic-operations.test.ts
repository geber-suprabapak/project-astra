import { describe, expect, it } from 'vitest'
import type { JWTPayload } from 'jose'
import { createApp } from '../../src/app.js'
import { AppError } from '../../src/lib/errors/app-error.js'
import { addDaysYmd } from '../../src/providers/shared/academic-batch.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../src/providers/memory/index.js'
import type { RobinClient } from '../../src/clients/robin/client.js'

const robinClient: RobinClient = {
  checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
  getEnrollmentStatus: async () => ({ status: 'enrolled', embeddingCount: 1, message: 'Ready' }),
  enroll: async () => ({ imagesProcessed: 1, imagesFailed: 0, totalEmbeddings: 1 }),
  identify: async () => ({
    status: 'ok',
    confidence: 0.96,
    qualityScore: 0.95,
    processTimeMs: 12,
    message: 'Match',
  }),
  deleteEnrollment: async () => {},
}

function tokenFor(payload: JWTPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${encodedPayload}.signature`
}

function wibToday(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function setupEnvironment() {
  const domainStore = new MemoryDomainStore()
  const identityProvider = new MemoryIdentityProvider()
  domainStore.profiles.set('school-admin-1', {
    user_id: 'school-admin-1',
    full_name: 'Admin Sekolah',
    email: 'admin@smkn2.sch.id',
    role: 'school_admin',
    lifecycle_status: 'approved',
  })
  domainStore.profiles.set('student-bound-1', {
    user_id: 'student-bound-1',
    full_name: 'Ahmad Rizky',
    email: 'ahmad@smkn2.sch.id',
    nis: '10001',
    role: 'student',
    lifecycle_status: 'approved',
    gender: 'L',
  })

  const app = createApp({
    providers: {
      domainStore,
      identityProvider,
      objectStorage: new MemoryObjectStorage(),
      robinClient,
    },
  })

  const adminToken = tokenFor({
    sub: 'school-admin-1',
    roles: ['school_admin'],
    scope: 'openid profile admin:read admin:write',
    mfa_verified: true,
    must_change_password: false,
  })
  const studentToken = tokenFor({
    sub: 'student-bound-1',
    roles: ['student'],
    scope: 'openid profile attendance:write',
  })

  return { app, domainStore, adminToken, studentToken }
}

describe('integration: Chronos Tier 1 Academic Operations & Holiday Calendar', () => {
  it('enforces activation guard, period lock/override, unbound student transitions, and batch progression', async () => {
    const { app, domainStore, adminToken } = setupEnvironment()

    const activePeriod = await domainStore.createAcademicPeriod({
      name: '2026/2027 Genap',
      startDate: '2027-01-01',
      endDate: '2027-06-30',
      isActive: true,
    })
    const cls10 = await domainStore.createClass({
      name: 'X RPL 1',
      grade: 10,
      academicPeriodId: activePeriod.id,
    })
    const cls10B = await domainStore.createClass({
      name: 'X RPL 2',
      grade: 10,
      academicPeriodId: activePeriod.id,
    })
    const cls12 = await domainStore.createClass({
      name: 'XII RPL 1',
      grade: 12,
      academicPeriodId: activePeriod.id,
    })

    const boundStudent = await domainStore.createStudent({
      nis: '10001',
      fullName: 'Ahmad Rizky',
      gender: 'L',
    })
    await domainStore.bindStudentToUser({
      studentId: boundStudent.id,
      userId: 'student-bound-1',
    })
    const unboundStudent = await domainStore.createStudent({
      nis: '10002',
      fullName: 'Dewi Lestari',
      gender: 'P',
    })
    const graduatingStudent = await domainStore.createStudent({
      nis: '10003',
      fullName: 'Raka Pratama',
      gender: 'L',
    })

    const headers = {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    }

    // Enroll bound & unbound students using student_id
    const enrollBoundRes = await app.request('/v1/admin/enrollments', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        student_id: boundStudent.id,
        class_id: cls10.id,
        academic_period_id: activePeriod.id,
        absence_number: '1',
      }),
    })
    expect(enrollBoundRes.status).toBe(201)

    // Duplicate absence_number in same class returns 409 ABSENCE_NUMBER_CONFLICT
    const dupAbsRes = await app.request('/v1/admin/enrollments', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        student_id: unboundStudent.id,
        class_id: cls10.id,
        academic_period_id: activePeriod.id,
        absence_number: '1',
      }),
    })
    expect(dupAbsRes.status).toBe(409)
    expect((await dupAbsRes.json()).error.details.reason_code).toBe('ABSENCE_NUMBER_CONFLICT')

    // Unbound student enroll + transfer preserves user_id=null
    const enrollUnboundRes = await app.request('/v1/admin/enrollments', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        student_id: unboundStudent.id,
        class_id: cls10.id,
        academic_period_id: activePeriod.id,
        absence_number: '2',
      }),
    })
    expect(enrollUnboundRes.status).toBe(201)
    expect((await enrollUnboundRes.json()).data.user_id).toBeNull()

    const enrollGradRes = await app.request('/v1/admin/enrollments', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        student_id: graduatingStudent.id,
        class_id: cls12.id,
        academic_period_id: activePeriod.id,
        absence_number: '1',
      }),
    })
    expect(enrollGradRes.status).toBe(201)

    // Create next period (defaults to draft is_active=false)
    const nextPeriodRes = await app.request('/v1/admin/academic-periods', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: '2027/2028 Ganjil',
        start_date: '2027-07-01',
        end_date: '2027-12-31',
      }),
    })
    expect(nextPeriodRes.status).toBe(201)
    const nextPeriod = (await nextPeriodRes.json()).data
    expect(nextPeriod.is_active).toBe(false)

    // Non-bootstrap set-active on empty period fails with PERIOD_NOT_READY_FOR_ACTIVATION
    const emptyActivateRes = await app.request(
      `/v1/admin/academic-periods/${nextPeriod.id}/set-active`,
      { method: 'POST', headers },
    )
    expect(emptyActivateRes.status).toBe(409)
    expect((await emptyActivateRes.json()).error.details.reason_code).toBe(
      'PERIOD_NOT_READY_FOR_ACTIVATION',
    )

    // Deactivating currently active period is rejected
    const deactivateRes = await app.request(`/v1/admin/academic-periods/${activePeriod.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ is_active: false }),
    })
    expect(deactivateRes.status).toBe(409)
    expect((await deactivateRes.json()).error.details.reason_code).toBe(
      'CANNOT_DEACTIVATE_ACTIVE_PERIOD',
    )

    // Lock activePeriod -> edits/transfers require override_locked + reason
    const lockRes = await app.request(`/v1/admin/academic-periods/${activePeriod.id}/lock`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason: 'Rapor semester genap sudah ditutup' }),
    })
    expect(lockRes.status).toBe(200)
    expect((await lockRes.json()).data.is_locked).toBe(true)

    const blockedTransfer = await app.request('/v1/admin/enrollments/transfer', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        student_id: unboundStudent.id,
        to_class_id: cls10B.id,
        academic_period_id: activePeriod.id,
      }),
    })
    expect(blockedTransfer.status).toBe(409)
    expect((await blockedTransfer.json()).error.details.reason_code).toBe('PERIOD_LOCKED')

    const overrideTransfer = await app.request('/v1/admin/enrollments/transfer', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        student_id: unboundStudent.id,
        to_class_id: cls10B.id,
        academic_period_id: activePeriod.id,
        override_locked: true,
        reason: 'Koreksi pindah kelas terlambat',
      }),
    })
    expect(overrideTransfer.status).toBe(200)
    const transferData = (await overrideTransfer.json()).data
    expect(transferData.previous.status).toBe('transferred')
    expect(transferData.current.class_id).toBe(cls10B.id)
    expect(transferData.current.user_id).toBeNull()

    // Create target classes in nextPeriod
    const cls11A = await domainStore.createClass({
      name: 'XI RPL 1',
      grade: 11,
      academicPeriodId: nextPeriod.id,
    })
    const cls11B = await domainStore.createClass({
      name: 'XI RPL 2',
      grade: 11,
      academicPeriodId: nextPeriod.id,
    })
    const cls10Retain = await domainStore.createClass({
      name: 'X RPL 1',
      grade: 10,
      academicPeriodId: nextPeriod.id,
    })

    // Preview batch promotion (Genap -> Ganjil) with retain override on unbound student
    const previewRes = await app.request('/v1/admin/enrollments/batch-transition/preview', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from_academic_period_id: activePeriod.id,
        to_academic_period_id: nextPeriod.id,
        mode: 'promote_to_next_year',
        overrides: [
          {
            student_id: unboundStudent.id,
            action: 'retain',
            to_class_id: cls10Retain.id,
            reason: 'Tinggal kelas',
          },
        ],
      }),
    })
    expect(previewRes.status).toBe(200)
    const preview = (await previewRes.json()).data
    expect(preview.requires_lock_override).toBe(true)
    expect(preview.summary).toMatchObject({
      total: 3,
      promoted: 1,
      retained: 1,
      graduated: 1,
      conflicts: 0,
    })
    expect(cls11A.id).toBeDefined()
    expect(cls11B.id).toBeDefined()

    // Commit without override_locked fails with PERIOD_LOCKED
    const lockedCommitRes = await app.request('/v1/admin/enrollments/batch-transition/commit', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from_academic_period_id: activePeriod.id,
        to_academic_period_id: nextPeriod.id,
        mode: 'promote_to_next_year',
        overrides: [
          {
            student_id: unboundStudent.id,
            action: 'retain',
            to_class_id: cls10Retain.id,
          },
        ],
        source_hash: preview.source_hash,
      }),
    })
    expect(lockedCommitRes.status).toBe(409)
    expect((await lockedCommitRes.json()).error.details.reason_code).toBe('PERIOD_LOCKED')

    // Stale source_hash fails with STALE_PREVIEW
    const staleCommitRes = await app.request('/v1/admin/enrollments/batch-transition/commit', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from_academic_period_id: activePeriod.id,
        to_academic_period_id: nextPeriod.id,
        mode: 'promote_to_next_year',
        overrides: [
          {
            student_id: unboundStudent.id,
            action: 'retain',
            to_class_id: cls10Retain.id,
          },
        ],
        source_hash: '0000000000000000000000000000000000000000000000000000000000000000',
        override_locked: true,
        reason: 'Kenaikan kelas akhir tahun',
      }),
    })
    expect(staleCommitRes.status).toBe(409)
    expect((await staleCommitRes.json()).error.details.reason_code).toBe('STALE_PREVIEW')

    // Valid commit succeeds
    const commitRes = await app.request('/v1/admin/enrollments/batch-transition/commit', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from_academic_period_id: activePeriod.id,
        to_academic_period_id: nextPeriod.id,
        mode: 'promote_to_next_year',
        overrides: [
          {
            student_id: unboundStudent.id,
            action: 'retain',
            to_class_id: cls10Retain.id,
          },
        ],
        source_hash: preview.source_hash,
        override_locked: true,
        reason: 'Kenaikan kelas akhir tahun',
      }),
    })
    expect(commitRes.status).toBe(200)
    expect((await commitRes.json()).data).toMatchObject({
      created_count: 2,
      closed_count: 3,
    })

    // Now nextPeriod has active enrollments + global default schedules -> set-active succeeds and updates bound student's profile.class_name
    const activateRes = await app.request(
      `/v1/admin/academic-periods/${nextPeriod.id}/set-active`,
      { method: 'POST', headers },
    )
    expect(activateRes.status).toBe(200)
    expect((await domainStore.getUserProfile('student-bound-1')).class_name).toBe('XI RPL 1')

    // Delete unused empty class succeeds; deleting populated class fails with CLASS_IN_USE
    const emptyClass = await domainStore.createClass({
      name: 'XII RPL 9',
      grade: 12,
      academicPeriodId: nextPeriod.id,
    })
    const deleteEmptyRes = await app.request(`/v1/admin/classes/${emptyClass.id}`, {
      method: 'DELETE',
      headers,
    })
    expect(deleteEmptyRes.status).toBe(200)

    const deleteUsedRes = await app.request(`/v1/admin/classes/${cls11A.id}`, {
      method: 'DELETE',
      headers,
    })
    expect(deleteUsedRes.status).toBe(409)
    expect((await deleteUsedRes.json()).error.details.reason_code).toBe('CLASS_IN_USE')
  })

  it('handles range holidays, attendance/leave conflicts, transactional holiday guard, and 14-day dashboard upcoming_holidays', async () => {
    const { app, domainStore, adminToken, studentToken } = setupEnvironment()
    const today = wibToday()
    const tomorrow = addDaysYmd(today, 1)
    const dayAfter = addDaysYmd(today, 2)
    const day15 = addDaysYmd(today, 15)

    const period = await domainStore.createAcademicPeriod({
      name: '2026/2027 Ganjil',
      startDate: addDaysYmd(today, -30),
      endDate: addDaysYmd(today, 60),
      isActive: true,
    })
    const cls = await domainStore.createClass({
      name: 'XI RPL 1',
      grade: 11,
      academicPeriodId: period.id,
    })
    await domainStore.enrollStudentInClass({
      userId: 'student-bound-1',
      classId: cls.id,
      academicPeriodId: period.id,
    })
    await domainStore.saveFaceEnrollment({
      userId: 'student-bound-1',
      status: 'enrolled',
      sampleCount: 5,
    })

    // Seed an existing attendance on tomorrow to trigger conflict detection
    await domainStore.insertAttendance({
      user_id: 'student-bound-1',
      date: tomorrow,
      status: 'Hadir',
    })

    const adminHeaders = {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    }

    // Range > 90 days fails 422
    const tooLongRes = await app.request('/v1/admin/calendar-exceptions/range', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        start_date: today,
        end_date: addDaysYmd(today, 95),
        reason: 'Terlalu panjang',
      }),
    })
    expect(tooLongRes.status).toBe(422)

    // Range overlapping tomorrow returns 409 CALENDAR_CONFLICT
    const conflictRes = await app.request('/v1/admin/calendar-exceptions/range', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        start_date: tomorrow,
        end_date: dayAfter,
        reason: 'Libur Semester',
      }),
    })
    expect(conflictRes.status).toBe(409)
    const conflictBody = await conflictRes.json()
    expect(conflictBody.error.details.reason_code).toBe('CALENDAR_CONFLICT')
    expect(conflictBody.error.details.conflicting_dates).toContain(tomorrow)

    // Override conflict succeeds with shared group_id
    const overrideRes = await app.request('/v1/admin/calendar-exceptions/range', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        start_date: tomorrow,
        end_date: dayAfter,
        reason: 'Libur Semester',
        override_conflicts: true,
        override_reason: 'Penetapan libur mendadak dari dinas',
      }),
    })
    expect(overrideRes.status).toBe(201)
    const rangeData = (await overrideRes.json()).data
    expect(rangeData.group_id).toBeTruthy()
    expect(rangeData.items).toHaveLength(2)

    // Global holiday on today + period holiday on day15 (outside 14d window)
    await app.request('/v1/admin/calendar-exceptions', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        date: today,
        reason: 'Hari Pendidikan Nasional',
        is_holiday: true,
      }),
    })
    await app.request('/v1/admin/calendar-exceptions', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        academic_period_id: period.id,
        date: day15,
        reason: 'Di luar jendela 14 hari',
        is_holiday: true,
      }),
    })

    // Period-specific is_holiday=false cancels global holiday on dayAfter
    await app.request('/v1/admin/calendar-exceptions', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        academic_period_id: period.id,
        date: dayAfter,
        reason: 'Masuk khusus',
        is_holiday: false,
      }),
    })

    // Dashboard shows CALENDAR_HOLIDAY for today and only tomorrow in upcoming_holidays (dayAfter overridden to false, day15 > 14d)
    const dashRes = await app.request('/v1/mobile/dashboard', {
      headers: { Authorization: `Bearer ${studentToken}` },
    })
    expect(dashRes.status).toBe(200)
    const dashData = (await dashRes.json()).data
    expect(dashData.primary_action.reason_code).toBe('CALENDAR_HOLIDAY')
    expect(dashData.primary_action.reason_message).toBe('Hari Pendidikan Nasional')
    expect(dashData.upcoming_holidays).toEqual([
      {
        date: tomorrow,
        reason: 'Libur Semester',
        group_id: rangeData.group_id,
      },
    ])

    // Mobile precheck & submit emit CALENDAR_HOLIDAY
    const precheckRes = await app.request('/v1/mobile/attendance/precheck', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ latitude: -6.2, longitude: 106.816666 }),
    })
    expect(precheckRes.status).toBe(200)
    const precheckData = (await precheckRes.json()).data
    expect(precheckData.allowed).toBe(false)
    expect(precheckData.reason_code).toBe('CALENDAR_HOLIDAY')

    // saveAttendanceRecord directly rejects on holiday (TOCTOU protection)
    await expect(
      domainStore.saveAttendanceRecord({
        userId: 'student-bound-1',
        actionType: 'check_in',
        latitude: -6.2,
        longitude: 106.816666,
      }),
    ).rejects.toThrow(AppError)

    // Delete holiday group cleans up both range rows
    const deleteGroupRes = await app.request(
      `/v1/admin/calendar-exceptions/group/${rangeData.group_id}`,
      { method: 'DELETE', headers: adminHeaders },
    )
    expect(deleteGroupRes.status).toBe(200)
    expect((await deleteGroupRes.json()).data.deleted_count).toBe(2)
  })
})
