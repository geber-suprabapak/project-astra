import { describe, expect, it } from 'vitest'
import type { JWTPayload } from 'jose'
import type { RobinClient } from '../../src/clients/robin/client.js'
import { createApp } from '../../src/app.js'
import { createAdiwiyataRouter } from '../../src/modules/adiwiyata/routes.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../src/providers/memory/index.js'
import type { Schedule, UserProfile } from '../../src/providers/types.js'

const schoolId = '11111111-1111-1111-1111-111111111111'
const otherSchoolId = '22222222-2222-2222-2222-222222222222'
const periodId = 'b0000000-0000-0000-0000-000000000001'
const previousPeriodId = 'b0000000-0000-0000-0000-000000000002'
const classId = 'c0000000-0000-0000-0000-000000000001'
const nextClassId = 'c0000000-0000-0000-0000-000000000002'
const otherSchoolClassId = 'c0000000-0000-0000-0000-000000000003'
const userId = 'adiwiyata-student-1'
const studentId = 'student-record-1'
const wibWednesday = new Date('2026-09-29T20:00:00.000Z')

function tokenFor(payload: JWTPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${encodedPayload}.signature`
}

const adminToken = tokenFor({
  sub: 'eligibility-admin',
  roles: ['school_admin'],
  scope: 'openid profile mobile:access admin:read',
})
const adminWithoutScopeToken = tokenFor({
  sub: 'eligibility-admin',
  roles: ['school_admin'],
  scope: 'openid profile mobile:access',
})
const pendingAdminToken = tokenFor({
  sub: 'pending-eligibility-admin',
  roles: ['school_admin'],
  scope: 'openid profile mobile:access admin:read',
})
const studentAdminScopeToken = tokenFor({
  sub: userId,
  roles: ['school_admin'],
  scope: 'openid profile mobile:access admin:read',
})
const studentToken = tokenFor({
  sub: userId,
  roles: ['student'],
  scope: 'openid profile mobile:access',
})

function profile(overrides: Partial<UserProfile> & Pick<UserProfile, 'user_id'>): UserProfile {
  return {
    full_name: null,
    email: null,
    role: 'student',
    lifecycle_status: 'approved',
    ...overrides,
  }
}

function schedule(): Schedule {
  return {
    id: 'schedule-1',
    school_id: schoolId,
    class_id: classId,
    academic_period_id: periodId,
    day_of_week: 'rabu',
    hari: 'rabu',
    mulai_masuk: '06:00:00',
    selesai_masuk: '07:00:00',
    mulai_pulang: '12:00:00',
    selesai_pulang: '14:00:00',
    kompensasi_waktu: 0,
    is_active: true,
  }
}

function createEnvironment() {
  const domainStore = new MemoryDomainStore()
  domainStore.academicPeriods = [
    {
      id: periodId,
      school_id: schoolId,
      name: 'Tahun Ajaran 2026/2027 Ganjil',
      start_date: '2026-07-01',
      end_date: '2026-12-31',
      is_active: true,
    },
    {
      id: previousPeriodId,
      school_id: schoolId,
      name: 'Tahun Ajaran 2025/2026 Genap',
      start_date: '2026-01-01',
      end_date: '2026-06-30',
      is_active: false,
    },
  ]
  domainStore.classes = [
    { id: classId, school_id: schoolId, academic_period_id: periodId, name: 'XII RPL 1' },
    { id: nextClassId, school_id: schoolId, academic_period_id: periodId, name: 'XII RPL 2' },
    {
      id: otherSchoolClassId,
      school_id: otherSchoolId,
      academic_period_id: periodId,
      name: 'XI RPL 1',
    },
  ]
  domainStore.profiles.set(
    'eligibility-admin',
    profile({
      user_id: 'eligibility-admin',
      full_name: 'Admin Sekolah',
      role: 'school_admin',
    }),
  )
  domainStore.profiles.set(
    'pending-eligibility-admin',
    profile({
      user_id: 'pending-eligibility-admin',
      full_name: 'Admin Belum Disetujui',
      role: 'school_admin',
      lifecycle_status: 'pending',
    }),
  )
  domainStore.profiles.set(
    userId,
    profile({
      user_id: userId,
      full_name: 'Nama Profil Rani',
      email: 'rani@example.test',
      nis: '1001',
    }),
  )
  domainStore.students.set(studentId, {
    id: studentId,
    nis: '1001',
    full_name: 'Nama Lama di Roster',
    gender: 'P',
  })
  domainStore.studentBindings.set(studentId, { student_id: studentId, user_id: userId })
  domainStore.classEnrollments = [
    {
      id: 'enrollment-1',
      student_id: studentId,
      user_id: userId,
      class_id: classId,
      academic_period_id: periodId,
      status: 'active',
    },
  ]
  domainStore.schedules.set('schedule-1', schedule())

  const providers = {
    domainStore,
    objectStorage: new MemoryObjectStorage(),
    identityProvider: new MemoryIdentityProvider(),
    robinClient: {
      checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
      getEnrollmentStatus: async () => ({
        status: 'enrolled' as const,
        embeddingCount: 1,
        message: 'Ready.',
      }),
      enroll: async () => ({ imagesProcessed: 1, imagesFailed: 0, totalEmbeddings: 1 }),
      identify: async () => ({
        status: 'ok' as const,
        confidence: 0.9,
        qualityScore: 0.9,
        processTimeMs: 1,
      }),
      deleteEnrollment: async () => {},
    } satisfies RobinClient,
  }
  const app = createApp({
    providers,
    adiwiyataRouter: createAdiwiyataRouter({ providers, now: () => wibWednesday }),
  })
  return { app, domainStore }
}

async function request(
  app: ReturnType<typeof createApp>,
  path: string,
  token?: string,
  method = 'GET',
  body?: { user_id: string },
) {
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const init: RequestInit = { method, headers }
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json')
    init.body = JSON.stringify(body)
  }
  return app.request(path, init)
}

describe('integration: Adiwiyata student eligibility management', () => {
  it('authorizes admin:read and an approved Astra school administrator for every operation', async () => {
    const { app } = createEnvironment()
    expect((await request(app, '/v1/admin/adiwiyata/eligibility')).status).toBe(401)
    expect(
      (await request(app, '/v1/admin/adiwiyata/eligibility', adminWithoutScopeToken)).status,
    ).toBe(403)
    expect(
      (await request(app, '/v1/admin/adiwiyata/eligibility', studentAdminScopeToken)).status,
    ).toBe(403)
    expect((await request(app, '/v1/admin/adiwiyata/eligibility', pendingAdminToken)).status).toBe(
      403,
    )
    expect((await request(app, '/v1/admin/adiwiyata/eligibility', adminToken)).status).toBe(200)
    expect(
      (
        await request(app, '/v1/admin/adiwiyata/eligibility', studentAdminScopeToken, 'POST', {
          user_id: userId,
        })
      ).status,
    ).toBe(403)
  })

  it('searches the Astra roster by student name or profile email and shows the current enrollment class', async () => {
    const { app } = createEnvironment()
    const byName = await request(
      app,
      '/v1/admin/adiwiyata/eligibility?q=Nama%20Lama%20di%20Roster',
      adminToken,
    )
    expect(byName.status).toBe(200)
    const student = (await byName.json()).data.students[0]
    expect(student).toMatchObject({
      user_id: userId,
      full_name: 'Nama Lama di Roster',
      email: 'rani@example.test',
      current_class: { id: classId, name: 'XII RPL 1' },
      can_grant: true,
    })

    const byEmail = await request(
      app,
      '/v1/admin/adiwiyata/eligibility?q=rani%40example.test',
      adminToken,
    )
    expect(
      (await byEmail.json()).data.students.map((row: { user_id: string }) => row.user_id),
    ).toContain(userId)
  })

  it('rejects grants for non-students, unapproved profiles, missing or ambiguous current enrollment, and wrong-school classes', async () => {
    const { app, domainStore } = createEnvironment()
    domainStore.profiles.set(
      'pending-student',
      profile({ user_id: 'pending-student', lifecycle_status: 'pending' }),
    )
    domainStore.profiles.set('staff-user', profile({ user_id: 'staff-user', role: 'staff' }))
    domainStore.profiles.set('no-current-class', profile({ user_id: 'no-current-class' }))
    domainStore.classEnrollments.push({
      id: 'old-enrollment',
      user_id: 'no-current-class',
      class_id: classId,
      academic_period_id: previousPeriodId,
      status: 'active',
    })
    domainStore.profiles.set('ambiguous-student', profile({ user_id: 'ambiguous-student' }))
    domainStore.classEnrollments.push(
      {
        id: 'ambiguous-1',
        user_id: 'ambiguous-student',
        class_id: classId,
        academic_period_id: periodId,
        status: 'active',
      },
      {
        id: 'ambiguous-2',
        user_id: 'ambiguous-student',
        class_id: nextClassId,
        academic_period_id: periodId,
        status: 'active',
      },
    )
    domainStore.profiles.set('wrong-school-student', profile({ user_id: 'wrong-school-student' }))
    domainStore.classEnrollments.push({
      id: 'wrong-school-enrollment',
      user_id: 'wrong-school-student',
      class_id: otherSchoolClassId,
      academic_period_id: periodId,
      status: 'active',
    })

    for (const id of ['pending-student', 'staff-user', 'no-current-class']) {
      const rejected = await request(app, '/v1/admin/adiwiyata/eligibility', adminToken, 'POST', {
        user_id: id,
      })
      expect(rejected.status).toBe(422)
    }
    const ambiguous = await request(app, '/v1/admin/adiwiyata/eligibility', adminToken, 'POST', {
      user_id: 'ambiguous-student',
    })
    expect(ambiguous.status).toBe(503)
    const wrongSchool = await request(app, '/v1/admin/adiwiyata/eligibility', adminToken, 'POST', {
      user_id: 'wrong-school-student',
    })
    expect(wrongSchool.status).toBe(503)

    domainStore.academicPeriods.push({
      id: 'b0000000-0000-0000-0000-000000000003',
      school_id: schoolId,
      name: 'Duplicate active period',
      start_date: '2026-07-01',
      end_date: '2026-12-31',
      is_active: true,
    })
    const ambiguousPeriod = await request(
      app,
      '/v1/admin/adiwiyata/eligibility',
      adminToken,
      'POST',
      {
        user_id: userId,
      },
    )
    expect(ambiguousPeriod.status).toBe(503)
  })

  it('grants, revokes immediately, reactivates the same row, and follows an enrollment transfer', async () => {
    const { app, domainStore } = createEnvironment()
    expect((await request(app, '/v1/adiwiyata/dashboard', studentToken)).status).toBe(403)

    const grant = await request(app, '/v1/admin/adiwiyata/eligibility', adminToken, 'POST', {
      user_id: userId,
    })
    expect(grant.status).toBe(201)
    const row = (await grant.json()).data
    expect(row).toMatchObject({ user_id: userId, is_active: true })
    const firstDashboard = await request(app, '/v1/adiwiyata/dashboard', studentToken)
    expect((await firstDashboard.json()).data.class.name).toBe('XII RPL 1')

    const revoke = await request(
      app,
      `/v1/admin/adiwiyata/eligibility/${row.id}`,
      adminToken,
      'DELETE',
    )
    expect(revoke.status).toBe(200)
    expect((await revoke.json()).data.is_active).toBe(false)
    expect((await request(app, '/v1/adiwiyata/dashboard', studentToken)).status).toBe(403)

    const inactive = await request(app, '/v1/admin/adiwiyata/eligibility', adminToken)
    expect((await inactive.json()).data.eligibility).toContainEqual(
      expect.objectContaining({
        id: row.id,
        user_id: userId,
        is_active: false,
        added_by: 'eligibility-admin',
        created_at: row.created_at,
      }),
    )
    const regrant = await request(app, '/v1/admin/adiwiyata/eligibility', adminToken, 'POST', {
      user_id: userId,
    })
    expect(regrant.status).toBe(201)
    const reactivated = (await regrant.json()).data
    expect(reactivated.id).toBe(row.id)
    expect(reactivated.added_by).toBe('eligibility-admin')

    domainStore.classEnrollments[0]!.status = 'completed'
    domainStore.classEnrollments.push({
      id: 'enrollment-2',
      student_id: studentId,
      user_id: userId,
      class_id: nextClassId,
      academic_period_id: periodId,
      status: 'active',
    })
    const transferredDashboard = await request(app, '/v1/adiwiyata/dashboard', studentToken)
    expect((await transferredDashboard.json()).data.class.name).toBe('XII RPL 2')
    const transferredEligibility = await request(
      app,
      '/v1/admin/adiwiyata/eligibility?q=rani%40example.test',
      adminToken,
    )
    expect((await transferredEligibility.json()).data.students[0].current_class.name).toBe(
      'XII RPL 2',
    )

    domainStore.profiles.get(userId)!.role = 'teacher'
    const noLongerEligible = await request(app, '/v1/admin/adiwiyata/eligibility', adminToken)
    expect(noLongerEligible.status).toBe(200)
    expect((await noLongerEligible.json()).data.eligibility).toContainEqual(
      expect.objectContaining({
        id: row.id,
        current_class: null,
        can_grant: false,
        reason: 'not_student',
      }),
    )
    const revokeIneligible = await request(
      app,
      `/v1/admin/adiwiyata/eligibility/${row.id}`,
      adminToken,
      'DELETE',
    )
    expect(revokeIneligible.status).toBe(200)
    expect((await request(app, '/v1/adiwiyata/dashboard', studentToken)).status).toBe(403)
  })
})
