import { describe, expect, it } from 'vitest'
import type { JWTPayload } from 'jose'
import { createApp } from '../../src/app.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../src/providers/memory/index.js'
import type { RobinClient } from '../../src/clients/robin/client.js'

function tokenFor(payload: JWTPayload): string {
  const fullPayload = {
    scope: 'openid profile admin:read',
    ...payload,
  }
  const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url')
  return `header.${encodedPayload}.signature`
}

function createTestContext() {
  const domainStore = new MemoryDomainStore()
  const objectStorage = new MemoryObjectStorage()
  const identityProvider = new MemoryIdentityProvider()

  const robinClient: RobinClient = {
    checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
    getEnrollmentStatus: async () => ({
      status: 'enrolled',
      embeddingCount: 10,
      message: 'Ready.',
    }),
    enroll: async () => ({ imagesProcessed: 10, imagesFailed: 0, totalEmbeddings: 10 }),
    identify: async () => ({
      status: 'ok',
      confidence: 0.94,
      qualityScore: 0.91,
      processTimeMs: 38,
      message: 'Face verified successfully',
    }),
    deleteEnrollment: async () => {},
  }

  const providers = {
    domainStore,
    objectStorage,
    identityProvider,
    robinClient,
  }

  const app = createApp({ providers })

  return { domainStore, identityProvider, objectStorage, robinClient, providers, app }
}

async function setupTestEntities(ctx: ReturnType<typeof createTestContext>) {
  // Setup School
  await ctx.domainStore.createSchool({
    name: 'SMK Negeri 2 Banjarmasin',
    slug: 'smkn2-bjm',
  })

  // Users & Profiles
  const roles = [
    { id: 'admin-1', role: 'platform_admin' as const },
    { id: 'school-admin-1', role: 'school_admin' as const },
    { id: 'teacher-1', role: 'teacher' as const },
    { id: 'student-1', role: 'student' as const },
  ]

  for (const r of roles) {
    ctx.domainStore.profiles.set(r.id, {
      user_id: r.id,
      full_name: `User ${r.id}`,
      email: `${r.id}@school.test`,
      role: r.role,
      lifecycle_status: 'approved',
    })
    ctx.identityProvider.users.set(r.id, {
      userId: r.id,
      email: `${r.id}@school.test`,
      roles: [r.role],
      scopes: r.role === 'student' ? ['openid', 'profile'] : ['openid', 'profile', 'admin:read'],
      mfaVerified: true,
      mustChangePassword: false,
    })
  }

  // Create an initial student leave request
  const lr = await ctx.domainStore.createLeaveRequest({
    user_id: 'student-1',
    category: 'sakit',
    description: 'Sakit demam dan flu berat.',
    date: '2026-09-01',
    attachment_url: 'permits/2026/09/student-1-surat-dokter.pdf',
    approval_status: 'pending',
  })

  return {
    lr,
    adminToken: tokenFor({ sub: 'admin-1', roles: ['platform_admin'] }),
    schoolAdminToken: tokenFor({ sub: 'school-admin-1', roles: ['school_admin'] }),
    teacherToken: tokenFor({ sub: 'teacher-1', roles: ['teacher'] }),
    studentToken: tokenFor({ sub: 'student-1', roles: ['student'], scope: 'openid profile' }),
    studentWithAdminScopeToken: tokenFor({
      sub: 'student-1',
      roles: ['student'],
      scope: 'openid profile admin:read',
    }),
  }
}

