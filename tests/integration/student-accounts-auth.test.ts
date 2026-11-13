import { describe, expect, it } from 'vitest'
import { OidcIdentityProvider } from '../../src/providers/identity/oidc-identity.js'
import { MemoryDomainStore, MemoryIdentityProvider } from '../../src/providers/memory/index.js'
import {
  OIDC_SECRET,
  createTestApp,
  schoolAdminToken,
  signedOidcToken,
  tokenFor,
} from './helpers/student-accounts-fixture.js'

describe('integration: student onboarding, auth, and password recovery (Ticket 06)', () => {
  it('validates signed OIDC tokens across the student authentication flow', async () => {
    const identityProvider = new OidcIdentityProvider({
      jwtSecret: OIDC_SECRET,
      issuer: 'http://logto.test/oidc',
      audience: 'astra-api',
    })
    const domainStore = new MemoryDomainStore()
    const app = createTestApp(domainStore, identityProvider)

    domainStore.profiles.set('student-oidc-1', {
      user_id: 'student-oidc-1',
      nis: '8001',
      full_name: 'OIDC Student',
      email: 'oidc.student@school.sch.id',
      role: 'student',
      lifecycle_status: 'approved',
      gender: null,
    })

    const signedToken = await signedOidcToken({
      sub: 'student-oidc-1',
      scope: 'openid profile mobile:access',
    })

    const dashboardRes = await app.request('/v1/mobile/dashboard', {
      headers: { Authorization: `Bearer ${signedToken}` },
    })
    expect(dashboardRes.status).toBe(200)
  })

  it('omits student email for teacher/staff on GET /v1/admin/students (A01) and preserves reset code when updatePassword fails (M03a)', async () => {
    const domainStore = new MemoryDomainStore()
    const identityProvider = new MemoryIdentityProvider()
    const app = createTestApp(domainStore, identityProvider)

    domainStore.profiles.set('admin-1', {
      user_id: 'admin-1',
      full_name: 'School Admin',
      email: 'admin@school.sch.id',
      role: 'school_admin',
      lifecycle_status: 'approved',
    })
    domainStore.profiles.set('teacher-1', {
      user_id: 'teacher-1',
      full_name: 'Homeroom Teacher',
      email: 'teacher@school.sch.id',
      role: 'teacher',
      lifecycle_status: 'approved',
    })
    domainStore.profiles.set('student-a01', {
      user_id: 'student-a01',
      nis: '9001',
      full_name: 'Student A01',
      email: 'student.a01@school.sch.id',
      role: 'student',
      lifecycle_status: 'approved',
    })
    await domainStore.createStudent({
      nis: '9001',
      fullName: 'Student A01',
      gender: 'L',
      actorId: 'admin-1',
    })
    const roster = await domainStore.getRosterStudentByNis('9001')
    if (roster?.student_id) {
      await domainStore.bindStudentToUser({
        studentId: roster.student_id,
        userId: 'student-a01',
      })
    }

    const adminToken = tokenFor({
      sub: 'admin-1',
      roles: ['school_admin'],
      scope: 'openid profile admin:read',
      must_change_password: false,
      mfa_verified: true,
    })
    const teacherToken = tokenFor({
      sub: 'teacher-1',
      roles: ['teacher'],
      scope: 'openid profile admin:read',
      must_change_password: false,
      mfa_verified: true,
    })

    const adminListRes = await app.request('/v1/admin/students', {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(adminListRes.status).toBe(200)
    // SAFETY: test assertion casts standard envelope response
    const adminListBody = (await adminListRes.json()) as {
      data: Array<{ email?: string; full_name?: string }>
    }
    expect(adminListBody.data[0]?.email).toBe('student.a01@school.sch.id')

    const teacherListRes = await app.request('/v1/admin/students', {
      headers: { Authorization: `Bearer ${teacherToken}` },
    })
    expect(teacherListRes.status).toBe(200)
    // SAFETY: test assertion casts standard envelope response
    const teacherListBody = (await teacherListRes.json()) as {
      data: Array<{ email?: string; full_name?: string }>
    }
    expect(teacherListBody.data[0]?.full_name).toBe('Student A01')
    expect('email' in (teacherListBody.data[0] ?? {})).toBe(false)

    // M03a: if updatePassword throws 500 on first try, the one-time reset code remains usable on retry
    const resetCodeRes = await app.request('/v1/admin/students/student-a01/reset-code', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(resetCodeRes.status).toBe(201)
    // SAFETY: test assertion casts standard envelope response
    const resetCodeBody = (await resetCodeRes.json()) as { data: { code: string } }

    const origUpdatePassword = identityProvider.updatePassword.bind(identityProvider)
    let shouldFail = true
    identityProvider.updatePassword = async (userId: string, newPassword: string) => {
      if (shouldFail) {
        shouldFail = false
        throw new Error('Transient IdP failure')
      }
      return origUpdatePassword(userId, newPassword)
    }

    const firstReset = await app.request('/v1/auth/student/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nis: '9001',
        code: resetCodeBody.data.code,
        new_password: 'NewPassword123!',
      }),
    })
    expect(firstReset.status).toBe(500)

    const retryReset = await app.request('/v1/auth/student/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nis: '9001',
        code: resetCodeBody.data.code,
        new_password: 'NewPassword123!',
      }),
    })
    expect(retryReset.status).toBe(200)
  })

  it('enforces bootstrap password on signup, releases NIS on rejection, and verifies current_password on /v1/auth/password', async () => {
    const domainStore = new MemoryDomainStore()
    const identityProvider = new MemoryIdentityProvider()
    const app = createTestApp(domainStore, identityProvider)

    await domainStore.createSchool({
      name: 'SMK Negeri 2 Banjarmasin',
      slug: 'smkn2bjm',
      timezone: 'Asia/Jakarta',
    })
    const stagedReport = await domainStore.stageRosterReport({
      academicPeriodId: 'b0000000-0000-0000-0000-000000000001',
      totalRows: 1,
      validRows: 1,
      rejectedRows: 0,
      status: 'staged',
      reviewState: 'pending',
      rows: [
        {
          nis: '5501',
          full_name: 'Budi Santoso',
          class_name: 'XII RPL 1',
          grade: 12,
          gender: 'L',
          absence_number: 1,
          class_id: 'c0000000-0000-0000-0000-000000000001',
        },
      ],
      rejectedItems: [],
    })
    await domainStore.acceptRosterReport(stagedReport.id, 'school-admin-1')
    const openRes = await app.request('/v1/admin/bootstrap/signup/open', {
      method: 'POST',
      headers: { Authorization: `Bearer ${schoolAdminToken}` },
    })
    expect(openRes.status).toBe(200)

    // 1. Squatting/unverified signup does not plant caller-chosen password
    const callerPassword = 'AttackerChosenPassword999!'
    const signup1Res = await app.request('/v1/auth/student/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nis: '5501',
        email: 'squatter@school.sch.id',
        password: callerPassword,
      }),
    })
    expect(signup1Res.status).toBe(201)
    // SAFETY: test assertion casts standard envelope response
    const signup1Body = (await signup1Res.json()) as { data: { user_id: string } }
    expect(identityProvider.passwords.get('squatter@school.sch.id')).not.toBe(callerPassword)

    // 2. Admin rejects the squatted pending signup -> NIS is released for legitimate student
    const rejectRes = await app.request(`/v1/admin/students/${signup1Body.data.user_id}/reject`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${schoolAdminToken}` },
    })
    expect(rejectRes.status).toBe(200)

    const signup2Res = await app.request('/v1/auth/student/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nis: '5501',
        email: 'budi.santoso@school.sch.id',
        password: 'InitialSignupPassword123!',
      }),
    })
    expect(signup2Res.status).toBe(201)
    // SAFETY: test assertion casts standard envelope response
    const signup2Body = (await signup2Res.json()) as { data: { user_id: string } }

    // 3. Verify /v1/auth/password requires current_password and revokes Astra session
    identityProvider.passwords.set('principal@school.sch.id', 'OldAdminPass123!')
    const wrongCurrentRes = await app.request('/v1/auth/password', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${schoolAdminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        current_password: 'WrongPassword123!',
        new_password: 'UpdatedAdminPassword456!',
      }),
    })
    expect(wrongCurrentRes.status).toBe(401)

    const validChangeRes = await app.request('/v1/auth/password', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${schoolAdminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        current_password: 'OldAdminPass123!',
        new_password: 'UpdatedAdminPassword456!',
      }),
    })
    expect(validChangeRes.status).toBe(200)
    expect(await domainStore.isSessionRevoked('school-admin-1')).toBe(true)
    expect(signup2Body.data.user_id).not.toBe(signup1Body.data.user_id)
  })
})
