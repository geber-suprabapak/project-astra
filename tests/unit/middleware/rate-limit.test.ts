import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../../src/lib/errors/app-error.js'
import {
  MemoryRateLimitStore,
  RedisRateLimitStore,
  createRateLimitStore,
  rateLimit,
} from '../../../src/middleware/rate-limit.js'
import type { AppEnv } from '../../../src/types/context.js'

describe('MemoryRateLimitStore', () => {
  let store: MemoryRateLimitStore

  beforeEach(() => {
    store = new MemoryRateLimitStore()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('increments count per key', async () => {
    expect(await store.increment('key1', 60_000)).toBe(1)
    expect(await store.increment('key1', 60_000)).toBe(2)
    expect(await store.increment('key1', 60_000)).toBe(3)
  })

  it('different keys are independent', async () => {
    expect(await store.increment('key1', 60_000)).toBe(1)
    expect(await store.increment('key2', 60_000)).toBe(1)
  })

  it('prunes entries outside window', async () => {
    await store.increment('key1', 1000)
    vi.advanceTimersByTime(1500) // past window
    expect(await store.increment('key1', 1000)).toBe(1) // old entry pruned
  })

  it('reset clears the key', async () => {
    await store.increment('key1', 60_000)
    await store.increment('key1', 60_000)
    await store.reset('key1')
    expect(await store.increment('key1', 60_000)).toBe(1)
  })
})

describe('RedisRateLimitStore', () => {
  it('passes prefixed keys and sliding-window args to Redis', async () => {
    const evalMock = vi.fn().mockResolvedValue(2)
    const delMock = vi.fn().mockResolvedValue(1)
    const now = vi.fn(() => 1_717_171_717_000)
    const store = new RedisRateLimitStore(
      {
        eval: evalMock,
        del: delMock,
      },
      'astra:ratelimit',
      now,
    )

    await expect(store.increment('tenant:user:dashboard', 60_000)).resolves.toBe(2)
    await store.reset('tenant:user:dashboard')

    expect(evalMock).toHaveBeenCalledTimes(1)
    expect(evalMock.mock.calls[0]?.[1]).toEqual({
      keys: ['astra:ratelimit:tenant:user:dashboard'],
      arguments: ['1717171717000', '60000'],
    })
    expect(delMock).toHaveBeenCalledWith('astra:ratelimit:tenant:user:dashboard')
    expect(delMock).toHaveBeenCalledWith('astra:ratelimit:tenant:user:dashboard:seq')
  })
})

describe('createRateLimitStore', () => {
  it('falls back to memory when REDIS_URL is absent', () => {
    const result = createRateLimitStore({
      nodeEnv: 'test',
      redisKeyPrefix: 'astra:ratelimit',
    })

    expect(result.backend).toBe('memory')
    expect(result.store).toBeInstanceOf(MemoryRateLimitStore)
  })

  it('uses Redis when REDIS_URL is configured', () => {
    const result = createRateLimitStore(
      {
        nodeEnv: 'production',
        redisKeyPrefix: 'astra:ratelimit',
        redisUrl: 'redis://localhost:6379',
      },
      {
        redisClient: {
          eval: vi.fn().mockResolvedValue(1),
          del: vi.fn().mockResolvedValue(1),
        },
      },
    )

    expect(result.backend).toBe('redis')
    expect(result.store).toBeInstanceOf(RedisRateLimitStore)
  })
})

describe('rateLimit middleware', () => {
  it('returns 429 once the limit is exceeded', async () => {
    const app = new Hono<AppEnv>()
    const store = new MemoryRateLimitStore()

    app.use('*', async (c, next) => {
      c.set('userId', 'user-1')
      await next()
    })
    app.get('/limited', rateLimit({ windowMs: 60_000, max: 1, routeKey: 'limited', store }), (c) =>
      c.json({ ok: true }),
    )
    app.onError((err) => {
      const status = err instanceof AppError ? err.httpStatus : 500
      const message = err instanceof Error ? err.message : 'error'
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    })

    const first = await app.request('/limited')
    const second = await app.request('/limited')

    expect(first.status).toBe(200)
    expect(second.status).toBe(429)
  })
})
