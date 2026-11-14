import { describe, expect, it } from 'vitest'
import { OidcIdentityProvider } from '../../src/providers/identity/oidc-identity.js'
import { MemoryDomainStore } from '../../src/providers/memory/index.js'
import {
  OIDC_SECRET,
  createBootstrapApp,
  platformAdminToken,
  schoolAdminToken,
  signedOidcToken,
} from './helpers/bootstrap-fixture.js'

describe('integration: bootstrap roster rejection, RBAC & OIDC (Ticket 04)', () => {
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
        Authorization: `Bearer ${schoolAdminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        academic_period_id: 'b0000000-0000-0000-0000-000000000001',
        rows: [
          {
            nis: '1000',
            full_name: 'Valid Student',
            class_name: 'XII RPL 1',
            gender: 'L',
            absence_number: 1,
          },
          {
            nis: '',
            full_name: 'Empty NIS',
            class_name: 'XII RPL 1',
            gender: 'L',
            absence_number: 2,
          },
          {
            nis: '1001',
            full_name: 'Student 1',
            class_name: 'XII RPL 1',
            gender: 'L',
            absence_number: 3,
          },
          {
            nis: '1001',
            full_name: 'Duplicate NIS',
            class_name: 'XII RPL 1',
            gender: 'L',
            absence_number: 4,
          },
          { nis: '1002', full_name: '', class_name: 'XII RPL 1', gender: 'L', absence_number: 5 },
          { nis: '1003', full_name: 'Student 3', class_name: '', gender: 'L', absence_number: 6 },
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

  it('enforces hierarchical role separation: school_admin cannot bootstrap school, platform_admin can accept roster and open signup', async () => {
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
        Authorization: `Bearer ${schoolAdminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        academic_period_id: 'b0000000-0000-0000-0000-000000000001',
        rows: [
          {
            nis: '1001',
            full_name: 'Student 1',
            class_name: 'XII RPL 1',
            gender: 'L',
            absence_number: 1,
          },
        ],
      }),
    })
    // SAFETY: Response JSON has standard envelope format
    const rosterBody = (await rosterRes.json()) as { data: { id: string } }

    // 3. platform_admin can accept roster
    const platformAcceptRes = await app.request(
      `/v1/admin/bootstrap/roster/${rosterBody.data.id}/accept`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${platformAdminToken}` },
      },
    )
    expect(platformAcceptRes.status).toBe(200)

    // 4. platform_admin can open signup
    const platformSignupRes = await app.request('/v1/admin/bootstrap/signup/open', {
      method: 'POST',
      headers: { Authorization: `Bearer ${platformAdminToken}` },
    })
    expect(platformSignupRes.status).toBe(200)
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