describe('Challenger 1 Adversarial Stress: Leave Request Reopen Lifecycle (GAP-01)', () => {
  it('Role Matrix: allows platform_admin, school_admin, and teacher; strictly forbids student and unauthenticated roles', async () => {
    const ctx = createTestContext()
    const {
      lr,
      adminToken,
      schoolAdminToken,
      teacherToken,
      studentToken,
      studentWithAdminScopeToken,
    } = await setupTestEntities(ctx)

    // 1. Reject first as platform_admin
    const rejectRes = await ctx.app.request(`/v1/admin/leave-requests/${lr.id}/reject`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Surat dokter buram.' }),
    })
    expect(rejectRes.status).toBe(200)

    // 2. Attempt reopen as student (without admin scope) -> 403 Forbidden (Scope check)
    const studentReopen = await ctx.app.request(`/v1/admin/leave-requests/${lr.id}/reopen`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
      },
    })
    expect(studentReopen.status).toBe(403)

    // 3. Attempt reopen as student (with admin scope injected) -> 403 Forbidden (Service RBAC check)
    const studentWithScopeReopen = await ctx.app.request(
      `/v1/admin/leave-requests/${lr.id}/reopen`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${studentWithAdminScopeToken}`,
        },
      },
    )
    expect(studentWithScopeReopen.status).toBe(403)

    // 4. Attempt reopen as unauthenticated / missing token -> 401 Unauthorized
    const unauthReopen = await ctx.app.request(`/v1/admin/leave-requests/${lr.id}/reopen`, {
      method: 'POST',
    })
    expect(unauthReopen.status).toBe(401)

    // 5. Reopen as teacher -> 200 OK
    const teacherReopen = await ctx.app.request(`/v1/admin/leave-requests/${lr.id}/reopen`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${teacherToken}`,
      },
    })
    expect(teacherReopen.status).toBe(200)
    const teacherData = await teacherReopen.json()
    expect(teacherData.data.approval_status).toBe('pending')
    expect(teacherData.data.status).toBe(false)
    expect(teacherData.data.rejection_reason).toBeNull()
    expect(teacherData.data.rejected_at).toBeNull()

    // 6. Reject again and reopen as school_admin -> 200 OK
    await ctx.app.request(`/v1/admin/leave-requests/${lr.id}/reject`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${schoolAdminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Alasan kedua ditolak' }),
    })
    const schoolAdminReopen = await ctx.app.request(`/v1/admin/leave-requests/${lr.id}/reopen`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${schoolAdminToken}`,
      },
    })
    expect(schoolAdminReopen.status).toBe(200)

    // 7. Reject again and reopen as platform_admin -> 200 OK
    await ctx.app.request(`/v1/admin/leave-requests/${lr.id}/reject`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Alasan ketiga ditolak' }),
    })
    const platformAdminReopen = await ctx.app.request(`/v1/admin/leave-requests/${lr.id}/reopen`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    })
    expect(platformAdminReopen.status).toBe(200)
  })

  it('Non-existent ID: returns 404 Resource Not Found', async () => {
    const ctx = createTestContext()
    const { adminToken } = await setupTestEntities(ctx)

    const randomId = '00000000-0000-0000-0000-000000000099'
    const res = await ctx.app.request(`/v1/admin/leave-requests/${randomId}/reopen`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    })
    expect(res.status).toBe(404)
    const errBody = await res.json()
    expect(errBody.error.code).toBe('RESOURCE_NOT_FOUND')
  })

  it('Already Approved Request: reopening approved request transitions back to pending and resets boolean status', async () => {
    const ctx = createTestContext()
    const { lr, adminToken } = await setupTestEntities(ctx)

    // Approve the request
    const approveRes = await ctx.app.request(`/v1/admin/leave-requests/${lr.id}/approve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    })
    expect(approveRes.status).toBe(200)
    const approvedData = await approveRes.json()
    expect(approvedData.data.approval_status).toBe('approved')
    expect(approvedData.data.status).toBe(true)

    // Reopen the approved request
    const reopenRes = await ctx.app.request(`/v1/admin/leave-requests/${lr.id}/reopen`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    })
    expect(reopenRes.status).toBe(200)
    const reopenedData = await reopenRes.json()
    expect(reopenedData.data.approval_status).toBe('pending')
    expect(reopenedData.data.status).toBe(false)
    expect(reopenedData.data.rejection_reason).toBeNull()
    expect(reopenedData.data.rejected_at).toBeNull()
  })

  it('Database & Notification State Resets: audit log and push notification outbox are recorded accurately', async () => {
    const ctx = createTestContext()
    const { lr, adminToken } = await setupTestEntities(ctx)

    // Reject first
    await ctx.app.request(`/v1/admin/leave-requests/${lr.id}/reject`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Dokumen kadaluarsa' }),
    })

    const initialNotifs = await ctx.domainStore.listNotifications({ userId: 'student-1' })
    const initialNotifCount = initialNotifs.length

    // Reopen
    const reopenRes = await ctx.app.request(`/v1/admin/leave-requests/${lr.id}/reopen`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    })
    expect(reopenRes.status).toBe(200)

    // Verify audit logs
    const auditLogs = ctx.domainStore.auditLogs.filter(
      (log) => log.entity_id === lr.id && log.action === 'reopen_leave_request',
    )
    expect(auditLogs.length).toBeGreaterThanOrEqual(1)
    const latestAudit = auditLogs[auditLogs.length - 1]
    expect(latestAudit.actor_id).toBe('admin-1')
    expect(latestAudit.details.previous_status).toBe('rejected')
    expect(latestAudit.details.student_user_id).toBe('student-1')
    expect(latestAudit.details.category).toBe('sakit')

    // Verify notifications
    const updatedNotifs = await ctx.domainStore.listNotifications({ userId: 'student-1' })
    expect(updatedNotifs.length).toBe(initialNotifCount + 1)
    const reopenNotif = updatedNotifs.find((n) => n.payload.type === 'leave_reopened')
    expect(reopenNotif).toBeDefined()
    expect(reopenNotif?.payload.title).toBe('Pengajuan Izin Dibuka Kembali')
    expect(reopenNotif?.payload.leave_request_id).toBe(lr.id)
  })

  it('Route Aliases & PATCH Compatibility: verifies /permits/:id/reopen and PATCH pending payloads', async () => {
    const ctx = createTestContext()
    const { lr, adminToken } = await setupTestEntities(ctx)

    // Test POST /v1/admin/permits/:id/reopen alias
    const permitsAliasRes = await ctx.app.request(`/v1/admin/permits/${lr.id}/reopen`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    })
    expect(permitsAliasRes.status).toBe(200)

    // Test PATCH /v1/admin/leave-requests/:id with { approval_status: 'pending' }
    const patchPendingRes = await ctx.app.request(`/v1/admin/leave-requests/${lr.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ approval_status: 'pending' }),
    })
    expect(patchPendingRes.status).toBe(200)
    const patchData = await patchPendingRes.json()
    expect(patchData.data.approval_status).toBe('pending')

    // Test invalid approval_status on PATCH returns 422 Validation Error
    const patchInvalidRes = await ctx.app.request(`/v1/admin/leave-requests/${lr.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ approval_status: 'unknown_status' }),
    })
    expect(patchInvalidRes.status).toBe(422)
  })
})
