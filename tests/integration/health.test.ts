import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { ErrorCode } from '../../src/lib/errors/codes.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../src/providers/memory/index.js'
import type { RobinClient } from '../../src/clients/robin/client.js'

function createMockRobinClient(healthy = true): RobinClient {
  return {
    checkReadiness: async () => ({ healthy, modelReady: healthy, qdrantConnected: healthy }),
    getEnrollmentStatus: async () => ({
      status: 'enrolled',
      embeddingCount: 1,
      message: 'Ready',
    }),
    enroll: async () => ({
      status: 'ok',
      userId: 'test-user',
      samplesReceived: 3,
      embeddingsCreated: 3,
      message: 'Enrolled successfully.',
    }),
    identify: async () => ({
      status: 'ok',
      candidateId: 'test-user',
      confidence: 0.95,
      threshold: 0.7,
      qualityScore: 0.9,
      processTimeMs: 120,
    }),
    deleteEnrollment: async () => {},
  }
}

describe('integration: runtime health & readiness probes', () => {
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

  it('returns 200 on /ready when all dependencies (database, objectStorage, identity, mlService, redis) are healthy', async () => {
    const domainStore = new MemoryDomainStore()
    const objectStorage = new MemoryObjectStorage()
    const identityProvider = new MemoryIdentityProvider()
    const robinClient = createMockRobinClient(true)

    const app = createApp({
      providers: { domainStore, objectStorage, identityProvider, robinClient },
    })

    const res = await app.request('/ready')
    // SAFETY: /ready endpoint returns ReadinessResult shape
    const body = (await res.json()) as {
      healthy: boolean
      checks: { database: string; objectStorage: string; identity: string; mlService: string; redis: string }
    }

    expect(res.status).toBe(200)
    expect(body.healthy).toBe(true)
    expect(body.checks).toEqual({
      database: 'ok',
      objectStorage: 'ok',
      identity: 'ok',
      mlService: 'ok',
      redis: 'ok',
    })
  })

  it('returns 503 on /ready when database check fails', async () => {
    const domainStore = new MemoryDomainStore()
    domainStore.isHealthy = false
    const objectStorage = new MemoryObjectStorage()
    const identityProvider = new MemoryIdentityProvider()
    const robinClient = createMockRobinClient(true)

    const app = createApp({
      providers: { domainStore, objectStorage, identityProvider, robinClient },
    })

    const res = await app.request('/ready')
    // SAFETY: /ready endpoint returns ReadinessResult shape
    const body = (await res.json()) as {
      healthy: boolean
      checks: { database: string; objectStorage: string; identity: string; mlService: string; redis: string }
    }

    expect(res.status).toBe(503)
    expect(body.healthy).toBe(false)
    expect(body.checks.database).toBe('fail')
  })

  it('returns 503 on /ready when object storage check fails', async () => {
    const domainStore = new MemoryDomainStore()
    const objectStorage = new MemoryObjectStorage()
    objectStorage.isHealthy = false
    const identityProvider = new MemoryIdentityProvider()
    const robinClient = createMockRobinClient(true)

    const app = createApp({
      providers: { domainStore, objectStorage, identityProvider, robinClient },
    })

    const res = await app.request('/ready')
    // SAFETY: /ready endpoint returns ReadinessResult shape
    const body = (await res.json()) as {
      healthy: boolean
      checks: { database: string; objectStorage: string; identity: string; mlService: string; redis: string }
    }

    expect(res.status).toBe(503)
    expect(body.healthy).toBe(false)
    expect(body.checks.objectStorage).toBe('fail')
  })

  it('returns 503 on /ready when identity provider check fails', async () => {
    const domainStore = new MemoryDomainStore()
    const objectStorage = new MemoryObjectStorage()
    const identityProvider = new MemoryIdentityProvider()
    identityProvider.isHealthy = false
    const robinClient = createMockRobinClient(true)

    const app = createApp({
      providers: { domainStore, objectStorage, identityProvider, robinClient },
    })

    const res = await app.request('/ready')
    // SAFETY: /ready endpoint returns ReadinessResult shape
    const body = (await res.json()) as {
      healthy: boolean
      checks: { database: string; objectStorage: string; identity: string; mlService: string; redis: string }
    }

    expect(res.status).toBe(503)
    expect(body.healthy).toBe(false)
    expect(body.checks.identity).toBe('fail')
  })

  it('returns 503 on /ready when ML service (Robin) check fails', async () => {
    const domainStore = new MemoryDomainStore()
    const objectStorage = new MemoryObjectStorage()
    const identityProvider = new MemoryIdentityProvider()
    const robinClient = createMockRobinClient(false)

    const app = createApp({
      providers: { domainStore, objectStorage, identityProvider, robinClient },
    })

    const res = await app.request('/ready')
    // SAFETY: /ready endpoint returns ReadinessResult shape
    const body = (await res.json()) as {
      healthy: boolean
      checks: { database: string; objectStorage: string; identity: string; mlService: string; redis: string }
    }

    expect(res.status).toBe(503)
    expect(body.healthy).toBe(false)
    expect(body.checks.mlService).toBe('fail')
  })

  it('returns mobile-safe health shape on /v1/mobile/health without leaking provider internals', async () => {
    const domainStore = new MemoryDomainStore()
    domainStore.isHealthy = false
    const objectStorage = new MemoryObjectStorage()
    const identityProvider = new MemoryIdentityProvider()
    const robinClient = createMockRobinClient(true)

    const app = createApp({
      providers: { domainStore, objectStorage, identityProvider, robinClient },
    })

    const res = await app.request('/v1/mobile/health')
    // SAFETY: /v1/mobile/health returns standard success envelope with health status
    const body = (await res.json()) as {
      success: boolean
      data: { status: 'healthy' | 'unhealthy' }
      message: string
      meta: { request_id: string }
    }

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.status).toBe('unhealthy')
    expect(body.meta.request_id).toBeTruthy()
    // Verify no provider names or internal database keys exist in response body
    const bodyStr = JSON.stringify(body)
    expect(bodyStr).not.toContain('database')
    expect(bodyStr).not.toContain('objectStorage')
    expect(bodyStr).not.toContain('identity')
    expect(bodyStr).not.toContain('mlService')
    expect(bodyStr).not.toContain('redis')
    expect(bodyStr).not.toContain('postgres')
    expect(bodyStr).not.toContain('supabase')
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
