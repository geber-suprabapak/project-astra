import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../src/lib/errors/codes.js'

const { getReadinessMock } = vi.hoisted(() => ({
  getReadinessMock: vi.fn(),
}))

vi.mock('../../src/modules/health/service.js', () => ({
  getReadiness: getReadinessMock,
  getLiveness: () => ({ status: 'ok' }),
}))

const { app } = await import('../../src/app.js')

describe('integration: app runtime contract', () => {
  beforeEach(() => {
    getReadinessMock.mockReset()
  })

  it('returns liveness payload and security headers on /live', async () => {
    const res = await app.request('/live')
    const body = await res.json() as { status: string }

    expect(res.status).toBe(200)
    expect(body).toEqual({ status: 'ok' })
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })

  it('returns 200 on /ready when dependencies are healthy', async () => {
    getReadinessMock.mockResolvedValueOnce({
      healthy: true,
      checks: { database: 'ok', mlService: 'ok' },
    })

    const res = await app.request('/ready')
    const body = await res.json() as {
      healthy: boolean
      checks: { database: string; mlService: string }
    }

    expect(res.status).toBe(200)
    expect(body).toEqual({
      healthy: true,
      checks: { database: 'ok', mlService: 'ok' },
    })
  })

  it('returns 503 on /ready when dependencies are unhealthy', async () => {
    getReadinessMock.mockResolvedValueOnce({
      healthy: false,
      checks: { database: 'ok', mlService: 'fail' },
    })

    const res = await app.request('/ready')
    const body = await res.json() as {
      healthy: boolean
      checks: { database: string; mlService: string }
    }

    expect(res.status).toBe(503)
    expect(body).toEqual({
      healthy: false,
      checks: { database: 'ok', mlService: 'fail' },
    })
  })

  it('returns mobile-safe health shape on /v1/mobile/health', async () => {
    getReadinessMock.mockResolvedValueOnce({
      healthy: false,
      checks: { database: 'fail', mlService: 'ok' },
    })

    const res = await app.request('/v1/mobile/health')
    const body = await res.json() as {
      success: boolean
      data: { status: 'healthy' | 'unhealthy' }
      meta: { request_id: string }
    }

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.status).toBe('unhealthy')
    expect(body.meta.request_id).toBeTruthy()
  })

  it('enforces auth on protected endpoints', async () => {
    const res = await app.request('/v1/mobile/time')
    const body = await res.json() as { error: { code: string } }

    expect(res.status).toBe(401)
    expect(body.error.code).toBe(ErrorCode.AUTH_REQUIRED)
  })
})
