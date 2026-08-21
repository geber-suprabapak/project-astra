import { describe, expect, it, beforeEach } from 'vitest'
import { createApp } from '../../src/app.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../src/providers/memory/index.js'
import type { RobinClient } from '../../src/clients/robin/client.js'
import { getDayKeyWIB, getTodayWIB } from '../../src/modules/dashboard/service.js'

function createMockRobinClient(): RobinClient {
  return {
    checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
    getEnrollmentStatus: async () => ({
      status: 'enrolled',
      embeddingCount: 1,
      message: 'Ready',
    }),
    enroll: async () => ({
      status: 'ok',
      userId: 'student-123',
      samplesReceived: 10,
      embeddingsCreated: 10,
      message: 'Face enrolled successfully.',
    }),
    identify: async () => ({
      status: 'ok',
      candidateId: 'student-123',
      confidence: 0.95,
      threshold: 0.7,
      qualityScore: 0.92,
      processTimeMs: 85,
    }),
    deleteEnrollment: async () => {},
  }
}

describe('integration: /v1/mobile contract boundary', () => {
  let domainStore: MemoryDomainStore
  let objectStorage: MemoryObjectStorage
  let identityProvider: MemoryIdentityProvider
  let robinClient: RobinClient
  let app: ReturnType<typeof createApp>

  const userId = 'student-123'
  const token = 'student-123'
  const authHeader = `Bearer ${token}`

  beforeEach(() => {
    domainStore = new MemoryDomainStore()
    objectStorage = new MemoryObjectStorage()
    identityProvider = new MemoryIdentityProvider()
    robinClient = createMockRobinClient()

    // Seed mock student profile
    domainStore.profiles.set(userId, {
      user_id: userId,
      full_name: 'Budi Santoso',
      email: 'budi@sekolah.sch.id',
      nis: '12345',
      class_name: 'XII RPL 1',
      absence_number: '10',
      avatar_url: 'student-123/avatar.jpg',
      role: 'student',
      lifecycle_status: 'approved',
      gender: 'L',
    })

    // Seed active schedule for today's WIB day
    const dayKey = getDayKeyWIB()
    domainStore.schedules.clear()
    domainStore.schedules.set(dayKey, {
      id: `sched-${dayKey}`,
      hari: dayKey,
      day_of_week: dayKey,
      mulai_masuk: '00:00:00',
      selesai_masuk: '23:59:59',
      mulai_pulang: '00:00:00',
      selesai_pulang: '23:59:59',
      kompensasi_waktu: 30,
      is_active: true,
    })

    // Seed active class enrollment
    const activePeriod = domainStore.academicPeriods.find((p) => p.is_active)
    const activeClass = domainStore.classes[0]
    if (activePeriod && activeClass) {
      domainStore.classEnrollments.push({
        id: 'enroll-student-123',
        user_id: userId,
        class_id: activeClass.id,
        academic_period_id: activePeriod.id,
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    }

    identityProvider.passwords.set('budi@sekolah.sch.id', 'current-password123')

    app = createApp({
      providers: { domainStore, objectStorage, identityProvider, robinClient },
    })
  })

  describe('GET /v1/mobile/time', () => {
    it('returns server time with timezone and epoch ms', async () => {
      const res = await app.request('/v1/mobile/time', {
        headers: { Authorization: authHeader },
      })
      // SAFETY: /v1/mobile/time returns JSON payload with server time metadata
      const body = (await res.json()) as {
        success: boolean
        data: { now: string; timezone: string; source: string; epoch_ms: number }
        message: string
      }

      expect(res.status).toBe(200)
      expect(res.headers.get('X-Astra-Contract-Version')).toBe('v1')
      expect(body.data.timezone).toBe('Asia/Jakarta')
      expect(body.data.source).toBe('bff')
      expect(Number.isFinite(body.data.epoch_ms)).toBe(true)
    })
  })

  describe('GET /v1/mobile/dashboard', () => {
    it('returns aggregated student dashboard data', async () => {
      const res = await app.request('/v1/mobile/dashboard', {
        headers: { Authorization: authHeader },
      })
      // SAFETY: /v1/mobile/dashboard returns aggregated student dashboard response
      const body = (await res.json()) as {
        success: boolean
        data: {
          profile: { user_id: string; full_name: string; nis: string; avatar_url: string | null }
          attendance: { today_status: string; has_checked_in: boolean; has_checked_out: boolean }
          schedule: { day_key: string } | null
          face: { server_status: string; enrollment_status: string }
          permit: { has_active_permit: boolean }
          primary_action: { allowed: boolean; type: string | null }
          server_time: { timezone: string }
        }
      }

      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.profile.user_id).toBe(userId)
      expect(body.data.profile.full_name).toBe('Budi Santoso')
      expect(body.data.profile.nis).toBe('12345')
      expect(body.data.profile.avatar_url).toContain('https://storage.local/signed/')
      expect(body.data.attendance.today_status).toBe('pending')
      expect(body.data.face.enrollment_status).toBe('enrolled')
      expect(body.data.primary_action.allowed).toBe(true)
      expect(body.data.primary_action.type).toBe('check_in')
    })
  })

  describe('POST /v1/mobile/attendance/precheck', () => {
    it('validates location and schedule returning check_in window', async () => {
      const res = await app.request('/v1/mobile/attendance/precheck', {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          latitude: -6.2,
          longitude: 106.8,
        }),
      })

      // SAFETY: /v1/mobile/attendance/precheck returns precheck response shape
      const body = (await res.json()) as {
        success: boolean
        data: {
          allowed: boolean
          action_type: string
          checks: { schedule: string; permit: string; enrollment: string; robin: string }
        }
      }

      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.allowed).toBe(true)
      expect(body.data.action_type).toBe('check_in')
      expect(body.data.checks).toEqual({
        schedule: 'pass',
        permit: 'pass',
        enrollment: 'pass',
        robin: 'pass',
      })
    })

    it('rejects invalid payload with 422', async () => {
      const res = await app.request('/v1/mobile/attendance/precheck', {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          latitude: 'invalid-number',
        }),
      })

      expect(res.status).toBe(422)
    })
  })

  describe('POST /v1/mobile/attendance/submit', () => {
    it('successfully processes face attendance check-in', async () => {
      const res = await app.request('/v1/mobile/attendance/submit', {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action_type: 'check_in',
          image_base64: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
          latitude: -6.2,
          longitude: 106.8,
        }),
      })

      // SAFETY: /v1/mobile/attendance/submit returns attendance record result
      const body = (await res.json()) as {
        success: boolean
        data: {
          attendance_type: string
          status_label: string
          processed_ms: number
        }
      }

      expect(res.status).toBe(201)
      expect(body.success).toBe(true)
      expect(body.data.attendance_type).toBe('check_in')
      expect(body.data.status_label).toBe('Hadir')
      expect(Number.isFinite(body.data.processed_ms)).toBe(true)
    })
  })

  describe('Face Enrollment endpoints', () => {
    it('GET /v1/mobile/face/enrollment/status returns status', async () => {
      const res = await app.request('/v1/mobile/face/enrollment/status', {
        headers: { Authorization: authHeader },
      })
      // SAFETY: /v1/mobile/face/enrollment/status returns face enrollment status
      const body = (await res.json()) as {
        success: boolean
        data: { status: string; embeddingCount: number }
      }

      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.status).toBe('enrolled')
    })

    it('POST /v1/mobile/face/enrollment accepts 10 JPEG images', async () => {
      const formData = new FormData()
      for (let i = 1; i <= 10; i += 1) {
        formData.append(
          'files',
          new Blob([`sample-img-${i}`], { type: 'image/jpeg' }),
          `face${i}.jpg`,
        )
      }

      const res = await app.request('/v1/mobile/face/enrollment', {
        method: 'POST',
        headers: { Authorization: authHeader },
        body: formData,
      })

      // SAFETY: /v1/mobile/face/enrollment returns enrollment result
      const body = (await res.json()) as {
        success: boolean
        data: { status: string; samplesReceived: number; embeddingsCreated: number }
      }

      expect(res.status).toBe(201)
      expect(body.success).toBe(true)
      expect(body.data.status).toBe('ok')
      expect(body.data.samplesReceived).toBe(10)
    })
  })

  describe('Permits endpoints', () => {
    it('POST /v1/mobile/permits creates a new permit', async () => {
      const today = getTodayWIB()
      const formData = new FormData()
      formData.append('category', 'sakit')
      formData.append('description', 'Demam tinggi dan flu berat')
      formData.append('date', today)
      formData.append('attachment', new Blob(['surat-dokter'], { type: 'image/jpeg' }), 'surat.jpg')

      const res = await app.request('/v1/mobile/permits', {
        method: 'POST',
        headers: { Authorization: authHeader },
        body: formData,
      })

      // SAFETY: POST /v1/mobile/permits returns created permit response
      const body = (await res.json()) as {
        success: boolean
        data: {
          id: string
          category: string
          description: string
          approval_status: string
          attachment_url: string | null
        }
      }

      expect(res.status).toBe(201)
      expect(body.success).toBe(true)
      expect(body.data.category).toBe('sakit')
      expect(body.data.description).toBe('Demam tinggi dan flu berat')
      expect(body.data.approval_status).toBe('pending')
      expect(body.data.attachment_url).toContain('https://storage.local/signed/')
    })

    it('GET /v1/mobile/permits returns permit list', async () => {
      const res = await app.request('/v1/mobile/permits', {
        headers: { Authorization: authHeader },
      })
      // SAFETY: GET /v1/mobile/permits returns permit list envelope
      const body = (await res.json()) as {
        success: boolean
        data: { items: unknown[] }
      }

      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(Array.isArray(body.data.items)).toBe(true)
    })
  })

  describe('Profile endpoints', () => {
    it('GET /v1/mobile/profile returns student profile', async () => {
      const res = await app.request('/v1/mobile/profile', {
        headers: { Authorization: authHeader },
      })
      // SAFETY: GET /v1/mobile/profile returns student profile response
      const body = (await res.json()) as {
        success: boolean
        data: { user_id: string; full_name: string; nis: string }
      }

      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.user_id).toBe(userId)
      expect(body.data.full_name).toBe('Budi Santoso')
    })

    it('PATCH /v1/mobile/profile/avatar updates avatar and returns signed URL', async () => {
      const formData = new FormData()
      formData.append('file', new Blob(['fake-png-bytes'], { type: 'image/png' }), 'avatar.png')

      const res = await app.request('/v1/mobile/profile/avatar', {
        method: 'PATCH',
        headers: { Authorization: authHeader },
        body: formData,
      })

      // SAFETY: PATCH /v1/mobile/profile/avatar returns avatar URL response
      const body = (await res.json()) as {
        success: boolean
        data: { avatar_url: string | null }
      }

      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.avatar_url).toContain('https://storage.local/signed/')
    })

    it('PATCH /v1/mobile/profile/avatar with clear: true removes avatar', async () => {
      const res = await app.request('/v1/mobile/profile/avatar', {
        method: 'PATCH',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ clear: true }),
      })

      // SAFETY: PATCH /v1/mobile/profile/avatar with clear:true returns null avatar_url
      const body = (await res.json()) as {
        success: boolean
        data: { avatar_url: string | null }
      }

      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.avatar_url).toBeNull()
    })

    it('PATCH /v1/mobile/profile/password updates password when current password matches', async () => {
      const res = await app.request('/v1/mobile/profile/password', {
        method: 'PATCH',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          current_password: 'current-password123',
          new_password: 'brand-new-password123',
        }),
      })

      // SAFETY: PATCH /v1/mobile/profile/password returns success message envelope
      const body = (await res.json()) as {
        success: boolean
        message: string
      }

      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
    })

    it('PATCH /v1/mobile/profile/password rejects invalid current password with 401', async () => {
      const res = await app.request('/v1/mobile/profile/password', {
        method: 'PATCH',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          current_password: 'wrong-password',
          new_password: 'brand-new-password123',
        }),
      })

      expect(res.status).toBe(401)
    })
  })

  describe('Notification token endpoints', () => {
    it('persists the current user push token behind Astra', async () => {
      const update = await app.request('/v1/mobile/notifications/token', {
        method: 'PATCH',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: 'ExponentPushToken[test]' }),
      })
      expect(update.status).toBe(200)
 
      const read = await app.request('/v1/mobile/notifications/token', {
        headers: { Authorization: authHeader },
      })
      // SAFETY: The notification token route returns the standard success envelope.
      const body = (await read.json()) as {
        success: boolean
        data: { notification_token: string | null }
      }
      expect(read.status).toBe(200)
      expect(body.data.notification_token).toBe('ExponentPushToken[test]')
    })
  })

  describe('Route 404 fallback', () => {
    it('returns standard 404 error envelope for undefined routes', async () => {
      const res = await app.request('/v1/mobile/non-existent')
      // SAFETY: 404 handler returns standard error envelope
      const body = (await res.json()) as {
        success: boolean
        error: { code: string; message: string }
      }

      expect(res.status).toBe(404)
      expect(body.success).toBe(false)
      expect(body.error.code).toBe('RESOURCE_NOT_FOUND')
    })
  })
})
