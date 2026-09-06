import { describe, expect, it } from 'vitest'
import type { JWTPayload } from 'jose'
import { createApp } from '../../src/app.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../src/providers/memory/index.js'
import type { RobinClient } from '../../src/clients/robin/client.js'
import type { AttendanceRecord } from '../../src/providers/types.js'

const dummyRobinClient: RobinClient = {
  checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
  getEnrollmentStatus: async () => ({
    status: 'not_enrolled',
    embeddingCount: 0,
    message: 'No enrollment found.',
  }),
  enroll: async () => ({
    status: 'ok',
    userId: 'admin-user-1',
    samplesReceived: 0,
    embeddingsCreated: 0,
    message: 'Enrollment complete.',
  }),
  identify: async () => ({
    status: 'no_match',
    candidateId: null,
    confidence: 0,
    threshold: 0.7,
    qualityScore: 0,
    processTimeMs: 0,
  }),
  deleteEnrollment: async () => {},
}

function tokenFor(payload: JWTPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${encodedPayload}.signature`
}

const adminToken = tokenFor({
  sub: 'admin-user-1',
  scope: 'openid profile admin:read',
})

const baseHeaders = {
  'X-Astra-Contract-Version': 'v1',
}

const adminHeaders = {
  Authorization: `Bearer ${adminToken}`,
  'X-Astra-Contract-Version': 'v1',
}

function createAttendances(count: number, baseDate = '2026-09-04'): AttendanceRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `attendance-${index.toString().padStart(5, '0')}`,
    user_id: `student-${index % 10}`,
    date: baseDate,
    status: 'Hadir',
    action_type: 'check_in',
    latitude: null,
    longitude: null,
    created_at: new Date(Date.UTC(2026, 8, 4, 0, 0, index)).toISOString(),
  }))
}

function createTestApp(store?: MemoryDomainStore) {
  const domainStore = store ?? new MemoryDomainStore()
  domainStore.profiles.set('admin-user-1', {
    user_id: 'admin-user-1',
    full_name: 'School Admin',
    email: 'admin@school.sch.id',
    role: 'school_admin',
    lifecycle_status: 'approved',
    gender: null,
  })

  return {
    app: createApp({
      providers: {
        domainStore,
        objectStorage: new MemoryObjectStorage(),
        identityProvider: new MemoryIdentityProvider(),
        robinClient: dummyRobinClient,
      },
    }),
    domainStore,
  }
}

describe('integration: Astra settlement boundaries', () => {
  describe('request ID preservation and sanitization', () => {
    it('preserves safe incoming X-Request-ID in response header and meta', async () => {
      const { app } = createTestApp()
      const safeId = 'chronos-req-1234.5678:abcd_efgh'
      const res = await app.request('/v1/admin/attendance', {
        headers: {
          ...adminHeaders,
          'X-Request-ID': safeId,
        },
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('X-Request-ID')).toBe(safeId)
      // SAFETY: Success responses contain meta envelope with request_id and timestamp
      const body = (await res.json()) as { meta: { request_id: string; timestamp: string } }
      expect(body.meta.request_id).toBe(safeId)
      expect(body.meta.timestamp).toBeDefined()
    })

    it('replaces unsafe incoming X-Request-ID with a valid UUID', async () => {
      const { app } = createTestApp()
      const unsafeId = 'unsafe id with spaces and <script>'
      const res = await app.request('/v1/admin/attendance', {
        headers: {
          ...adminHeaders,
          'X-Request-ID': unsafeId,
        },
      })

      expect(res.status).toBe(200)
      const headerId = res.headers.get('X-Request-ID')
      expect(headerId).toMatch(/^[0-9a-f-]{36}$/)
      expect(headerId).not.toContain('unsafe')
      // SAFETY: Success responses contain meta envelope with sanitized request_id
      const body = (await res.json()) as { meta: { request_id: string } }
      expect(body.meta.request_id).toBe(headerId)
    })
  })

  describe('standard error envelopes: 404 and 426', () => {
    it('returns standard 404 error envelope with request_id and timestamp for nonexistent routes', async () => {
      const { app } = createTestApp()
      const reqId = 'chronos-404-test-id'
      const res = await app.request('/v1/nonexistent/route', {
        headers: {
          ...baseHeaders,
          'X-Request-ID': reqId,
        },
      })

      expect(res.status).toBe(404)
      expect(res.headers.get('X-Request-ID')).toBe(reqId)
      // SAFETY: Error response adheres to standard error envelope
      const body = (await res.json()) as {
        success: boolean
        error: { code: string; message: string }
        meta: { request_id: string; timestamp: string }
      }
      expect(body.success).toBe(false)
      expect(body.error.code).toBe('RESOURCE_NOT_FOUND')
      expect(body.error.message).toBe('Route not found.')
      expect(body.meta.request_id).toBe(reqId)
      expect(body.meta.timestamp).toBeDefined()
    })

    it('returns standard 426 error envelope with request_id and timestamp for unsupported contract version', async () => {
      const { app } = createTestApp()
      const reqId = 'chronos-426-test-id'
      const res = await app.request('/v1/admin/attendance', {
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'X-Request-ID': reqId,
          'X-Astra-Contract-Version': 'v99',
        },
      })

      expect(res.status).toBe(426)
      expect(res.headers.get('X-Request-ID')).toBe(reqId)
      // SAFETY: Error response adheres to standard error envelope
      const body = (await res.json()) as {
        success: boolean
        error: { code: string; message: string }
        meta: { request_id: string; timestamp: string }
      }
      expect(body.success).toBe(false)
      expect(body.error.code).toBe('CONTRACT_VERSION_UNSUPPORTED')
      expect(body.error.message).toBe('Unsupported Astra API contract version.')
      expect(body.meta.request_id).toBe(reqId)
      expect(body.meta.timestamp).toBeDefined()
    })
  })

  describe('GET attendance/:id direct lookup', () => {
    it('returns 200 with record data for an existing attendance record', async () => {
      const store = new MemoryDomainStore()
      const records = createAttendances(2)
      store.attendancesList = records
      const { app } = createTestApp(store)

      const res = await app.request(`/v1/admin/attendance/${records[0]!.id}`, {
        headers: adminHeaders,
      })

      expect(res.status).toBe(200)
      // SAFETY: Response payload contains single attendance record in data property
      const body = (await res.json()) as {
        success: boolean
        message: string
        data: AttendanceRecord
        meta: { request_id: string; timestamp: string }
      }
      expect(body.success).toBe(true)
      expect(body.data.id).toBe(records[0]!.id)
      expect(body.meta.request_id).toBeDefined()
    })

    it('works identically on plural alias /v1/admin/attendances/:id', async () => {
      const store = new MemoryDomainStore()
      const records = createAttendances(2)
      store.attendancesList = records
      const { app } = createTestApp(store)

      const res = await app.request(`/v1/admin/attendances/${records[1]!.id}`, {
        headers: adminHeaders,
      })

      expect(res.status).toBe(200)
      // SAFETY: Response payload contains single attendance record in data property
      const body = (await res.json()) as { data: AttendanceRecord }
      expect(body.data.id).toBe(records[1]!.id)
    })

    it('returns 404 with standard envelope when attendance record is not found', async () => {
      const { app } = createTestApp()
      const res = await app.request('/v1/admin/attendance/non-existent-id', {
        headers: adminHeaders,
      })

      expect(res.status).toBe(404)
      // SAFETY: Not found error response adheres to standard error envelope
      const body = (await res.json()) as {
        success: boolean
        error: { code: string; message: string }
        meta: { request_id: string; timestamp: string }
      }
      expect(body.success).toBe(false)
      expect(body.error.code).toBe('RESOURCE_NOT_FOUND')
      expect(body.error.message).toBe('Attendance not found.')
      expect(body.meta.request_id).toBeDefined()
    })
  })

  describe('honest delete idempotency contract', () => {
    it('deletes attendance on first call, and returns 404 on repeated deletion', async () => {
      const store = new MemoryDomainStore()
      const records = createAttendances(1)
      store.attendancesList = [...records]
      const { app } = createTestApp(store)

      // First delete: success
      const res1 = await app.request(`/v1/admin/attendance/${records[0]!.id}`, {
        method: 'DELETE',
        headers: adminHeaders,
      })
      expect(res1.status).toBe(200)
      // SAFETY: Delete response returns deleted id
      const body1 = (await res1.json()) as { success: boolean; data: { id: string } }
      expect(body1.success).toBe(true)
      expect(body1.data.id).toBe(records[0]!.id)

      // Repeated delete: resource is absent, returns 404 RESOURCE_NOT_FOUND
      const res2 = await app.request(`/v1/admin/attendance/${records[0]!.id}`, {
        method: 'DELETE',
        headers: adminHeaders,
      })
      expect(res2.status).toBe(404)
      // SAFETY: Repeated delete returns 404 RESOURCE_NOT_FOUND error envelope
      const body2 = (await res2.json()) as {
        success: boolean
        error: { code: string; message: string }
        meta: { request_id: string; timestamp: string }
      }
      expect(body2.success).toBe(false)
      expect(body2.error.code).toBe('RESOURCE_NOT_FOUND')
      expect(body2.error.message).toBe('Attendance not found.')
      expect(body2.meta.request_id).toBeDefined()
    })
  })

  describe('attendance pagination metadata, validation, and datasets', () => {
    for (const count of [0, 99, 100, 101, 1_501]) {
      it(`retrieves complete stable attendance records for dataset size ${count}`, async () => {
        const store = new MemoryDomainStore()
        store.attendancesList = createAttendances(count)
        const { app } = createTestApp(store)

        const collected: AttendanceRecord[] = []
        let offset = 0
        const limit = 100

        while (true) {
          const res = await app.request(`/v1/admin/attendance?limit=${limit}&offset=${offset}`, {
            headers: adminHeaders,
          })
          expect(res.status).toBe(200)
          // SAFETY: List attendances returns array of attendance records and pagination meta
          const body = (await res.json()) as {
            data: AttendanceRecord[]
            meta: {
              pagination: { limit: number; offset: number; has_more: boolean }
              request_id: string
            }
          }

          expect(body.meta.pagination.limit).toBe(limit)
          expect(body.meta.pagination.offset).toBe(offset)
          collected.push(...body.data)

          if (!body.meta.pagination.has_more) {
            break
          }
          offset += limit
        }

        expect(collected).toHaveLength(count)
        expect(new Set(collected.map((r) => r.id)).size).toBe(count)
        expect(collected).toEqual(
          [...collected].sort(
            (a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
          ),
        )
      })
    }

    it('handles exact multiples of page limit with correct has_more metadata', async () => {
      const store = new MemoryDomainStore()
      const count = 200
      store.attendancesList = createAttendances(count)
      const { app } = createTestApp(store)

      // Page 1
      const res1 = await app.request('/v1/admin/attendance?limit=100&offset=0', {
        headers: adminHeaders,
      })
      expect(res1.status).toBe(200)
      // SAFETY: Page 1 response contains attendance data and pagination meta
      const body1 = (await res1.json()) as {
        data: AttendanceRecord[]
        meta: { pagination: { limit: number; offset: number; has_more: boolean } }
      }
      expect(body1.data).toHaveLength(100)
      expect(body1.meta.pagination.has_more).toBe(true)

      // Page 2
      const res2 = await app.request('/v1/admin/attendance?limit=100&offset=100', {
        headers: adminHeaders,
      })
      expect(res2.status).toBe(200)
      // SAFETY: Page 2 response contains attendance data and pagination meta
      const body2 = (await res2.json()) as {
        data: AttendanceRecord[]
        meta: { pagination: { limit: number; offset: number; has_more: boolean } }
      }
      expect(body2.data).toHaveLength(100)
      expect(body2.meta.pagination.has_more).toBe(false)
    })

    it('validates limit and offset query parameters', async () => {
      const { app } = createTestApp()

      // Invalid limits
      for (const invalidLimit of ['0', '101', '-5', 'abc', '']) {
        const res = await app.request(`/v1/admin/attendance?limit=${invalidLimit}`, {
          headers: adminHeaders,
        })
        expect(res.status).toBe(422)
        // SAFETY: Validation error body adheres to standard error envelope
        const body = (await res.json()) as {
          error: { code: string; message: string; details?: string }
        }
        expect(body.error.code).toBe('VALIDATION_ERROR')
        expect(body.error.message).toBe('Validation failed.')
        expect(body.error.details).toContain('limit must be an integer between 1 and 100.')
      }

      // Invalid offsets
      for (const invalidOffset of ['-1', 'abc', '']) {
        const res = await app.request(`/v1/admin/attendance?offset=${invalidOffset}`, {
          headers: adminHeaders,
        })
        expect(res.status).toBe(422)
        // SAFETY: Validation error body adheres to standard error envelope
        const body = (await res.json()) as {
          error: { code: string; message: string; details?: string }
        }
        expect(body.error.code).toBe('VALIDATION_ERROR')
        expect(body.error.message).toBe('Validation failed.')
        expect(body.error.details).toContain('offset must be a non-negative integer.')
      }
    })

    it('rejects malformed start_date with VALIDATION_ERROR', async () => {
      const { app } = createTestApp()
      for (const malformedDate of ['2026/09/01', 'bad-date', '2026-9-1', '2026-02-30']) {
        const res = await app.request(`/v1/admin/attendance?start_date=${malformedDate}`, {
          headers: adminHeaders,
        })
        expect(res.status).toBe(422)
        // SAFETY: Validation error body adheres to standard error envelope
        const body = (await res.json()) as {
          error: { code: string; message: string; details?: string }
        }
        expect(body.error.code).toBe('VALIDATION_ERROR')
        expect(body.error.message).toBe('Validation failed.')
        expect(body.error.details).toBe('start_date must be in YYYY-MM-DD format.')
      }
    })

    it('rejects malformed end_date with VALIDATION_ERROR', async () => {
      const { app } = createTestApp()
      for (const malformedDate of ['2026/09/30', 'invalid-date', '2026-13-01']) {
        const res = await app.request(`/v1/admin/attendance?end_date=${malformedDate}`, {
          headers: adminHeaders,
        })
        expect(res.status).toBe(422)
        // SAFETY: Validation error body adheres to standard error envelope
        const body = (await res.json()) as {
          error: { code: string; message: string; details?: string }
        }
        expect(body.error.code).toBe('VALIDATION_ERROR')
        expect(body.error.message).toBe('Validation failed.')
        expect(body.error.details).toBe('end_date must be in YYYY-MM-DD format.')
      }
    })

    it('rejects reversed date bounds when start_date > end_date with VALIDATION_ERROR', async () => {
      const { app } = createTestApp()
      const res = await app.request(
        '/v1/admin/attendance?start_date=2026-09-10&end_date=2026-09-01',
        {
          headers: adminHeaders,
        },
      )
      expect(res.status).toBe(422)
      // SAFETY: Validation error body adheres to standard error envelope
      const body = (await res.json()) as {
        error: { code: string; message: string; details?: string }
      }
      expect(body.error.code).toBe('VALIDATION_ERROR')
      expect(body.error.message).toBe('Validation failed.')
      expect(body.error.details).toBe('start_date cannot be after end_date.')
    })

    it('filters attendances by date bounds with start_date and end_date', async () => {
      const store = new MemoryDomainStore()
      store.attendancesList = [
        ...createAttendances(3, '2026-09-01'),
        ...createAttendances(3, '2026-09-02'),
        ...createAttendances(3, '2026-09-03'),
        ...createAttendances(3, '2026-09-04'),
        ...createAttendances(3, '2026-09-05'),
      ]
      const { app } = createTestApp(store)

      const res = await app.request(
        '/v1/admin/attendance?start_date=2026-09-02&end_date=2026-09-04&limit=100',
        {
          headers: adminHeaders,
        },
      )
      expect(res.status).toBe(200)
      // SAFETY: Response data contains array of filtered attendance records
      const body = (await res.json()) as { data: AttendanceRecord[] }
      expect(body.data).toHaveLength(9)
      expect(body.data.every((r) => r.date >= '2026-09-02' && r.date <= '2026-09-04')).toBe(true)
    })
  })
})
