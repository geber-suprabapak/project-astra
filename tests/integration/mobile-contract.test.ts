import { describe, expect, it, beforeEach } from 'vitest'
import type { createApp } from '../../src/app.js'
import { createMobileContractEnvironment } from './helpers/mobile-contract-fixture.js'

describe('integration: /v1/mobile contract boundary', () => {
  let app: ReturnType<typeof createApp>
  const userId = 'student-123'
  const authHeader = 'Bearer student-123'

  beforeEach(() => {
    ;({ app } = createMobileContractEnvironment())
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
})
