import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { ErrorCode } from '../../src/lib/errors/codes.js'
import type { ReadinessResult } from '../../src/modules/health/service.js'

describe('integration: app runtime contract', () => {
  it('preserves a safe request ID end-to-end', async () => {
    const app = createApp()
    const requestId = 'chronos-018f6f0c-4f7f-7d8d-9c43-111111111111'
    const res = await app.request('/live', {
      headers: { 'X-Request-ID': requestId },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('X-Request-ID')).toBe(requestId)
  })

  it('replaces an unsafe request ID before returning or logging it', async () => {
    const app = createApp()
    const res = await app.request('/live', {
      headers: { 'X-Request-ID': 'unsafe request id' },
    })
    const responseRequestId = res.headers.get('X-Request-ID')

    expect(res.status).toBe(200)
    expect(responseRequestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(responseRequestId).not.toContain('unsafe')
  })

  it('returns liveness payload and security headers on /live', async () => {
    const app = createApp()
    const res = await app.request('/live')
    // SAFETY: /live endpoint returns standard JSON status object
    const body = (await res.json()) as { status: string }

    expect(res.status).toBe(200)
    expect(body).toEqual({ status: 'ok' })
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })

  it('returns 200 on /ready when dependencies are healthy', async () => {
    const app = createApp({
      getReadiness: async (): Promise<ReadinessResult> => ({
        healthy: true,
        checks: {
          database: 'ok',
          objectStorage: 'ok',
          identity: 'ok',
          mlService: 'ok',
          redis: 'ok',
        },
      }),
    })

    const res = await app.request('/ready')
    // SAFETY: /ready endpoint returns ReadinessResult shape
    const body = (await res.json()) as {
      healthy: boolean
      checks: {
        database: string
        objectStorage: string
        identity: string
        mlService: string
        redis: string
      }
    }

    expect(res.status).toBe(200)
    expect(body).toEqual({
      healthy: true,
      checks: { database: 'ok', objectStorage: 'ok', identity: 'ok', mlService: 'ok', redis: 'ok' },
    })
  })

  it('returns 503 on /ready when dependencies are unhealthy', async () => {
    const app = createApp({
      getReadiness: async (): Promise<ReadinessResult> => ({
        healthy: false,
        checks: {
          database: 'ok',
          objectStorage: 'ok',
          identity: 'ok',
          mlService: 'fail',
          redis: 'ok',
        },
      }),
    })

    const res = await app.request('/ready')
    // SAFETY: /ready endpoint returns ReadinessResult shape
    const body = (await res.json()) as {
      healthy: boolean
      checks: {
        database: string
        objectStorage: string
        identity: string
        mlService: string
        redis: string
      }
    }

    expect(res.status).toBe(503)
    expect(body).toEqual({
      healthy: false,
      checks: {
        database: 'ok',
        objectStorage: 'ok',
        identity: 'ok',
        mlService: 'fail',
        redis: 'ok',
      },
    })
  })

  it('returns mobile-safe health shape on /v1/mobile/health', async () => {
    const app = createApp({
      getReadiness: async (): Promise<ReadinessResult> => ({
        healthy: false,
        checks: {
          database: 'fail',
          objectStorage: 'ok',
          identity: 'ok',
          mlService: 'ok',
          redis: 'ok',
        },
      }),
    })

    const res = await app.request('/v1/mobile/health')
    // SAFETY: /v1/mobile/health returns standard success envelope with health status
    const body = (await res.json()) as {
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
    const app = createApp()
    const res = await app.request('/v1/mobile/time')
    // SAFETY: unauthenticated request returns error envelope with code
    const body = (await res.json()) as { error: { code: string } }

    expect(res.status).toBe(401)
    expect(body.error.code).toBe(ErrorCode.AUTH_REQUIRED)
  })
})
