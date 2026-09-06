import { describe, expect, it } from 'vitest'
import type { JWTPayload } from 'jose'
import { createApp } from '../../src/app.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../src/providers/memory/index.js'
import type { IdentityProvider } from '../../src/providers/types.js'

function tokenFor(payload: JWTPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${encodedPayload}.signature`
}

const mockRobinClient = {
  enroll: async () => ({
    success: true,
    data: {
      user_id: 'test',
      status: 'success' as const,
      version: '1',
      created_at: new Date().toISOString(),
      sample_count: 10,
    },
  }),
  verify: async () => ({
    match: true,
    confidence: 0.99,
    threshold: 0.7,
    qualityScore: 0.95,
    processTimeMs: 120,
  }),
  deleteEnrollment: async () => {},
}

function createTestApp(
  domainStore = new MemoryDomainStore(),
  identityProvider: IdentityProvider = new MemoryIdentityProvider(),
) {
  domainStore.profiles.set('platform-admin-1', {
    user_id: 'platform-admin-1',
    full_name: 'Platform Admin',
    email: 'platform@school.sch.id',
    role: 'platform_admin',
    lifecycle_status: 'approved',
    gender: null,
  })

  domainStore.profiles.set('school-admin-1', {
    user_id: 'school-admin-1',
    full_name: 'School Admin',
    email: 'admin@school.sch.id',
    role: 'school_admin',
    lifecycle_status: 'approved',
    gender: null,
  })

  domainStore.profiles.set('teacher-1', {
    user_id: 'teacher-1',
    full_name: 'Teacher One',
    email: 'teacher@school.sch.id',
    role: 'teacher',
    lifecycle_status: 'approved',
    gender: null,
  })

  domainStore.profiles.set('student-1', {
    user_id: 'student-1',
    full_name: 'Student One',
    email: 'student@school.sch.id',
    role: 'student',
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

const teacherToken = tokenFor({
  sub: 'teacher-1',
  roles: ['teacher'],
  scope: 'openid profile admin:read',
  must_change_password: false,
  mfa_verified: true,
})

const studentToken = tokenFor({
  sub: 'student-1',
  roles: ['student'],
  scope: 'openid profile',
  must_change_password: false,
  mfa_verified: true,
})

describe('integration: Astra backup-audit module (issue 05)', () => {
  const validBackupBody = {
    year_month: '2026-04',
    scope: 'absences',
    format: 'xlsx',
    start_date: '2026-04-01',
    end_date: '2026-04-30',
    checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    record_count: 120,
    byte_length: 8192,
    result: 'completed',
  }

  describe('role-based access control', () => {
    it('allows platform_admin to POST /v1/admin/backups and GET /v1/admin/backups/status', async () => {
      const app = createTestApp()

      const postRes = await app.request('/v1/admin/backups', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${platformAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validBackupBody),
      })
      expect(postRes.status).toBe(201)

      const getRes = await app.request('/v1/admin/backups/status?year_month=2026-04', {
        headers: { Authorization: `Bearer ${platformAdminToken}` },
      })
      expect(getRes.status).toBe(200)
    })

    it('allows school_admin to POST /v1/admin/backups and GET /v1/admin/backups/status', async () => {
      const app = createTestApp()

      const postRes = await app.request('/v1/admin/backups', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${schoolAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validBackupBody),
      })
      expect(postRes.status).toBe(201)

      const getRes = await app.request('/v1/admin/backups/status?year_month=2026-04', {
        headers: { Authorization: `Bearer ${schoolAdminToken}` },
      })
      expect(getRes.status).toBe(200)
    })

    it('rejects teacher with 403 FORBIDDEN', async () => {
      const app = createTestApp()

      const postRes = await app.request('/v1/admin/backups', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${teacherToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validBackupBody),
      })
      expect(postRes.status).toBe(403)
      // SAFETY: Error response body conforms to standard error envelope
      const postBody = (await postRes.json()) as { success: boolean; error: { code: string } }
      expect(postBody.error.code).toBe('FORBIDDEN')

      const getRes = await app.request('/v1/admin/backups/status?year_month=2026-04', {
        headers: { Authorization: `Bearer ${teacherToken}` },
      })
      expect(getRes.status).toBe(403)
      // SAFETY: Error response body conforms to standard error envelope
      const getBody = (await getRes.json()) as { success: boolean; error: { code: string } }
      expect(getBody.error.code).toBe('FORBIDDEN')
    })

    it('rejects student with 403 FORBIDDEN', async () => {
      const app = createTestApp()

      const postRes = await app.request('/v1/admin/backups', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${studentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validBackupBody),
      })
      expect(postRes.status).toBe(403)

      const getRes = await app.request('/v1/admin/backups/status?year_month=2026-04', {
        headers: { Authorization: `Bearer ${studentToken}` },
      })
      expect(getRes.status).toBe(403)
    })

    it('rejects unauthenticated request with 401 AUTH_REQUIRED', async () => {
      const app = createTestApp()

      const postRes = await app.request('/v1/admin/backups', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validBackupBody),
      })
      expect(postRes.status).toBe(401)
      // SAFETY: Error response body conforms to standard error envelope
      const postBody = (await postRes.json()) as { success: boolean; error: { code: string } }
      expect(postBody.error.code).toBe('AUTH_REQUIRED')

      const getRes = await app.request('/v1/admin/backups/status?year_month=2026-04')
      expect(getRes.status).toBe(401)
    })
  })

  describe('canonical envelopes and request correlation', () => {
    it('preserves incoming X-Request-ID and returns standard envelope and headers', async () => {
      const app = createTestApp()
      const reqId = 'audit-req-correlate-999'

      const res = await app.request('/v1/admin/backups', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${platformAdminToken}`,
          'Content-Type': 'application/json',
          'X-Request-ID': reqId,
        },
        body: JSON.stringify(validBackupBody),
      })

      expect(res.status).toBe(201)
      expect(res.headers.get('X-Request-ID')).toBe(reqId)
      expect(res.headers.get('X-Astra-Contract-Version')).toBe('v1')

      // SAFETY: Success response body conforms to standard success envelope
      const body = (await res.json()) as {
        success: boolean
        message: string
        data: { id: string }
        meta: { request_id: string; timestamp: string }
      }
      expect(body.success).toBe(true)
      expect(body.meta.request_id).toBe(reqId)
      expect(body.meta.timestamp).toBeDefined()
    })
  })

  describe('validation enforcement', () => {
    it('rejects invalid real YYYY-MM with 422 VALIDATION_ERROR', async () => {
      const app = createTestApp()

      const res = await app.request('/v1/admin/backups', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${platformAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...validBackupBody,
          year_month: '2026-13',
        }),
      })

      expect(res.status).toBe(422)
      // SAFETY: Error response body conforms to standard error envelope
      const body = (await res.json()) as { success: boolean; error: { code: string } }
      expect(body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects reversed date bounds with 422 VALIDATION_ERROR', async () => {
      const app = createTestApp()

      const res = await app.request('/v1/admin/backups', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${platformAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...validBackupBody,
          start_date: '2026-04-25',
          end_date: '2026-04-05',
        }),
      })

      expect(res.status).toBe(422)
      // SAFETY: Error response body conforms to standard error envelope
      const body = (await res.json()) as { success: boolean; error: { code: string } }
      expect(body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects dates outside the specified month with 422 VALIDATION_ERROR', async () => {
      const app = createTestApp()

      const res = await app.request('/v1/admin/backups', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${platformAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...validBackupBody,
          start_date: '2026-03-31',
        }),
      })

      expect(res.status).toBe(422)
      // SAFETY: Error response body conforms to standard error envelope
      const body = (await res.json()) as { success: boolean; error: { code: string } }
      expect(body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects uppercase checksum with 422 VALIDATION_ERROR', async () => {
      const app = createTestApp()

      const res = await app.request('/v1/admin/backups', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${platformAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...validBackupBody,
          checksum: 'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855',
        }),
      })

      expect(res.status).toBe(422)
      // SAFETY: Error response body conforms to standard error envelope
      const body = (await res.json()) as { success: boolean; error: { code: string } }
      expect(body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects missing or null checksum with 422 VALIDATION_ERROR', async () => {
      const app = createTestApp()

      const { checksum: _cs, ...withoutCs } = validBackupBody
      const res1 = await app.request('/v1/admin/backups', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${platformAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(withoutCs),
      })
      expect(res1.status).toBe(422)
      // SAFETY: Error response body conforms to standard error envelope
      const body1 = (await res1.json()) as { success: boolean; error: { code: string } }
      expect(body1.error.code).toBe('VALIDATION_ERROR')

      const res2 = await app.request('/v1/admin/backups', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${platformAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...validBackupBody, checksum: null }),
      })
      expect(res2.status).toBe(422)
      // SAFETY: Error response body conforms to standard error envelope
      const body2 = (await res2.json()) as { success: boolean; error: { code: string } }
      expect(body2.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects negative record_count with 422 VALIDATION_ERROR', async () => {
      const app = createTestApp()

      const res = await app.request('/v1/admin/backups', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${platformAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...validBackupBody,
          record_count: -5,
        }),
      })

      expect(res.status).toBe(422)
    })

    it('rejects zero or negative byte_length with 422 VALIDATION_ERROR', async () => {
      const app = createTestApp()

      const res = await app.request('/v1/admin/backups', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${platformAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...validBackupBody,
          byte_length: 0,
        }),
      })

      expect(res.status).toBe(422)
    })
  })

  describe('deepened provider seam: exact persisted return', () => {
    it('returns the exact AuditLog record persisted by insertAuditLog', async () => {
      const domainStore = new MemoryDomainStore()
      const app = createTestApp(domainStore)

      const res = await app.request('/v1/admin/backups', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${platformAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validBackupBody),
      })

      expect(res.status).toBe(201)
      // SAFETY: Response data represents exact persisted AuditLog record
      const body = (await res.json()) as {
        success: boolean
        data: {
          id: string
          actor_id: string
          action: string
          entity_type: string
          entity_id: string
          created_at: string
          details: {
            actor: string
            scope: string
            format: string
            start_date: string
            end_date: string
            range: { start_date: string; end_date: string }
            checksum: string
            counts: number
            record_count: number
            bytes: number
            byte_length: number
            result: string
          }
        }
      }

      expect(body.data.id).toBeDefined()
      expect(body.data.actor_id).toBe('platform-admin-1')
      expect(body.data.entity_type).toBe('backup')
      expect(body.data.entity_id).toBe('2026-04')
      expect(body.data.action).toBe('backup')
      expect(body.data.created_at).toBeDefined()
      expect(body.data.details.scope).toBe('absences')
      expect(body.data.details.format).toBe('xlsx')
      expect(body.data.details.range).toEqual({
        start_date: '2026-04-01',
        end_date: '2026-04-30',
      })
      expect(body.data.details.checksum).toBe(validBackupBody.checksum)
      expect(body.data.details.record_count).toBe(120)
      expect(body.data.details.byte_length).toBe(8192)
      expect(body.data.details.result).toBe('completed')
    })
  })

  describe('failed versus completed status', () => {
    it('reports completed: false and record: null when only failed records exist', async () => {
      const app = createTestApp()

      // 1. Post a failed backup
      const failedRes = await app.request('/v1/admin/backups', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${platformAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...validBackupBody,
          result: 'failed',
        }),
      })
      expect(failedRes.status).toBe(201)

      // Query status: returns completed: false, record: null with HTTP 200
      const status1Res = await app.request('/v1/admin/backups/status?year_month=2026-04', {
        headers: { Authorization: `Bearer ${platformAdminToken}` },
      })
      expect(status1Res.status).toBe(200)
      // SAFETY: Response data represents backup status response
      const status1Body = (await status1Res.json()) as {
        success: boolean
        data: { completed: boolean; record: unknown }
      }
      expect(status1Body.data.completed).toBe(false)
      expect(status1Body.data.record).toBeNull()

      // 2. Post a completed backup
      const completedRes = await app.request('/v1/admin/backups', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${platformAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...validBackupBody,
          result: 'completed',
        }),
      })
      expect(completedRes.status).toBe(201)

      // Query status: status must now be completed: true with completed record
      const status2Res = await app.request('/v1/admin/backups/status?year_month=2026-04', {
        headers: { Authorization: `Bearer ${platformAdminToken}` },
      })
      expect(status2Res.status).toBe(200)
      // SAFETY: Response data represents backup status response
      const status2Body = (await status2Res.json()) as {
        success: boolean
        data: {
          completed: boolean
          record: { result: string; year_month: string; scope: string } | null
        }
      }
      expect(status2Body.data.completed).toBe(true)
      expect(status2Body.data.record).not.toBeNull()
      expect(status2Body.data.record?.result).toBe('completed')
      expect(status2Body.data.record?.year_month).toBe('2026-04')
      expect(status2Body.data.record?.scope).toBe('absences')
    })
  })

  describe('deterministic duplicates', () => {
    it('returns the latest completed matching record when duplicate backups exist', async () => {
      const app = createTestApp()

      // First run: byte_length = 2000, record_count = 50
      await app.request('/v1/admin/backups', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${platformAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...validBackupBody,
          byte_length: 2000,
          record_count: 50,
        }),
      })

      // Second run: byte_length = 9999, record_count = 150
      await app.request('/v1/admin/backups', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${platformAdminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...validBackupBody,
          byte_length: 9999,
          record_count: 150,
        }),
      })

      // Query status: returns the latest matching completed record
      const statusRes = await app.request('/v1/admin/backups/status?year_month=2026-04', {
        headers: { Authorization: `Bearer ${platformAdminToken}` },
      })
      expect(statusRes.status).toBe(200)
      // SAFETY: Response data contains backup status details
      const body = (await statusRes.json()) as {
        success: boolean
        data: {
          completed: boolean
          record: {
            byte_length: number
            record_count: number
            year_month: string
            result: string
          } | null
        }
      }
      expect(body.data.completed).toBe(true)
      expect(body.data.record).not.toBeNull()
      expect(body.data.record?.byte_length).toBe(9999)
      expect(body.data.record?.record_count).toBe(150)
      expect(body.data.record?.year_month).toBe('2026-04')
      expect(body.data.record?.result).toBe('completed')
    })
  })

  describe('absent and query validation handling', () => {
    it('returns HTTP 200 with completed=false and record=null when no backup exists for month', async () => {
      const app = createTestApp()

      const res = await app.request('/v1/admin/backups/status?year_month=2026-01', {
        headers: { Authorization: `Bearer ${platformAdminToken}` },
      })
      expect(res.status).toBe(200)
      // SAFETY: Success response body conforms to standard success envelope
      const body = (await res.json()) as {
        success: boolean
        data: { completed: boolean; record: unknown }
      }
      expect(body.success).toBe(true)
      expect(body.data.completed).toBe(false)
      expect(body.data.record).toBeNull()
    })

    it('rejects GET /v1/admin/backups/status without required year_month with 422 VALIDATION_ERROR', async () => {
      const app = createTestApp()

      const res = await app.request('/v1/admin/backups/status', {
        headers: { Authorization: `Bearer ${platformAdminToken}` },
      })
      expect(res.status).toBe(422)
      // SAFETY: Error response body conforms to standard error envelope
      const body = (await res.json()) as { success: boolean; error: { code: string } }
      expect(body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects GET /v1/admin/backups/status with invalid scope with 422 VALIDATION_ERROR', async () => {
      const app = createTestApp()

      const res = await app.request('/v1/admin/backups/status?year_month=2026-04&scope=students', {
        headers: { Authorization: `Bearer ${platformAdminToken}` },
      })
      expect(res.status).toBe(422)
      // SAFETY: Error response body conforms to standard error envelope
      const body = (await res.json()) as { success: boolean; error: { code: string } }
      expect(body.error.code).toBe('VALIDATION_ERROR')
    })

    it('surfaces 500 INTERNAL_ERROR when matching completed log contains corrupted or malformed details', async () => {
      const domainStore = new MemoryDomainStore()
      await domainStore.insertAuditLog({
        actor_id: 'admin-1',
        action: 'backup',
        entity_type: 'backup',
        entity_id: '2026-04',
        details: {
          scope: 'absences',
          format: 'xlsx',
          result: 'completed',
          // missing required checksum, start_date, end_date, record_count, byte_length
        },
      })
      const app = createTestApp(domainStore)

      const res = await app.request('/v1/admin/backups/status?year_month=2026-04', {
        headers: { Authorization: `Bearer ${platformAdminToken}` },
      })
      expect(res.status).toBe(500)
      // SAFETY: Error response body conforms to standard error envelope
      const body = (await res.json()) as { success: boolean; error: { code: string } }
      expect(body.error.code).toBe('INTERNAL_ERROR')
    })
  })
})
