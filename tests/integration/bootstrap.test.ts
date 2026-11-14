import { describe, expect, it } from 'vitest'
import { MemoryDomainStore, MemoryIdentityProvider } from '../../src/providers/memory/index.js'
import {
  createBootstrapApp,
  platformAdminToken,
  schoolAdminToken,
} from './helpers/bootstrap-fixture.js'

describe('integration: bootstrap school and validate student roster (Ticket 04)', () => {
  it('admits identity-free students with enrollment-owned absence numbers and binds on signup', async () => {
    const domainStore = new MemoryDomainStore()
    const identityProvider = new MemoryIdentityProvider()
    const app = createBootstrapApp(domainStore, identityProvider)

    await app.request('/v1/admin/bootstrap/school', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${platformAdminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'School 1', slug: 'school-1' }),
    })

    const stagedResponse = await app.request('/v1/admin/bootstrap/roster', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${schoolAdminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        academic_period_id: 'b0000000-0000-0000-0000-000000000001',
        rows: [
          {
            nis: '2001',
            full_name: '  Siti   Aminah  ',
            gender: 'P',
            class_id: 'c0000000-0000-0000-0000-000000000001',
            class_name: 'XII RPL 1',
            absence_number: 7,
          },
        ],
      }),
    })
    expect(stagedResponse.status).toBe(201)
    // SAFETY: successful staging responses use the standard typed data envelope.
    const stagedBody = (await stagedResponse.json()) as {
      data: { id: string; status: string; valid_rows: number }
    }
    expect(stagedBody.data.status).toBe('staged')
    expect(stagedBody.data.valid_rows).toBe(1)

    const acceptedResponse = await app.request(
      `/v1/admin/bootstrap/roster/${stagedBody.data.id}/accept`,
      { method: 'POST', headers: { Authorization: `Bearer ${schoolAdminToken}` } },
    )
    expect(acceptedResponse.status).toBe(200)
    const repeatedAcceptedResponse = await app.request(
      `/v1/admin/bootstrap/roster/${stagedBody.data.id}/accept`,
      { method: 'POST', headers: { Authorization: `Bearer ${schoolAdminToken}` } },
    )
    expect(repeatedAcceptedResponse.status).toBe(200)
    expect(identityProvider.users.size).toBe(0)
    expect(domainStore.profiles.has('student-2001')).toBe(false)
    const student = await domainStore.getStudentByNis('2001')
    expect(student?.gender).toBe('P')
    expect(domainStore.classEnrollments).toHaveLength(1)
    expect(domainStore.classEnrollments[0]?.student_id).toBe(student?.id)
    expect(domainStore.classEnrollments[0]?.user_id).toBeNull()
    expect(domainStore.classEnrollments[0]?.absence_number).toBe('7')

    await app.request('/v1/admin/bootstrap/signup/open', {
      method: 'POST',
      headers: { Authorization: `Bearer ${schoolAdminToken}` },
    })
    const signupResponse = await app.request('/v1/auth/student/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nis: '2001',
        email: 'siti@school.sch.id',
        password: 'Password123!',
      }),
    })
    expect(signupResponse.status).toBe(201)
    expect(identityProvider.users.size).toBe(1)
    expect(domainStore.classEnrollments[0]?.user_id).not.toBeNull()
    expect(domainStore.studentBindings.get(student!.id)?.user_id).toBe(
      domainStore.classEnrollments[0]?.user_id,
    )
  })

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

    // 4. School Admin stages a roster batch with stage-only validation
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
            full_name: 'Ahmad Fauzi',
            class_name: 'XII RPL 1',
            grade: 12,
            gender: 'L',
            absence_number: 1,
          },
          {
            nis: '1002',
            full_name: 'Budi Utomo',
            class_name: 'XII RPL 1',
            grade: 12,
            gender: 'L',
            absence_number: 2,
          },
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

    // Verify canonical student records committed without identity profiles
    const student1 = await domainStore.getStudentByNis('1001')
    expect(student1).not.toBeNull()
    expect(student1?.full_name).toBe('Ahmad Fauzi')
    expect(await domainStore.getProfileByNis('1001')).toBeNull()

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
})
