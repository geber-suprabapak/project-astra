import { describe, expect, it } from 'vitest'
import type { JWTPayload } from 'jose'
import { createApp } from '../../src/app.js'
import { createAdminLeaveRequestSchema } from '../../src/modules/admin/schema.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../src/providers/memory/index.js'
import type { RobinClient } from '../../src/clients/robin/client.js'

function tokenFor(payload: JWTPayload): string {
  const fullPayload = {
    scope: 'openid profile',
    ...payload,
  }
  const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url')
  return `header.${encodedPayload}.signature`
}

function createTestEnv() {
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

async function setupUsers(
  domainStore: MemoryDomainStore,
  identityProvider: MemoryIdentityProvider,
) {
  await domainStore.createSchool({
    name: 'SMK Negeri 2 Banjarmasin',
    slug: 'smkn2-bjm',
  })

  // Student 1 (Approved)
  domainStore.profiles.set('student-1', {
    user_id: 'student-1',
    full_name: 'Budi Santoso',
    email: 'student1@school.sch.id',
    nis: '1001',
    class_name: 'XII RPL 1',
    absence_number: '05',
    role: 'student',
    lifecycle_status: 'approved',
    gender: 'L',
  })
  identityProvider.users.set('student-1', {
    userId: 'student-1',
    email: 'student1@school.sch.id',
    roles: ['student'],
    scopes: ['openid', 'profile', 'leave:submit', 'leave:read'],
  })

  // Student Pending
  domainStore.profiles.set('student-pending', {
    user_id: 'student-pending',
    full_name: 'Pending Student',
    email: 'pending@school.sch.id',
    nis: '1003',
    class_name: 'XII RPL 1',
    role: 'student',
    lifecycle_status: 'pending',
    gender: 'L',
  })
  identityProvider.users.set('student-pending', {
    userId: 'student-pending',
    email: 'pending@school.sch.id',
    roles: ['student'],
    scopes: ['openid', 'profile'],
  })

  // School Admin
  domainStore.profiles.set('admin-1', {
    user_id: 'admin-1',
    full_name: 'Admin Sekolah',
    email: 'admin@school.sch.id',
    role: 'school_admin',
    lifecycle_status: 'approved',
  })
  identityProvider.users.set('admin-1', {
    userId: 'admin-1',
    email: 'admin@school.sch.id',
    roles: ['school_admin'],
    scopes: ['openid', 'profile', 'admin:read', 'admin:write', 'leave:read', 'leave:approve'],
    mfaVerified: true,
    mustChangePassword: false,
  })

  // Platform Admin
  domainStore.profiles.set('platform-admin-1', {
    user_id: 'platform-admin-1',
    full_name: 'Platform Admin',
    email: 'superadmin@platform.sch.id',
    role: 'platform_admin',
    lifecycle_status: 'approved',
  })
  identityProvider.users.set('platform-admin-1', {
    userId: 'platform-admin-1',
    email: 'superadmin@platform.sch.id',
    roles: ['platform_admin'],
    scopes: ['openid', 'profile', 'admin:read', 'admin:write', 'leave:read', 'leave:approve'],
    mfaVerified: true,
    mustChangePassword: false,
  })

  // Teacher
  domainStore.profiles.set('teacher-1', {
    user_id: 'teacher-1',
    full_name: 'Guru Wali Kelas',
    email: 'teacher@school.sch.id',
    role: 'teacher',
    lifecycle_status: 'approved',
  })
  identityProvider.users.set('teacher-1', {
    userId: 'teacher-1',
    email: 'teacher@school.sch.id',
    roles: ['teacher'],
    scopes: ['openid', 'profile', 'admin:read', 'admin:write', 'leave:read', 'leave:approve'],
    mfaVerified: true,
    mustChangePassword: false,
  })

  // Staff (unauthorized for leave creation)
  domainStore.profiles.set('staff-1', {
    user_id: 'staff-1',
    full_name: 'Staff Tata Usaha',
    email: 'staff@school.sch.id',
    role: 'staff',
    lifecycle_status: 'approved',
  })
  identityProvider.users.set('staff-1', {
    userId: 'staff-1',
    email: 'staff@school.sch.id',
    roles: ['staff'],
    scopes: ['openid', 'profile', 'admin:read'],
    mfaVerified: true,
    mustChangePassword: false,
  })
}

describe('Scope 1 Challenger: POST /v1/admin/leave-requests Adversarial Suite', () => {
  describe('1. Schema Category Validation Matrix', () => {
    const validCategories = ['sakit', 'pergi', 'dispensasi', 'lainnya']
    for (const cat of validCategories) {
      it(`accepts valid category '${cat}'`, () => {
        const parsed = createAdminLeaveRequestSchema.safeParse({
          user_id: 'student-1',
          category: cat,
          description: `Valid description for ${cat}`,
          date: '2026-08-28',
        })
        expect(parsed.success).toBe(true)
      })
    }

    const invalidCategories = [
      'izin',
      'cuti',
      'bolos',
      'alpha',
      'SAKIT',
      'sakit ',
      ' sakit',
      'sakit\n',
      '123',
      '',
      null,
      undefined,
      true,
      {},
      [],
      'dispensasi_khusus',
      'LAINNYA',
    ]
    for (const cat of invalidCategories) {
      it(`rejects invalid category '${String(cat)}'`, () => {
        const parsed = createAdminLeaveRequestSchema.safeParse({
          user_id: 'student-1',
          category: cat,
          description: 'Test description',
          date: '2026-08-28',
        })
        expect(parsed.success).toBe(false)
      })
    }
  })

  describe('2. Schema Date Format Validation Matrix', () => {
    const validDates = ['2026-08-28', '2024-02-29', '2026-12-31', '2025-01-01']
    for (const d of validDates) {
      it(`accepts valid YYYY-MM-DD date '${d}'`, () => {
        const parsed = createAdminLeaveRequestSchema.safeParse({
          user_id: 'student-1',
          category: 'sakit',
          description: 'Valid date test',
          date: d,
        })
        expect(parsed.success).toBe(true)
      })
    }

    const invalidDates = [
      '28-08-2026',
      '2026/08/28',
      '2026.08.28',
      '28/08/2026',
      '2026-8-28',
      '2026-08-8',
      '2026-08-28T00:00:00Z',
      '2026-08-28 00:00:00',
      'yesterday',
      'today',
      '2026-08-28 ',
      '',
      null,
      undefined,
      123456789,
      {},
      [],
    ]
    for (const d of invalidDates) {
      it(`rejects invalid date format '${String(d)}'`, () => {
        const parsed = createAdminLeaveRequestSchema.safeParse({
          user_id: 'student-1',
          category: 'sakit',
          description: 'Invalid date test',
          date: d,
        })
        expect(parsed.success).toBe(false)
      })
    }
  })

  describe('3. Required & Boundary Fields', () => {
    it('rejects when both user_id and userId are missing', () => {
      const parsed = createAdminLeaveRequestSchema.safeParse({
        category: 'sakit',
        description: 'desc',
        date: '2026-08-28',
      })
      expect(parsed.success).toBe(false)
    })

    it('accepts userId in camelCase', () => {
      const parsed = createAdminLeaveRequestSchema.safeParse({
        userId: 'student-1',
        category: 'sakit',
        description: 'desc',
        date: '2026-08-28',
      })
      expect(parsed.success).toBe(true)
    })

    it('accepts user_id in snake_case', () => {
      const parsed = createAdminLeaveRequestSchema.safeParse({
        user_id: 'student-1',
        category: 'sakit',
        description: 'desc',
        date: '2026-08-28',
      })
      expect(parsed.success).toBe(true)
    })

    it('rejects empty description', () => {
      const parsed = createAdminLeaveRequestSchema.safeParse({
        user_id: 'student-1',
        category: 'sakit',
        description: '',
        date: '2026-08-28',
      })
      expect(parsed.success).toBe(false)
    })

    it('accepts description length 1 and length 1000', () => {
      expect(
        createAdminLeaveRequestSchema.safeParse({
          user_id: 'student-1',
          category: 'sakit',
          description: 'a',
          date: '2026-08-28',
        }).success,
      ).toBe(true)

      expect(
        createAdminLeaveRequestSchema.safeParse({
          user_id: 'student-1',
          category: 'sakit',
          description: 'a'.repeat(1000),
          date: '2026-08-28',
        }).success,
      ).toBe(true)
    })

    it('rejects description length 1001', () => {
      expect(
        createAdminLeaveRequestSchema.safeParse({
          user_id: 'student-1',
          category: 'sakit',
          description: 'a'.repeat(1001),
          date: '2026-08-28',
        }).success,
      ).toBe(false)
    })

    const validUUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
    it('validates file_id UUID correctness', () => {
      expect(
        createAdminLeaveRequestSchema.safeParse({
          user_id: 'student-1',
          category: 'sakit',
          description: 'desc',
          date: '2026-08-28',
          file_id: validUUID,
        }).success,
      ).toBe(true)

      expect(
        createAdminLeaveRequestSchema.safeParse({
          user_id: 'student-1',
          category: 'sakit',
          description: 'desc',
          date: '2026-08-28',
          fileId: validUUID,
        }).success,
      ).toBe(true)

      expect(
        createAdminLeaveRequestSchema.safeParse({
          user_id: 'student-1',
          category: 'sakit',
          description: 'desc',
          date: '2026-08-28',
          file_id: null,
        }).success,
      ).toBe(true)

      expect(
        createAdminLeaveRequestSchema.safeParse({
          user_id: 'student-1',
          category: 'sakit',
          description: 'desc',
          date: '2026-08-28',
          file_id: 'not-a-valid-uuid',
        }).success,
      ).toBe(false)
    })

    it('validates approval_status values', () => {
      for (const st of ['pending', 'approved', 'rejected']) {
        expect(
          createAdminLeaveRequestSchema.safeParse({
            user_id: 'student-1',
            category: 'sakit',
            description: 'desc',
            date: '2026-08-28',
            approval_status: st,
          }).success,
        ).toBe(true)
      }

      expect(
        createAdminLeaveRequestSchema.safeParse({
          user_id: 'student-1',
          category: 'sakit',
          description: 'desc',
          date: '2026-08-28',
          approval_status: 'cancelled',
        }).success,
      ).toBe(false)
    })
  })

  describe('4. HTTP Endpoint RBAC & Flow Verification', () => {
    it('allows school_admin, platform_admin, and teacher to create leave requests with HTTP 201', async () => {
      const env = createTestEnv()
      await setupUsers(env.domainStore, env.identityProvider)

      const adminToken = tokenFor({
        sub: 'admin-1',
        roles: ['school_admin'],
        scope: 'openid profile admin:read admin:write',
        mfa_verified: true,
        must_change_password: false,
      })
      const platformAdminToken = tokenFor({
        sub: 'platform-admin-1',
        roles: ['platform_admin'],
        scope: 'openid profile admin:read admin:write',
        mfa_verified: true,
        must_change_password: false,
      })
      const teacherToken = tokenFor({
        sub: 'teacher-1',
        roles: ['teacher'],
        scope: 'openid profile admin:read admin:write',
        mfa_verified: true,
        must_change_password: false,
      })

      for (const [roleName, token] of [
        ['school_admin', adminToken],
        ['platform_admin', platformAdminToken],
        ['teacher', teacherToken],
      ] as const) {
        const res = await env.app.request('/v1/admin/leave-requests', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            user_id: 'student-1',
            category: 'sakit',
            description: `Leave created by ${roleName}`,
            date: '2026-08-28',
          }),
        })
        expect(res.status).toBe(201)
        // SAFETY: HTTP 201 response body is a JSON object with success and data
        const json = (await res.json()) as any
        expect(json.success).toBe(true)
        expect(json.data.category).toBe('sakit')
        expect(json.data.approval_status).toBe('approved')
        expect(json.data.status).toBe(true)
      }
    })

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
    })

    it('rejects student and staff roles with HTTP 403 Forbidden', async () => {
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
        scp: ['openid', 'profile', 'admin:read'],
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

    it('returns 404 Not Found when target student does not exist', async () => {
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
      expect(attachRes.status).toBe(201)
      // SAFETY: HTTP 201 response body is a JSON object with success and data
      const attachJson = (await attachRes.json()) as any
      expect(attachJson.data.attachment_url).toContain('permit_test.jpg')
      const updatedFile = env.domainStore.files.get(validFileId)
      expect(updatedFile?.lifecycle).toBe('available')

      // Wrong file purpose (avatar)
      const avatarFileId = '22222222-2222-3333-4444-555555555555'
      env.domainStore.files.set(avatarFileId, {
        id: avatarFileId,
        user_id: 'student-1',
        purpose: 'avatar',
        object_path: 'student-1/avatar.jpg',
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

      const auditLogs = env.domainStore.auditLogs
      const adminLeaveAudit = auditLogs.find((log) => log.action === 'create_admin_leave_request')
      expect(adminLeaveAudit).toBeDefined()
      expect(adminLeaveAudit?.actor_id).toBe('admin-1')
      expect(adminLeaveAudit?.entity_type).toBe('leave_request')
      expect(adminLeaveAudit?.details?.category).toBe('lainnya')
    })
  })
})
