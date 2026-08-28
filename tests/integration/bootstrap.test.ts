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
    userId: 'platform-admin-1',
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
    .setSubject(claims.sub ?? 'platform-admin-1')
    .setIssuedAt()
    .setExpirationTime(expirationTime)
    .sign(new TextEncoder().encode(OIDC_SECRET))
}

function createBootstrapApp(
  domainStore = new MemoryDomainStore(),
  identityProvider: IdentityProvider = new MemoryIdentityProvider(),
) {
  // Pre-seed platform admin
  domainStore.profiles.set('platform-admin-1', {
    user_id: 'platform-admin-1',
    full_name: 'Platform Admin',
    email: 'admin@school.sch.id',
    role: 'platform_admin',
    lifecycle_status: 'approved',
    gender: null,
  })

  // Pre-seed school admin
  domainStore.profiles.set('school-admin-1', {
    user_id: 'school-admin-1',
    full_name: 'School Admin',
    email: 'principal@school.sch.id',
    role: 'school_admin',
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

const platformAdminToken = tokenFor({
  sub: 'platform-admin-1',
  roles: ['platform_admin'],
  scope: 'openid profile admin:read',
  must_change_password: false,
  mfa_verified: true,
})

const schoolAdminToken = tokenFor({
  sub: 'school-admin-1',
  roles: ['school_admin'],
  scope: 'openid profile admin:read',
  must_change_password: false,
  mfa_verified: true,
})

describe('integration: bootstrap school and validate student roster (Ticket 04)', () => {
  it('walks through complete bootstrap sequence from empty state to open student signup', async () => {
    const domainStore = new MemoryDomainStore()
    const app = createBootstrapApp(domainStore)

    // 1. Initial Status check
    const initialStatusRes = await app.request('/v1/admin/bootstrap/status', {
      headers: { Authorization: `Bearer ${platformAdminToken}` },
    })
    expect(initialStatusRes.status).toBe(200)
    // SAFETY: Response JSON has standard envelope format
    const initialStatusBody = (await initialStatusRes.json()) as {
      success: boolean
      data: {
        school_configured: boolean
        school: unknown
        signup_open: boolean
        roster_accepted: boolean
      }
    }
    expect(initialStatusBody.data.school_configured).toBe(false)
    expect(initialStatusBody.data.school).toBeNull()
    expect(initialStatusBody.data.signup_open).toBe(false)
    expect(initialStatusBody.data.roster_accepted).toBe(false)

    // 2. Platform Admin bootstraps School
    const schoolRes = await app.request('/v1/admin/bootstrap/school', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${platformAdminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'SMK Negeri 2 Banjarmasin',
        slug: 'smkn2bjm',
        timezone: 'Asia/Jakarta',
      }),
    })
    expect(schoolRes.status).toBe(201)
    // SAFETY: Response JSON has standard envelope format
    const schoolBody = (await schoolRes.json()) as {
      success: boolean
      data: { id: string; name: string; slug: string; timezone: string }
    }
    expect(schoolBody.data.name).toBe('SMK Negeri 2 Banjarmasin')
    expect(schoolBody.data.slug).toBe('smkn2bjm')
    expect(schoolBody.data.timezone).toBe('Asia/Jakarta')

    // Verify audit log for school bootstrap
    const schoolAudit = await domainStore.getAuditLogs('school', schoolBody.data.id)
    expect(schoolAudit.length).toBe(1)
    expect(schoolAudit[0].action).toBe('bootstrap_school')
    expect(schoolAudit[0].actor_id).toBe('platform-admin-1')

    // 3. Platform Admin creates initial school_admin profile
    const schoolAdminRes = await app.request('/v1/admin/bootstrap/school-admin', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${platformAdminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: 'new-school-admin-2',
        full_name: 'Kepala Sekolah Baru',
        email: 'kepsek@school.sch.id',
      }),
    })
    expect(schoolAdminRes.status).toBe(201)
    // SAFETY: Response JSON has standard envelope format
    const schoolAdminBody = (await schoolAdminRes.json()) as {
      success: boolean
      data: { user_id: string; role: string; lifecycle_status: string }
    }
    expect(schoolAdminBody.data.user_id).toBe('new-school-admin-2')
    expect(schoolAdminBody.data.role).toBe('school_admin')
    expect(schoolAdminBody.data.lifecycle_status).toBe('approved')

    // 4. Platform Admin stages a roster batch with stage-only validation
    const rosterRes = await app.request('/v1/admin/bootstrap/roster', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${platformAdminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        rows: [
          { nis: '1001', full_name: 'Ahmad Fauzi', class_name: 'XII RPL 1', grade: 12 },
          { nis: '1002', full_name: 'Budi Utomo', class_name: 'XII RPL 1', grade: 12 },
        ],
      }),
    })
    expect(rosterRes.status).toBe(201)
    // SAFETY: Response JSON has standard envelope format
    const rosterBody = (await rosterRes.json()) as {
      success: boolean
      data: {
        id: string
        total_rows: number
        valid_rows: number
        rejected_rows: number
        status: string
        review_state: string
        rejected_items: unknown[]
      }
    }
    expect(rosterBody.data.total_rows).toBe(2)
    expect(rosterBody.data.valid_rows).toBe(2)
    expect(rosterBody.data.rejected_rows).toBe(0)
    expect(rosterBody.data.status).toBe('staged')
    expect(rosterBody.data.review_state).toBe('pending')
    expect(rosterBody.data.rejected_items).toEqual([])

    const rosterReportId = rosterBody.data.id

    // Verify audit log for staged roster
    const rosterAudit = await domainStore.getAuditLogs('roster_report', rosterReportId)
    expect(rosterAudit.length).toBe(1)
    expect(rosterAudit[0].action).toBe('stage_roster')

    // 5. School Admin reviews the staged report by ID
    const getReportRes = await app.request(`/v1/admin/bootstrap/roster/${rosterReportId}`, {
      headers: { Authorization: `Bearer ${schoolAdminToken}` },
    })
    expect(getReportRes.status).toBe(200)
    // SAFETY: Response JSON has standard envelope format
    const getReportBody = (await getReportRes.json()) as {
      success: boolean
      data: { id: string; total_rows: number; status: string }
    }
    expect(getReportBody.data.id).toBe(rosterReportId)
    expect(getReportBody.data.status).toBe('staged')

    // 6. School Admin accepts the valid report
    const acceptRes = await app.request(`/v1/admin/bootstrap/roster/${rosterReportId}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${schoolAdminToken}` },
    })
    expect(acceptRes.status).toBe(200)
    // SAFETY: Response JSON has standard envelope format
    const acceptBody = (await acceptRes.json()) as {
      success: boolean
      data: { id: string; status: string; review_state: string; accepted_by: string }
    }
    expect(acceptBody.data.status).toBe('accepted')
    expect(acceptBody.data.review_state).toBe('accepted')
    expect(acceptBody.data.accepted_by).toBe('school-admin-1')

    // Verify canonical student records committed
    const student1 = await domainStore.getProfileByNis('1001')
    expect(student1).not.toBeNull()
    expect(student1?.full_name).toBe('Ahmad Fauzi')

    // 7. School Admin opens Student Signup
    const openSignupRes = await app.request('/v1/admin/bootstrap/signup/open', {
      method: 'POST',
      headers: { Authorization: `Bearer ${schoolAdminToken}` },
    })
    expect(openSignupRes.status).toBe(200)
    // SAFETY: Response JSON has standard envelope format
    const openSignupBody = (await openSignupRes.json()) as {
      success: boolean
      data: { signup_open: boolean }
    }
    expect(openSignupBody.data.signup_open).toBe(true)

    // 8. Final Status check confirms everything is active
    const finalStatusRes = await app.request('/v1/admin/bootstrap/status', {
      headers: { Authorization: `Bearer ${schoolAdminToken}` },
    })
    expect(finalStatusRes.status).toBe(200)
    // SAFETY: Response JSON has standard envelope format
    const finalStatusBody = (await finalStatusRes.json()) as {
      success: boolean
      data: {
        school_configured: boolean
        school_admin_created: boolean
        active_academic_period: boolean
        roster_accepted: boolean
        signup_open: boolean
      }
    }
    expect(finalStatusBody.data.school_configured).toBe(true)
    expect(finalStatusBody.data.school_admin_created).toBe(true)
    expect(finalStatusBody.data.active_academic_period).toBe(true)
    expect(finalStatusBody.data.roster_accepted).toBe(true)
    expect(finalStatusBody.data.signup_open).toBe(true)
  })

  it('rejects invalid rows during staged roster validation without committing records', async () => {
    const domainStore = new MemoryDomainStore()
    const app = createBootstrapApp(domainStore)

    // Bootstrap school first
    await app.request('/v1/admin/bootstrap/school', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${platformAdminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'School 1', slug: 'school-1' }),
    })

    // Stage roster with invalid entries
    const invalidRosterRes = await app.request('/v1/admin/bootstrap/roster', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${platformAdminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        rows: [
          { nis: '1000', full_name: 'Valid Student', class_name: 'XII RPL 1' },
          { nis: '', full_name: 'Empty NIS', class_name: 'XII RPL 1' },
          { nis: '1001', full_name: 'Student 1', class_name: 'XII RPL 1' },
          { nis: '1001', full_name: 'Duplicate NIS', class_name: 'XII RPL 1' },
          { nis: '1002', full_name: '', class_name: 'XII RPL 1' },
          { nis: '1003', full_name: 'Student 3', class_name: '' },
        ],
      }),
    })

    expect(invalidRosterRes.status).toBe(201)
    // SAFETY: Response JSON has standard envelope format
    const invalidBody = (await invalidRosterRes.json()) as {
      success: boolean
      data: {
        id: string
        total_rows: number
        valid_rows: number
        rejected_rows: number
        status: string
        review_state: string
        rejected_items: Array<{ row_index: number; reason: string }>
      }
    }

    expect(invalidBody.data.total_rows).toBe(6)
    expect(invalidBody.data.valid_rows).toBe(1)
    expect(invalidBody.data.rejected_rows).toBe(5)
    expect(invalidBody.data.status).toBe('rejected')
    expect(invalidBody.data.review_state).toBe('rejected')
    expect(invalidBody.data.rejected_items.length).toBe(5)

    // Trying to accept the report with rejected rows must fail
    const acceptRes = await app.request(
      `/v1/admin/bootstrap/roster/${invalidBody.data.id}/accept`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${schoolAdminToken}` },
      },
    )
    expect(acceptRes.status).toBe(422)

    // Verify no students were committed
    const studentCheck = await domainStore.getProfileByNis('1001')
    expect(studentCheck).toBeNull()
  })

  it('enforces role separation: school_admin cannot bootstrap school and platform_admin cannot accept roster or open signup', async () => {
    const domainStore = new MemoryDomainStore()
    const app = createBootstrapApp(domainStore)

    // 1. school_admin cannot bootstrap school
    const schoolRes = await app.request('/v1/admin/bootstrap/school', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${schoolAdminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'School 1', slug: 'school-1' }),
    })
    expect(schoolRes.status).toBe(403)

    // 2. school_admin cannot create school_admin profile
    const schoolAdminRes = await app.request('/v1/admin/bootstrap/school-admin', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${schoolAdminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_id: 'new-admin' }),
    })
    expect(schoolAdminRes.status).toBe(403)

    // Bootstrap school properly with platform_admin
    await app.request('/v1/admin/bootstrap/school', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${platformAdminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'School 1', slug: 'school-1' }),
    })

    // Stage clean roster
    const rosterRes = await app.request('/v1/admin/bootstrap/roster', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${platformAdminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        rows: [{ nis: '1001', full_name: 'Student 1', class_name: 'XII RPL 1' }],
      }),
    })
    // SAFETY: Response JSON has standard envelope format
    const rosterBody = (await rosterRes.json()) as { data: { id: string } }

    // 3. platform_admin cannot accept roster
    const platformAcceptRes = await app.request(
      `/v1/admin/bootstrap/roster/${rosterBody.data.id}/accept`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${platformAdminToken}` },
      },
    )
    expect(platformAcceptRes.status).toBe(403)

    // 4. platform_admin cannot open signup
    const platformSignupRes = await app.request('/v1/admin/bootstrap/signup/open', {
      method: 'POST',
      headers: { Authorization: `Bearer ${platformAdminToken}` },
    })
    expect(platformSignupRes.status).toBe(403)
  })

  it('verifies signed OIDC tokens across the bootstrap boundary', async () => {
    const identityProvider = new OidcIdentityProvider({
      jwtSecret: OIDC_SECRET,
      issuer: 'http://logto.test/oidc',
      audience: 'astra-api',
    })

    const domainStore = new MemoryDomainStore()
    const app = createBootstrapApp(domainStore, identityProvider)

    const signedToken = await signedOidcToken({
      sub: 'platform-admin-1',
      scope: 'openid profile mobile:access admin:read',
      must_change_password: false,
      mfa_verified: true,
    })

    const statusRes = await app.request('/v1/admin/bootstrap/status', {
      headers: { Authorization: `Bearer ${signedToken}` },
    })
    expect(statusRes.status).toBe(200)
  })
})
