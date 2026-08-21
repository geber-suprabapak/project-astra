import { describe, expect, it } from 'vitest'
import { SignJWT, type JWTPayload } from 'jose'
import { createApp } from '../../src/app.js'
import { OidcIdentityProvider } from '../../src/providers/identity/oidc-identity.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../src/providers/memory/index.js'
import type { RobinClient } from '../../src/clients/robin/client.js'
import type { IdentityProvider } from '../../src/providers/types.js'

const mockRobinClient: RobinClient = {
  checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
  getEnrollmentStatus: async () => ({
    status: 'not_enrolled',
    embeddingCount: 0,
    message: 'No enrollment found.',
  }),
  enroll: async () => ({
    status: 'ok',
    userId: 'student-1',
    samplesReceived: 0,
    embeddingsCreated: 0,
    message: 'Enrollment complete.',
  }),
  identify: async () => ({
    status: 'no_match',
    candidateId: null,
    confidence: 0,
    threshold: 0.7,
    qualityScore: 0,
    processTimeMs: 0,
  }),
  deleteEnrollment: async () => {},
}

function tokenFor(payload: JWTPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${encodedPayload}.signature`
}

const OIDC_SECRET = 'test-secret-at-least-32-chars-long-12345'

async function signedOidcToken(
  claims: JWTPayload,
  audience = 'astra-api',
  expirationTime: string | number = '5m',
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('http://logto.test/oidc')
    .setAudience(audience)
    .setSubject(claims.sub ?? 'student-1')
    .setIssuedAt()
    .setExpirationTime(expirationTime)
    .sign(new TextEncoder().encode(OIDC_SECRET))
}

function createTestApp(
  domainStore = new MemoryDomainStore(),
  identityProvider: IdentityProvider = new MemoryIdentityProvider(),
) {
  // Pre-seed school admin
  domainStore.profiles.set('school-admin-1', {
    user_id: 'school-admin-1',
    full_name: 'School Admin',
    email: 'principal@school.sch.id',
    role: 'school_admin',
    lifecycle_status: 'approved',
    gender: null,
  })

  // Pre-seed platform admin
  domainStore.profiles.set('platform-admin-1', {
    user_id: 'platform-admin-1',
    full_name: 'Platform Admin',
    email: 'admin@school.sch.id',
    role: 'platform_admin',
    lifecycle_status: 'approved',
    gender: null,
  })

  return createApp({
    providers: {
      domainStore,
      objectStorage: new MemoryObjectStorage(),
      identityProvider,
      robinClient: mockRobinClient,
    },
  })
}

const schoolAdminToken = tokenFor({
  sub: 'school-admin-1',
  roles: ['school_admin'],
  scope: 'openid profile admin:read',
  must_change_password: false,
  mfa_verified: true,
})

describe('integration: student onboarding, approval, and recovery (Ticket 06)', () => {
  it('walks through complete student account lifecycle from signup to recovery', async () => {
    const domainStore = new MemoryDomainStore()
    const identityProvider = new MemoryIdentityProvider()
    const app = createTestApp(domainStore, identityProvider)

    // 1. Bootstrap school & staged roster
    await domainStore.createSchool({
      name: 'SMK Negeri 2 Banjarmasin',
      slug: 'smkn2bjm',
      timezone: 'Asia/Jakarta',
    })
    const stagedReport = await domainStore.stageRosterReport({
      totalRows: 2,
      validRows: 2,
      rejectedRows: 0,
      status: 'staged',
      reviewState: 'pending',
      rows: [
        { nis: '5001', full_name: 'Rian Pratama', class_name: 'XII RPL 1', grade: 12 },
        { nis: '5002', full_name: 'Siti Rahma', class_name: 'XII RPL 1', grade: 12 },
      ],
      rejectedItems: [],
    })
    await domainStore.acceptRosterReport(stagedReport.id, 'school-admin-1')

    // 2. Student attempts signup BEFORE signup is opened -> 409 Conflict
    const earlySignupRes = await app.request('/v1/auth/student/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nis: '5001',
        email: 'rian@school.sch.id',
        password: 'Password123!',
      }),
    })
    expect(earlySignupRes.status).toBe(409)

    // 3. School admin opens signup
    const openRes = await app.request('/v1/admin/bootstrap/signup/open', {
      method: 'POST',
      headers: { Authorization: `Bearer ${schoolAdminToken}` },
    })
    expect(openRes.status).toBe(200)

    // 4. Student attempts signup with invalid/unlisted NIS -> 422
    const invalidNisRes = await app.request('/v1/auth/student/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nis: '9999',
        email: 'invalid@school.sch.id',
        password: 'Password123!',
      }),
    })
    expect(invalidNisRes.status).toBe(422)

    // 5. Valid student signs up via public endpoint -> 201 Created with status 'pending'
    const signupRes = await app.request('/v1/auth/student/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nis: '5001',
        email: 'rian@school.sch.id',
        password: 'Password123!',
      }),
    })
    expect(signupRes.status).toBe(201)
    // SAFETY: Response JSON has standard envelope format
    const signupBody = (await signupRes.json()) as {
      success: boolean
      data: {
        user_id: string
        nis: string
        full_name: string
        email: string
        class_name: string
        role: string
        lifecycle_status: string
      }
    }
    expect(signupBody.data.nis).toBe('5001')
    expect(signupBody.data.full_name).toBe('Rian Pratama')
    expect(signupBody.data.class_name).toBe('XII RPL 1')
    expect(signupBody.data.role).toBe('student')
    expect(signupBody.data.lifecycle_status).toBe('pending')

    const studentUserId = signupBody.data.user_id

    // 6. Duplicate signup with same NIS fails with 409
    const dupSignupRes = await app.request('/v1/auth/student/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nis: '5001',
        email: 'rian2@school.sch.id',
        password: 'Password123!',
      }),
    })
    expect(dupSignupRes.status).toBe(409)

    // 7. Student token accessing dashboard BEFORE approval fails with 403 Forbidden
    const pendingStudentToken = tokenFor({
      sub: studentUserId,
      roles: ['student'],
      scope: 'openid profile',
    })
    const earlyDashboardRes = await app.request('/v1/mobile/dashboard', {
      headers: { Authorization: `Bearer ${pendingStudentToken}` },
    })
    expect(earlyDashboardRes.status).toBe(403)

    // 8. School admin lists pending students
    const pendingListRes = await app.request('/v1/admin/students?status=pending', {
      headers: { Authorization: `Bearer ${schoolAdminToken}` },
    })
    expect(pendingListRes.status).toBe(200)
    // SAFETY: Response JSON has standard envelope format
    const pendingListBody = (await pendingListRes.json()) as {
      success: boolean
      data: Array<{ user_id: string; nis: string; lifecycle_status: string }>
    }
    expect(pendingListBody.data.some((s) => s.user_id === studentUserId)).toBe(true)

    // 9. School admin approves student
    const approveRes = await app.request(`/v1/admin/students/${studentUserId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${schoolAdminToken}` },
    })
    expect(approveRes.status).toBe(200)
    // SAFETY: Response JSON has standard envelope format
    const approveBody = (await approveRes.json()) as {
      success: boolean
      data: { user_id: string; lifecycle_status: string }
    }
    expect(approveBody.data.lifecycle_status).toBe('approved')

    // 10. Approved student token can now access mobile dashboard
    const approvedDashboardRes = await app.request('/v1/mobile/dashboard', {
      headers: { Authorization: `Bearer ${pendingStudentToken}` },
    })
    expect(approvedDashboardRes.status).toBe(200)
    // SAFETY: Response JSON has standard envelope format
    const dashboardBody = (await approvedDashboardRes.json()) as {
      success: boolean
      data: {
        profile: { nis: string; full_name: string; class_name: string; role: string }
      }
    }
    expect(dashboardBody.data.profile.nis).toBe('5001')
    expect(dashboardBody.data.profile.full_name).toBe('Rian Pratama')

    // 11. School admin generates one-time reset code for student
    const resetCodeRes = await app.request(`/v1/admin/students/${studentUserId}/reset-code`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${schoolAdminToken}` },
    })
    expect(resetCodeRes.status).toBe(201)
    // SAFETY: Response JSON has standard envelope format
    const resetCodeBody = (await resetCodeRes.json()) as {
      success: boolean
      data: { code: string; expires_at: string; user_id: string; nis: string }
    }
    expect(resetCodeBody.data.code).toMatch(/^\d{6}$/)
    expect(resetCodeBody.data.nis).toBe('5001')

    const generatedCode = resetCodeBody.data.code

    // 12. Student resets password with the one-time code
    const resetPassRes = await app.request('/v1/auth/student/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nis: '5001',
        code: generatedCode,
        new_password: 'BrandNewPassword888!',
      }),
    })
    expect(resetPassRes.status).toBe(200)

    // 13. Reusing the reset code fails
    const reuseCodeRes = await app.request('/v1/auth/student/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nis: '5001',
        code: generatedCode,
        new_password: 'YetAnotherPassword123!',
      }),
    })
    expect(reuseCodeRes.status).toBe(401)

    // 14. School admin corrects student email
    const emailRes = await app.request(`/v1/admin/students/${studentUserId}/email`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${schoolAdminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'rian.pratama@school.sch.id',
      }),
    })
    expect(emailRes.status).toBe(200)
    // SAFETY: Response JSON has standard envelope format
    const emailBody = (await emailRes.json()) as {
      success: boolean
      data: { email: string }
    }
    expect(emailBody.data.email).toBe('rian.pratama@school.sch.id')

    // 15. School admin disables student -> mobile access revoked
    const disableRes = await app.request(`/v1/admin/students/${studentUserId}/disable`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${schoolAdminToken}` },
    })
    expect(disableRes.status).toBe(200)

    const disabledDashboardRes = await app.request('/v1/mobile/dashboard', {
      headers: { Authorization: `Bearer ${pendingStudentToken}` },
    })
    expect(disabledDashboardRes.status).toBe(403)
  })

  it('enforces strict role separation: student cannot perform admin actions', async () => {
    const domainStore = new MemoryDomainStore()
    const app = createTestApp(domainStore)

    domainStore.profiles.set('student-1', {
      user_id: 'student-1',
      nis: '7001',
      full_name: 'Student User',
      role: 'student',
      lifecycle_status: 'approved',
      gender: null,
    })

    const studentToken = tokenFor({
      sub: 'student-1',
      roles: ['student'],
      scope: 'openid profile',
    })

    // Student cannot list students
    const listRes = await app.request('/v1/admin/students', {
      headers: { Authorization: `Bearer ${studentToken}` },
    })
    expect(listRes.status).toBe(403)

    // Student cannot approve students
    const approveRes = await app.request('/v1/admin/students/student-1/approve', {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
    })
    expect(approveRes.status).toBe(403)

    // Student cannot generate reset code
    const resetCodeRes = await app.request('/v1/admin/students/student-1/reset-code', {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
    })
    expect(resetCodeRes.status).toBe(403)
  })

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
      roles: ['student'],
      scope: 'openid profile',
    })

    const dashboardRes = await app.request('/v1/mobile/dashboard', {
      headers: { Authorization: `Bearer ${signedToken}` },
    })
    expect(dashboardRes.status).toBe(200)
  })
})
