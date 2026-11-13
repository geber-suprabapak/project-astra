import { describe, expect, it } from 'vitest'
import {
  createTestApp,
  platformAdminToken,
  schoolAdminToken,
  studentToken,
  teacherToken,
  validBackupBody,
} from './helpers/admin-backup-fixture.js'

describe('integration: Astra backup-audit module (issue 05)', () => {
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
})
