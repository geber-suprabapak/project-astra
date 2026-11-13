import { describe, expect, it } from 'vitest'
import { createTestEnv, setupUsers, tokenFor } from './helpers/challenger-scope1-fixture.js'

describe('Scope 1 Challenger: POST /v1/admin/leave-requests HTTP RBAC & Flow Verification', () => {
  it.each(['school_admin', 'platform_admin', 'teacher'] as const)(
    'allows approved %s to create a pending request for a student',
    async (role) => {
      const env = createTestEnv()
      await setupUsers(env.domainStore, env.identityProvider)
      const actorId = {
        school_admin: 'admin-1',
        platform_admin: 'platform-admin-1',
        teacher: 'teacher-1',
      }[role]
      const token = tokenFor({
        sub: actorId,
        roles: [role],
        scope: 'openid profile admin:read admin:write',
        mfa_verified: true,
        must_change_password: false,
      })
      const res = await env.app.request('/v1/admin/leave-requests', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: 'student-1',
          category: 'sakit',
          description: `Leave created by ${role}`,
          date: '2026-08-28',
        }),
      })
      expect(res.status).toBe(201)
      expect((await res.json()).data).toMatchObject({
        user_id: 'student-1',
        approval_status: 'pending',
        status: false,
      })
    },
  )

  it('allows alias POST /v1/admin/permits', async () => {
    const env = createTestEnv()
    await setupUsers(env.domainStore, env.identityProvider)

    const adminToken = tokenFor({
      sub: 'admin-1',
      roles: ['school_admin'],
      scope: 'openid profile admin:read admin:write',
      mfa_verified: true,
      must_change_password: false,
    })

    const permitRes = await env.app.request('/v1/admin/permits', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: 'student-1',
        category: 'dispensasi',
        description: 'Dispensasi lomba olimpiade',
        date: '2026-08-29',
      }),
    })
    expect(permitRes.status).toBe(201)
    expect((await permitRes.json()).data.approval_status).toBe('pending')
  })

  it('rejects a student admin request and a staff token without the admin scope', async () => {
    const env = createTestEnv()
    await setupUsers(env.domainStore, env.identityProvider)

    const studentToken = tokenFor({
      sub: 'student-1',
      roles: ['student'],
      scp: ['openid', 'profile', 'leave:submit'],
    })
    const staffToken = tokenFor({
      sub: 'staff-1',
      roles: ['staff'],
      scope: 'openid profile',
    })

    const studentRes = await env.app.request('/v1/admin/leave-requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: 'student-1',
        category: 'sakit',
        description: 'Attempt by student',
        date: '2026-08-28',
      }),
    })
    expect(studentRes.status).toBe(403)

    const staffRes = await env.app.request('/v1/admin/leave-requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${staffToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: 'student-1',
        category: 'sakit',
        description: 'Attempt by staff',
        date: '2026-08-28',
      }),
    })
    expect(staffRes.status).toBe(403)
  })

  it('returns not found for an authorized request targeting an unknown student', async () => {
    const env = createTestEnv()
    await setupUsers(env.domainStore, env.identityProvider)

    const adminToken = tokenFor({
      sub: 'admin-1',
      roles: ['school_admin'],
      scope: 'openid profile admin:read admin:write',
      mfa_verified: true,
      must_change_password: false,
    })

    const nonExistentRes = await env.app.request('/v1/admin/leave-requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: 'non-existent-student-id',
        category: 'sakit',
        description: 'Leave for ghost student',
        date: '2026-08-28',
      }),
    })
    expect(nonExistentRes.status).toBe(404)
    expect((await nonExistentRes.json()).error.code).toBe('RESOURCE_NOT_FOUND')
    expect(env.domainStore.auditLogs).not.toContainEqual(
      expect.objectContaining({ action: 'create_admin_leave_request' }),
    )
  })

  it('verifies attachment lifecycle transition and purpose gating', async () => {
    const env = createTestEnv()
    await setupUsers(env.domainStore, env.identityProvider)

    const adminToken = tokenFor({
      sub: 'admin-1',
      roles: ['school_admin'],
      scope: 'openid profile admin:read admin:write',
      mfa_verified: true,
      must_change_password: false,
    })

    const validFileId = '11111111-2222-3333-4444-555555555555'
    env.domainStore.files.set(validFileId, {
      id: validFileId,
      user_id: 'student-1',
      purpose: 'permit_attachment',
      object_path: 'student-1/permit_test.jpg',
      content_type: 'image/jpeg',
      size_bytes: 1024,
      lifecycle: 'pending_upload',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    const attachRes = await env.app.request('/v1/admin/leave-requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: 'student-1',
        category: 'pergi',
        description: 'Acara keluarga dengan surat izin',
        date: '2026-08-28',
        file_id: validFileId,
      }),
    })
    expect(attachRes.status).toBe(403)
    expect(env.domainStore.files.get(validFileId)?.lifecycle).toBe('pending_upload')
    expect(await env.domainStore.listLeaveRequests()).toHaveLength(0)

    const ownFile = {
      id: '33333333-2222-3333-4444-555555555555',
      user_id: 'admin-1',
      purpose: 'permit_attachment' as const,
      object_path: 'admin-1/note.jpg',
      content_type: 'image/jpeg',
      size_bytes: 1024,
      lifecycle: 'pending_upload' as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    env.domainStore.files.set(ownFile.id, ownFile)
    const ownAttachment = await env.app.request('/v1/admin/leave-requests', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: 'student-1',
        category: 'pergi',
        description: 'Own attachment',
        date: '2026-08-28',
        file_id: ownFile.id,
      }),
    })
    expect(ownAttachment.status).toBe(201)
    expect(env.domainStore.files.get(ownFile.id)?.lifecycle).toBe('available')

    // Wrong file purpose (avatar)
    const avatarFileId = '22222222-2222-3333-4444-555555555555'
    env.domainStore.files.set(avatarFileId, {
      id: avatarFileId,
      user_id: 'admin-1',
      purpose: 'avatar',
      object_path: 'admin-1/avatar.jpg',
      content_type: 'image/jpeg',
      size_bytes: 1024,
      lifecycle: 'available',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    const wrongPurposeRes = await env.app.request('/v1/admin/leave-requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: 'student-1',
        category: 'sakit',
        description: 'Using avatar as permit',
        date: '2026-08-28',
        file_id: avatarFileId,
      }),
    })
    expect(wrongPurposeRes.status).toBe(422)

    // Non-existent file ID
    const nonExistentFileRes = await env.app.request('/v1/admin/leave-requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: 'student-1',
        category: 'sakit',
        description: 'Missing file id',
        date: '2026-08-28',
        file_id: '99999999-9999-9999-9999-999999999999',
      }),
    })
    expect(nonExistentFileRes.status).toBe(404)
  })

  it('generates audit log entry with entity_type leave_request', async () => {
    const env = createTestEnv()
    await setupUsers(env.domainStore, env.identityProvider)

    const adminToken = tokenFor({
      sub: 'admin-1',
      roles: ['school_admin'],
      scope: 'openid profile admin:read admin:write',
      mfa_verified: true,
      must_change_password: false,
    })

    const res = await env.app.request('/v1/admin/leave-requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: 'student-1',
        category: 'lainnya',
        description: 'Dispensasi kegiatan khusus',
        date: '2026-08-28',
      }),
    })
    expect(res.status).toBe(201)
    const created = (await res.json()).data
    expect(env.domainStore.auditLogs).toContainEqual(
      expect.objectContaining({
        action: 'create_admin_leave_request',
        actor_id: 'admin-1',
        entity_type: 'leave_request',
        entity_id: created.id,
      }),
    )
  })
})
