import { describe, it, expect, vi } from 'vitest'
import {
  ReadinessResponseSchema,
  LivenessResponseSchema,
  MobileHealthDataSchema,
  HealthChecksSchema,
} from '../../../src/modules/health/schema.js'
import type { HealthChecks } from '../../../src/modules/health/schema.js'
import { getReadiness } from '../../../src/modules/health/service.js'
import type {
  AppProviders,
  DomainStore,
  IdentityProvider,
  ObjectStorage,
} from '../../../src/providers/types.js'
import type { RobinClient } from '../../../src/clients/robin/client.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'

function neverResolves<T>(): Promise<T> {
  return new Promise<T>(() => {})
}

/**
 * Robin client where every mutating or status-querying member is a trap that
 * fails the test if readiness ever calls it; only checkReadiness answers.
 * SAFETY: getReadiness only invokes checkReadiness on the Robin seam, so the
 * remaining members exist solely to fail loudly if that invariant breaks.
 */
function trapRobinClient(): RobinClient {
  // SAFETY: getReadiness only invokes checkReadiness on the Robin seam, so the
  // remaining trap members only need to exist, never to conform to their types.
  return {
    checkReadiness: async () => ({ healthy: true }),
    getEnrollmentStatus: async () => {
      throw new Error('readiness must not query enrollment status')
    },
    enroll: async () => {
      throw new Error('readiness must not enroll')
    },
    identify: async () => {
      throw new Error('readiness must not identify')
    },
    deleteEnrollment: async () => {
      throw new Error('readiness must not delete enrollment')
    },
  } as RobinClient
}

