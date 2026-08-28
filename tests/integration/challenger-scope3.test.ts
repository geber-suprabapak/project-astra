import { describe, expect, it } from 'bun:test'
import type { JWTPayload } from 'jose'
import { createApp } from '../../src/app.js'
import { AttendanceHistoryQuerySchema } from '../../src/modules/attendance/schema.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../src/providers/memory/index.js'
import type { RobinClient } from '../../src/clients/robin/client.js'

function tokenFor(payload: JWTPayload): string {
  const fullPayload = {
    scope: 'openid profile mobile:access',
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

async function setupUsersAndAttendance(domainStore: MemoryDomainStore, identityProvider: MemoryIdentityProvider) {
  domainStore.profiles.set('student-1', {
    user_id: 'student-1',
    full_name: 'Budi Santoso',
    email: 'student1@school.sch.id',
    role: 'student',
    lifecycle_status: 'approved',
  })
  identityProvider.users.set('student-1', {
    userId: 'student-1',
    email: 'student1@school.sch.id',
    roles: ['student'],
    scopes: ['openid', 'profile', 'mobile:access'],
  })

  // Add attendance records across multiple dates
  // 2026-08-01 (check-in)
  domainStore.attendancesList.push({
    id: 'att-1',
    user_id: 'student-1',
    date: '2026-08-01',
    status: 'Hadir',
    action_type: 'check_in',
    created_at: '2026-08-01T07:00:00+07:00',
  })
  // 2026-08-15 (check-in)
  domainStore.attendancesList.push({
    id: 'att-2',
    user_id: 'student-1',
    date: '2026-08-15',
    status: 'Terlambat',
    action_type: 'check_in',
    created_at: '2026-08-15T07:20:00+07:00',
  })
  // 2026-08-28 (check-in)
  domainStore.attendancesList.push({
    id: 'att-3',
    user_id: 'student-1',
    date: '2026-08-28',
    status: 'Hadir',
    action_type: 'check_in',
    created_at: '2026-08-28T06:55:00+07:00',
  })
  // Other student record
  domainStore.attendancesList.push({
    id: 'att-4',
    user_id: 'student-other',
    date: '2026-08-15',
    status: 'Hadir',
    action_type: 'check_in',
    created_at: '2026-08-15T07:00:00+07:00',
  })
}

describe('Scope 3 Challenger: Attendance Query Parameter Normalization (ISS-06)', () => {
  describe('1. Zod Schema Casing & Transformation Matrix', () => {
    it('normalizes pure snake_case start_date and end_date', () => {
      const parsed = AttendanceHistoryQuerySchema.safeParse({
        start_date: '2026-08-01',
        end_date: '2026-08-28',
      })
      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data.startDate).toBe('2026-08-01')
        expect(parsed.data.endDate).toBe('2026-08-28')
      }
    })

    it('normalizes pure camelCase startDate and endDate', () => {
      const parsed = AttendanceHistoryQuerySchema.safeParse({
        startDate: '2026-08-01',
        endDate: '2026-08-28',
      })
      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data.startDate).toBe('2026-08-01')
        expect(parsed.data.endDate).toBe('2026-08-28')
      }
    })

    it('normalizes mixed snake start_date and camel endDate', () => {
      const parsed = AttendanceHistoryQuerySchema.safeParse({
        start_date: '2026-08-01',
        endDate: '2026-08-28',
      })
      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data.startDate).toBe('2026-08-01')
        expect(parsed.data.endDate).toBe('2026-08-28')
      }
    })

    it('normalizes mixed camel startDate and snake end_date', () => {
      const parsed = AttendanceHistoryQuerySchema.safeParse({
        startDate: '2026-08-01',
        end_date: '2026-08-28',
      })
      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data.startDate).toBe('2026-08-01')
        expect(parsed.data.endDate).toBe('2026-08-28')
      }
    })

    it('gives priority to camelCase if both are provided', () => {
      const parsed = AttendanceHistoryQuerySchema.safeParse({
        startDate: '2026-08-05',
        start_date: '2026-08-01',
        endDate: '2026-08-25',
        end_date: '2026-08-28',
      })
      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data.startDate).toBe('2026-08-05')
        expect(parsed.data.endDate).toBe('2026-08-25')
      }
    })

    it('rejects invalid date formats', () => {
      const invalidFormats = [
        { startDate: '2026/08/01' },
        { start_date: 'not-a-date' },
        { endDate: '2026-13-45' },
        { end_date: '28-08-2026' },
      ]
      for (const inv of invalidFormats) {
        const parsed = AttendanceHistoryQuerySchema.safeParse(inv)
        expect(parsed.success).toBe(false)
      }
    })
  })

  describe('2. HTTP Endpoint Parameter Normalization & Filtering', () => {
    it('filters attendance history correctly with snake_case query params on GET /v1/mobile/attendance', async () => {
      const envs = createTestEnv()
      await setupUsersAndAttendance(envs.domainStore, envs.identityProvider)

      const token = tokenFor({ sub: 'student-1', roles: ['student'] })

      const res = await envs.app.request(
        '/v1/mobile/attendance?start_date=2026-08-10&end_date=2026-08-20',
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        }
      )
      expect(res.status).toBe(200)
      // SAFETY: Response JSON envelope format
      const body = (await res.json()) as any
      expect(body.success).toBe(true)
      expect(body.data.items).toHaveLength(1)
      expect(body.data.items[0].date).toBe('2026-08-15')
    })

    it('filters attendance history correctly with camelCase query params on GET /v1/mobile/attendance', async () => {
      const envs = createTestEnv()
      await setupUsersAndAttendance(envs.domainStore, envs.identityProvider)

      const token = tokenFor({ sub: 'student-1', roles: ['student'] })

      const res = await envs.app.request(
        '/v1/mobile/attendance?startDate=2026-08-10&endDate=2026-08-20',
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        }
      )
      expect(res.status).toBe(200)
      // SAFETY: Response JSON envelope format
      const body = (await res.json()) as any
      expect(body.success).toBe(true)
      expect(body.data.items).toHaveLength(1)
      expect(body.data.items[0].date).toBe('2026-08-15')
    })

    it('filters attendance history correctly with mixed casing on GET /v1/mobile/attendance/history', async () => {
      const envs = createTestEnv()
      await setupUsersAndAttendance(envs.domainStore, envs.identityProvider)

      const token = tokenFor({ sub: 'student-1', roles: ['student'] })

      // Mixed start_date + endDate covering 2026-08-01 to 2026-08-16 -> should match 2 records (Aug 1 and Aug 15)
      const res = await envs.app.request(
        '/v1/mobile/attendance/history?start_date=2026-08-01&endDate=2026-08-16',
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        }
      )
      expect(res.status).toBe(200)
      // SAFETY: Response JSON envelope format
      const body = (await res.json()) as any
      expect(body.success).toBe(true)
      expect(body.data.items).toHaveLength(2)
    })

    it('returns 422 for malformed date parameters in query string', async () => {
      const envs = createTestEnv()
      await setupUsersAndAttendance(envs.domainStore, envs.identityProvider)

      const token = tokenFor({ sub: 'student-1', roles: ['student'] })

      const res = await envs.app.request(
        '/v1/mobile/attendance?startDate=invalid-date-string',
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        }
      )
      expect(res.status).toBe(422)
    })
  })
})
