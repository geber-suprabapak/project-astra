import { describe, expect, it, beforeEach } from 'vitest'
import type { createApp } from '../../src/app.js'
import type { MemoryDomainStore } from '../../src/providers/memory/index.js'
import { getTodayWIB } from '../../src/modules/dashboard/service.js'
import { createMobileContractEnvironment } from './helpers/mobile-contract-fixture.js'

describe('integration: /v1/mobile permits, profile, and fallback boundary', () => {
  let domainStore: MemoryDomainStore
  let app: ReturnType<typeof createApp>
  const userId = 'student-123'
  const authHeader = 'Bearer student-123'

  beforeEach(() => {
    ;({ domainStore, app } = createMobileContractEnvironment())
  })

  describe('Permits endpoints', () => {
    it.each([
      ['shortened', '2026-11-05', '2026-11-02', '2026-11-02'],
      ['original-end fallback', '2026-11-05', null, '2026-11-05'],
      ['legacy one-day', null, null, '2026-11-01'],
    ])(
      'GET permits preserves approved %s period in WIB',
      async (_, originalEnd, effectiveEnd, expectedEnd) => {
        domainStore.permits.push({
          id: 'approved-period',
          user_id: userId,
          kategori_izin: 'sakit',
          deskripsi: 'Synthetic leave period',
          status: true,
          link_foto: null,
          tanggal: '2026-10-31T17:00:00.000Z',
          approval_status: 'approved',
          original_end_date: originalEnd,
          effective_end_date: effectiveEnd,
        })
        const res = await app.request('/v1/mobile/permits', {
          headers: { Authorization: authHeader },
        })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.data.items).toEqual([
          expect.objectContaining({
            id: 'approved-period',
            requested_start_date: '2026-11-01',
            original_end_date: originalEnd ?? '2026-11-01',
            effective_end_date: expectedEnd,
            approval_status: 'approved',
          }),
        ])
      },
    )

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