describe('Health schema', () => {
  describe('HealthChecksSchema', () => {
    it('accepts all valid check status values', () => {
      const result = HealthChecksSchema.safeParse({
        database: 'ok',
        objectStorage: 'ok',
        identity: 'ok',
        mlService: 'ok',
        redis: 'ok',
      })
      expect(result.success).toBe(true)
    })

    it('rejects missing check field', () => {
      const result = HealthChecksSchema.safeParse({
        database: 'ok',
        objectStorage: 'ok',
        identity: 'ok',
        mlService: 'ok',
      })
      expect(result.success).toBe(false)
    })

    it('rejects invalid check value', () => {
      const result = HealthChecksSchema.safeParse({
        database: 'ok',
        objectStorage: 'ok',
        identity: 'ok',
        mlService: 'unknown',
        redis: 'ok',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('ReadinessResponseSchema', () => {
    it('accepts valid healthy readiness payload', () => {
      const result = ReadinessResponseSchema.safeParse({
        healthy: true,
        checks: {
          database: 'ok',
          objectStorage: 'ok',
          identity: 'ok',
          mlService: 'ok',
          redis: 'ok',
        },
      })
      expect(result.success).toBe(true)
    })

    it('accepts valid unhealthy readiness payload', () => {
      const result = ReadinessResponseSchema.safeParse({
        healthy: false,
        checks: {
          database: 'fail',
          objectStorage: 'ok',
          identity: 'ok',
          mlService: 'ok',
          redis: 'ok',
        },
      })
      expect(result.success).toBe(true)
    })

    it('rejects missing healthy boolean', () => {
      const result = ReadinessResponseSchema.safeParse({
        checks: {
          database: 'ok',
          objectStorage: 'ok',
          identity: 'ok',
          mlService: 'ok',
          redis: 'ok',
        },
      })
      expect(result.success).toBe(false)
    })
  })

  describe('LivenessResponseSchema', () => {
    it('accepts { status: "ok" }', () => {
      const result = LivenessResponseSchema.safeParse({ status: 'ok' })
      expect(result.success).toBe(true)
    })

    it('rejects unexpected status value', () => {
      const result = LivenessResponseSchema.safeParse({ status: 'unhealthy' })
      expect(result.success).toBe(false)
    })
  })

  describe('MobileHealthDataSchema', () => {
    it('accepts healthy status', () => {
      const result = MobileHealthDataSchema.safeParse({ status: 'healthy' })
      expect(result.success).toBe(true)
    })

    it('accepts unhealthy status', () => {
      const result = MobileHealthDataSchema.safeParse({ status: 'unhealthy' })
      expect(result.success).toBe(true)
    })

    it('rejects invalid mobile health status', () => {
      const result = MobileHealthDataSchema.safeParse({ status: 'ok' })
      expect(result.success).toBe(false)
    })
  })
})

describe('getReadiness (bounded, side-effect-free)', () => {
  // SAFETY: getReadiness only invokes checkHealth on the domain-store seam.
  const healthyStore = (): DomainStore => ({ checkHealth: async () => true }) as DomainStore

  // SAFETY: getReadiness only invokes checkHealth on the object-storage seam.
  const healthyStorage = (): ObjectStorage => ({ checkHealth: async () => true }) as ObjectStorage

  // SAFETY: getReadiness only invokes checkHealth on the identity seam.
  const healthyIdentity = (): IdentityProvider =>
    ({ checkHealth: async () => true }) as IdentityProvider

  // SAFETY: getReadiness only invokes checkReadiness on the Robin seam.
  const healthyRobin = (): RobinClient =>
    ({ checkReadiness: async () => ({ healthy: true }) }) as RobinClient

  const storeWith = (checkHealth: () => Promise<boolean>): DomainStore => {
    // SAFETY: getReadiness only invokes checkHealth on the domain-store seam.
    return { checkHealth } as DomainStore
  }

  const robinWith = (checkReadiness: () => Promise<{ healthy: boolean }>): RobinClient => {
    // SAFETY: getReadiness only invokes checkReadiness on the Robin seam.
    return { checkReadiness } as RobinClient
  }

  function readinessProviders(parts: {
    domainStore: DomainStore
    objectStorage: ObjectStorage
    identityProvider: IdentityProvider
    robinClient: RobinClient
  }): AppProviders {
    return parts
  }

  it('reports ok for every injected healthy dependency', async () => {
    const result = await getReadiness(
      readinessProviders({
        domainStore: healthyStore(),
        objectStorage: healthyStorage(),
        identityProvider: healthyIdentity(),
        robinClient: healthyRobin(),
      }),
      { deadlineMs: 200 },
    )
    expect(result).toEqual({
      healthy: true,
      checks: { database: 'ok', objectStorage: 'ok', identity: 'ok', mlService: 'ok', redis: 'ok' },
    })
    expect(ReadinessResponseSchema.safeParse(result).success).toBe(true)
  })

  it('reports the failing check for each injected unhealthy dependency', async () => {
    const failingStore = (): DomainStore => {
      // SAFETY: getReadiness only invokes checkHealth on the domain-store seam.
      return { checkHealth: async () => false } as DomainStore
    }
    const failingStorage = (): ObjectStorage => {
      // SAFETY: getReadiness only invokes checkHealth on the object-storage seam.
      return { checkHealth: async () => false } as ObjectStorage
    }
    const failingIdentity = (): IdentityProvider => {
      // SAFETY: getReadiness only invokes checkHealth on the identity seam.
      return { checkHealth: async () => false } as IdentityProvider
    }
    const failingRobin = (): RobinClient => {
      // SAFETY: getReadiness only invokes checkReadiness on the Robin seam.
      return { checkReadiness: async () => ({ healthy: false }) } as RobinClient
    }

    const cases: Array<{
      name: string
      providers: AppProviders
      failingCheck: keyof HealthChecks
    }> = [
      {
        name: 'database',
        providers: readinessProviders({
          domainStore: failingStore(),
          objectStorage: healthyStorage(),
          identityProvider: healthyIdentity(),
          robinClient: healthyRobin(),
        }),
        failingCheck: 'database',
      },
      {
        name: 'objectStorage',
        providers: readinessProviders({
          domainStore: healthyStore(),
          objectStorage: failingStorage(),
          identityProvider: healthyIdentity(),
          robinClient: healthyRobin(),
        }),
        failingCheck: 'objectStorage',
      },
      {
        name: 'identity',
        providers: readinessProviders({
          domainStore: healthyStore(),
          objectStorage: healthyStorage(),
          identityProvider: failingIdentity(),
          robinClient: healthyRobin(),
        }),
        failingCheck: 'identity',
      },
      {
        name: 'mlService',
        providers: readinessProviders({
          domainStore: healthyStore(),
          objectStorage: healthyStorage(),
          identityProvider: healthyIdentity(),
          robinClient: failingRobin(),
        }),
        failingCheck: 'mlService',
      },
    ]

    for (const testCase of cases) {
      const result = await getReadiness(testCase.providers, { deadlineMs: 200 })
      const expected: HealthChecks = {
        database: 'ok',
        objectStorage: 'ok',
        identity: 'ok',
        mlService: 'ok',
        redis: 'ok',
      }
      expected[testCase.failingCheck] = 'fail'
      expect(result.healthy, testCase.name).toBe(false)
      expect(result.checks, testCase.name).toEqual(expected)
    }
  })

  it('settles within the injected deadline and reports fail when a dependency times out', async () => {
    const providers = readinessProviders({
      domainStore: storeWith(() => neverResolves<boolean>()),
      objectStorage: healthyStorage(),
      identityProvider: healthyIdentity(),
      robinClient: robinWith(() => neverResolves<{ healthy: boolean }>()),
    })

    const start = Date.now()
    const result = await getReadiness(providers, { deadlineMs: 50 })
    const elapsedMs = Date.now() - start

    expect(elapsedMs).toBeLessThan(2000)
    expect(result.healthy).toBe(false)
    expect(result.checks.database).toBe('fail')
    expect(result.checks.mlService).toBe('fail')
    expect(result.checks.objectStorage).toBe('ok')
  })

  it('still settles within the deadline when the injected Redis probe hangs', async () => {
    const providers = readinessProviders({
      domainStore: healthyStore(),
      objectStorage: healthyStorage(),
      identityProvider: healthyIdentity(),
      robinClient: healthyRobin(),
    })

    const start = Date.now()
    // Outside production without REDIS_URL the Redis check is optional, so the
    // hung probe cannot turn the result unhealthy; the guarantee under test is
    // that getReadiness still settles within the aggregate deadline.
    const result = await getReadiness(providers, {
      deadlineMs: 50,
      redisCheck: () => neverResolves<boolean>(),
    })
    const elapsedMs = Date.now() - start

    expect(elapsedMs).toBeLessThan(2000)
    expect(ReadinessResponseSchema.safeParse(result).success).toBe(true)
  })

  it('treats a rejected dependency check as fail and still returns a result', async () => {
    const providers = readinessProviders({
      domainStore: storeWith(() => Promise.reject(new Error('connection refused'))),
      objectStorage: healthyStorage(),
      identityProvider: healthyIdentity(),
      robinClient: healthyRobin(),
    })

    const result = await getReadiness(providers, { deadlineMs: 200 })
    expect(result.healthy).toBe(false)
    expect(result.checks.database).toBe('fail')
  })

  it('never creates provider data: readiness only performs the four health reads', async () => {
    const domainStore = new MemoryDomainStore()
    const objectStorage = new MemoryObjectStorage()
    const identityProvider = new MemoryIdentityProvider()
    const robinClient = trapRobinClient()

    const storeHealth = vi.spyOn(domainStore, 'checkHealth')
    const storageHealth = vi.spyOn(objectStorage, 'checkHealth')
    const identityHealth = vi.spyOn(identityProvider, 'checkHealth')
    const robinReady = vi.spyOn(robinClient, 'checkReadiness')
    const robinEnroll = vi.spyOn(robinClient, 'enroll')
    const robinIdentify = vi.spyOn(robinClient, 'identify')
    const robinDelete = vi.spyOn(robinClient, 'deleteEnrollment')
    const robinStatus = vi.spyOn(robinClient, 'getEnrollmentStatus')

    const result = await getReadiness(
      readinessProviders({
        domainStore,
        objectStorage,
        identityProvider,
        robinClient,
      }),
      { deadlineMs: 200 },
    )

    expect(result.healthy).toBe(true)
    expect(storeHealth).toHaveBeenCalledTimes(1)
    expect(storageHealth).toHaveBeenCalledTimes(1)
    expect(identityHealth).toHaveBeenCalledTimes(1)
    expect(robinReady).toHaveBeenCalledTimes(1)
    expect(robinEnroll).not.toHaveBeenCalled()
    expect(robinIdentify).not.toHaveBeenCalled()
    expect(robinDelete).not.toHaveBeenCalled()
    expect(robinStatus).not.toHaveBeenCalled()

    // State-level proof: no provider data was created as a side effect.
    expect(domainStore.profiles.size).toBe(0)
    expect(domainStore.faceEnrollments.size).toBe(0)
    expect(identityProvider.users.size).toBe(0)
    expect(objectStorage.objects.size).toBe(0)
  })
})
