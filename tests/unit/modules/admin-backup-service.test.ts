import { describe, expect, it } from 'vitest'
import { getAdminBackupStatus, recordAdminBackup } from '../../../src/modules/admin/service.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { AppProviders } from '../../../src/providers/types.js'

function createMockProviders(domainStore = new MemoryDomainStore()): AppProviders {
  return {
    domainStore,
    objectStorage: new MemoryObjectStorage(),
    identityProvider: new MemoryIdentityProvider(),
    robinClient: {
      enroll: async () => ({
        success: true,
        data: {
          user_id: 'test',
          status: 'success',
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
    },
  }
}

describe('admin backup service', () => {
  const sampleInput = {
    year_month: '2026-04',
    scope: 'absences' as const,
    format: 'xlsx' as const,
    start_date: '2026-04-01',
    end_date: '2026-04-30',
    checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    record_count: 150,
    byte_length: 4096,
    result: 'completed' as const,
  }

  describe('role policy authorization', () => {
    it('allows platform_admin to record backup and get status', async () => {
      const providers = createMockProviders()
      const recorded = await recordAdminBackup({
        input: sampleInput,
        actorId: 'platform-admin-1',
        actorRole: 'platform_admin',
        providers,
      })
      expect(recorded.id).toBeDefined()

      const status = await getAdminBackupStatus({
        query: { year_month: '2026-04', scope: 'absences' },
        actorRole: 'platform_admin',
        providers,
      })
      expect(status.completed).toBe(true)
      expect(status.record).not.toBeNull()
      expect(status.record?.year_month).toBe('2026-04')
    })

    it('allows school_admin to record backup and get status', async () => {
      const providers = createMockProviders()
      const recorded = await recordAdminBackup({
        input: sampleInput,
        actorId: 'school-admin-1',
        actorRole: 'school_admin',
        providers,
      })
      expect(recorded.id).toBeDefined()

      const status = await getAdminBackupStatus({
        query: { year_month: '2026-04', scope: 'absences' },
        actorRole: 'school_admin',
        providers,
      })
      expect(status.completed).toBe(true)
      expect(status.record).not.toBeNull()
      expect(status.record?.year_month).toBe('2026-04')
    })

    it('forbids teacher from recording backup or querying status', async () => {
      const providers = createMockProviders()

      await expect(
        recordAdminBackup({
          input: sampleInput,
          actorId: 'teacher-1',
          actorRole: 'teacher',
          providers,
        }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
        httpStatus: 403,
      })

      await expect(
        getAdminBackupStatus({
          query: { year_month: '2026-04' },
          actorRole: 'teacher',
          providers,
        }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
        httpStatus: 403,
      })
    })

    it('forbids student from recording backup or querying status', async () => {
      const providers = createMockProviders()

      await expect(
        recordAdminBackup({
          input: sampleInput,
          actorId: 'student-1',
          actorRole: 'student',
          providers,
        }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
        httpStatus: 403,
      })

      await expect(
        getAdminBackupStatus({
          query: { year_month: '2026-04' },
          actorRole: 'student',
          providers,
        }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
        httpStatus: 403,
      })
    })

    it('forbids unauthenticated / null role actor', async () => {
      const providers = createMockProviders()

      await expect(
        recordAdminBackup({
          input: sampleInput,
          actorId: 'anon-1',
          actorRole: null,
          providers,
        }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
        httpStatus: 403,
      })

      await expect(
        getAdminBackupStatus({
          query: { year_month: '2026-04' },
          actorRole: null,
          providers,
        }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
        httpStatus: 403,
      })
    })
  })

  describe('deepened provider seam: exact persisted return', () => {
    it('returns the exact AuditLog returned by insertAuditLog without re-querying', async () => {
      const domainStore = new MemoryDomainStore()
      let insertCalled = false
      const expectedLogId = 'audit-exact-persisted-123'

      // Spy on insertAuditLog to verify exact returned record
      const originalInsert = domainStore.insertAuditLog.bind(domainStore)
      domainStore.insertAuditLog = async (entry) => {
        insertCalled = true
        const created = await originalInsert(entry)
        return {
          ...created,
          id: expectedLogId,
        }
      }

      const providers = createMockProviders(domainStore)
      const res = await recordAdminBackup({
        input: sampleInput,
        actorId: 'admin-actor-1',
        actorRole: 'platform_admin',
        providers,
      })

      expect(insertCalled).toBe(true)
      // Exact returned record is passed through directly
      expect(res.id).toBe(expectedLogId)
      expect(res.actor_id).toBe('admin-actor-1')
      expect(res.entity_type).toBe('backup')
      expect(res.entity_id).toBe('2026-04')
      expect(res.action).toBe('backup')
      expect(res.details).toMatchObject({
        actor: 'admin-actor-1',
        actor_id: 'admin-actor-1',
        scope: 'absences',
        format: 'xlsx',
        start_date: '2026-04-01',
        end_date: '2026-04-30',
        range: {
          start_date: '2026-04-01',
          end_date: '2026-04-30',
        },
        checksum: sampleInput.checksum,
        record_count: 150,
        counts: 150,
        byte_length: 4096,
        bytes: 4096,
        result: 'completed',
      })
    })
  })

  describe('failed versus completed status', () => {
    it('reports completed=false and record=null when only failed records exist', async () => {
      const providers = createMockProviders()

      // 1. Record a failed backup
      await recordAdminBackup({
        input: {
          ...sampleInput,
          result: 'failed',
        },
        actorId: 'admin-1',
        actorRole: 'platform_admin',
        providers,
      })

      // Query status: should report completed: false, record: null
      const failedStatus = await getAdminBackupStatus({
        query: { year_month: '2026-04', scope: 'absences' },
        actorRole: 'platform_admin',
        providers,
      })
      expect(failedStatus.completed).toBe(false)
      expect(failedStatus.record).toBeNull()

      // 2. Now record a completed backup
      await recordAdminBackup({
        input: {
          ...sampleInput,
          result: 'completed',
        },
        actorId: 'admin-1',
        actorRole: 'platform_admin',
        providers,
      })

      // Query status: should now report completed: true with the completed record
      const completedStatus = await getAdminBackupStatus({
        query: { year_month: '2026-04', scope: 'absences' },
        actorRole: 'platform_admin',
        providers,
      })
      expect(completedStatus.completed).toBe(true)
      expect(completedStatus.record).not.toBeNull()
      expect(completedStatus.record?.result).toBe('completed')
      expect(completedStatus.record?.year_month).toBe('2026-04')
      expect(completedStatus.record?.scope).toBe('absences')
    })
  })

  describe('deterministic duplicates', () => {
    it('returns the latest completed matching record without unrelated details when duplicates exist', async () => {
      const domainStore = new MemoryDomainStore()
      const providers = createMockProviders(domainStore)

      // Post first completed backup with byte_length = 1000
      const first = await recordAdminBackup({
        input: {
          ...sampleInput,
          byte_length: 1000,
          record_count: 20,
        },
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      })

      // Post second (duplicate/updated) completed backup with byte_length = 5000
      const second = await recordAdminBackup({
        input: {
          ...sampleInput,
          byte_length: 5000,
          record_count: 100,
        },
        actorId: 'admin-2',
        actorRole: 'school_admin',
        providers,
      })

      expect(first.id).not.toBe(second.id)

      // Status must return the latest matching completed record (second)
      const status = await getAdminBackupStatus({
        query: { year_month: '2026-04' },
        actorRole: 'school_admin',
        providers,
      })

      expect(status.completed).toBe(true)
      expect(status.record).not.toBeNull()
      expect(status.record?.id).toBe(second.id)
      expect(status.record?.byte_length).toBe(5000)
      expect(status.record?.record_count).toBe(100)
      expect(status.record?.actor_id).toBe('admin-2')
      expect(status.record?.result).toBe('completed')
    })
  })

  describe('absent / no backup records', () => {
    it('returns completed=false and record=null when no backup record exists for the given year_month', async () => {
      const providers = createMockProviders()

      const status = await getAdminBackupStatus({
        query: { year_month: '2026-01' },
        actorRole: 'platform_admin',
        providers,
      })

      expect(status.completed).toBe(false)
      expect(status.record).toBeNull()
    })

    it('backend failure still throws', async () => {
      const domainStore = new MemoryDomainStore()
      domainStore.getAuditLogs = async () => {
        throw new Error('Database connection failed')
      }
      const providers = createMockProviders(domainStore)

      await expect(
        getAdminBackupStatus({
          query: { year_month: '2026-04' },
          actorRole: 'platform_admin',
          providers,
        }),
      ).rejects.toThrow('Database connection failed')
    })
  })

  describe('strict status proof & data-integrity error handling', () => {
    it('surfaces an internal error when matching completed log has malformed/missing fields', async () => {
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
          // missing checksum, start_date, end_date, record_count, byte_length
        },
      })
      const providers = createMockProviders(domainStore)

      await expect(
        getAdminBackupStatus({
          query: { year_month: '2026-04' },
          actorRole: 'platform_admin',
          providers,
        }),
      ).rejects.toMatchObject({
        code: 'INTERNAL_ERROR',
        httpStatus: 500,
      })
    })

    it('surfaces an internal error when matching completed log has invalid date range for month', async () => {
      const domainStore = new MemoryDomainStore()
      await domainStore.insertAuditLog({
        actor_id: 'admin-1',
        action: 'backup',
        entity_type: 'backup',
        entity_id: '2026-04',
        details: {
          scope: 'absences',
          format: 'xlsx',
          start_date: '2026-04-20',
          end_date: '2026-04-10', // reversed!
          checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          record_count: 10,
          byte_length: 100,
          result: 'completed',
        },
      })
      const providers = createMockProviders(domainStore)

      await expect(
        getAdminBackupStatus({
          query: { year_month: '2026-04' },
          actorRole: 'platform_admin',
          providers,
        }),
      ).rejects.toMatchObject({
        code: 'INTERNAL_ERROR',
        httpStatus: 500,
      })
    })
  })
})
