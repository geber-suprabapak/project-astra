import { describe, expect, it } from 'vitest'
import { MemoryDomainStore } from '../../src/providers/memory/index.js'
import {
  createTestApp,
  platformAdminToken,
  validBackupBody,
} from './helpers/admin-backup-fixture.js'

describe('integration: Astra backup-audit status & persistence (issue 05)', () => {
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
