import type { MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { getRedisClient, type RedisRuntimeClient } from '../clients/redis.js'
import { env } from '../config/env.js'
import { AppError } from '../lib/errors/app-error.js'
import type { AppEnv } from '../types/context.js'

const RATE_LIMIT_SCRIPT = `
local cutoff = tonumber(ARGV[1]) - tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff)
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[1] .. '-' .. redis.call('INCR', KEYS[1] .. ':seq'))
redis.call('PEXPIRE', KEYS[1], ARGV[2])
redis.call('PEXPIRE', KEYS[1] .. ':seq', ARGV[2])
return redis.call('ZCARD', KEYS[1])
`

export type RateLimitBackend = 'memory' | 'redis'

// ---------------------------------------------------------------------------
// RateLimitStore — abstraction layer for Redis-ready swap
// ---------------------------------------------------------------------------
export interface RateLimitStore {
  /** Returns the number of hits in the current window after incrementing. */
  increment(key: string, windowMs: number): Promise<number>
  reset(key: string): Promise<void>
}

export type RedisStoreClient = Pick<RedisRuntimeClient, 'del' | 'eval'>

// ---------------------------------------------------------------------------
// MemoryRateLimitStore — in-process sliding window (v1 default)
// ---------------------------------------------------------------------------
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, number[]>()

  increment(key: string, windowMs: number): Promise<number> {
    const now = Date.now()
    const cutoff = now - windowMs
    const timestamps = (this.windows.get(key) ?? []).filter((t) => t > cutoff)
    timestamps.push(now)
    this.windows.set(key, timestamps)
    return Promise.resolve(timestamps.length)
  }

  reset(key: string): Promise<void> {
    this.windows.delete(key)
    return Promise.resolve()
  }
}

export class RedisRateLimitStore implements RateLimitStore {
  constructor(
    private readonly client: RedisStoreClient,
    private readonly keyPrefix: string,
    private readonly now: () => number = Date.now,
  ) {}

  async increment(key: string, windowMs: number): Promise<number> {
    const result = await this.client.eval(RATE_LIMIT_SCRIPT, {
      keys: [this.prefixedKey(key)],
      arguments: [String(this.now()), String(windowMs)],
    })

    const parsed = z.number().safeParse(result)
    if (!parsed.success) {
      throw new Error('Unexpected Redis rate limit response.')
    }

    return parsed.data
  }

  async reset(key: string): Promise<void> {
    const redisKey = this.prefixedKey(key)
    await this.client.del(redisKey)
    await this.client.del(`${redisKey}:seq`)
  }

  private prefixedKey(key: string) {
    return `${this.keyPrefix}:${key}`
  }
}

interface RateLimitEnvConfig {
  nodeEnv: string
  redisKeyPrefix: string
  redisUrl?: string
}

export interface RateLimitStoreResult {
  backend: RateLimitBackend
  store: RateLimitStore
}

export function createRateLimitStore(
  config: RateLimitEnvConfig,
  deps: { redisClient?: RedisStoreClient | null } = {},
): RateLimitStoreResult {
  if (!config.redisUrl) {
    return { backend: 'memory', store: new MemoryRateLimitStore() }
  }

  const redisClient = deps.redisClient ?? getRedisClient()
  if (!redisClient) {
    throw new Error('REDIS_URL is configured but Redis client is unavailable.')
  }

  return {
    backend: 'redis',
    store: new RedisRateLimitStore(redisClient, config.redisKeyPrefix),
  }
}

const { backend: rateLimitBackend, store: defaultStore } = createRateLimitStore(env)

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
interface RateLimitOptions {
  windowMs: number
  max: number
  routeKey: string
  store?: RateLimitStore
}

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler<AppEnv> {
  const store = opts.store ?? defaultStore

  return async (c, next) => {
    const userId = c.get('userId')
    if (!userId) {
      // Auth middleware should have run first; skip limiting if no user
      await next()
      return
    }

    const key = `${env.tenantKey}:${userId}:${opts.routeKey}`
    const hits = await store.increment(key, opts.windowMs)

    if (hits > opts.max) {
      throw new AppError('VALIDATION_ERROR', 429, 'Rate limit exceeded. Please slow down.')
    }

    await next()
  }
}

// ---------------------------------------------------------------------------
// Named presets — sesuai plan.md §6.5
// ---------------------------------------------------------------------------
export const rateLimits = {
  dashboard: rateLimit({ windowMs: 60_000, max: 60, routeKey: 'dashboard' }),
  attendancePrecheck: rateLimit({ windowMs: 60_000, max: 12, routeKey: 'att-precheck' }),
  attendanceSubmit: rateLimit({ windowMs: 60_000, max: 6, routeKey: 'att-submit' }),
  enrollStatus: rateLimit({ windowMs: 60_000, max: 30, routeKey: 'enroll-status' }),
  enrollment: rateLimit({ windowMs: 600_000, max: 2, routeKey: 'enroll' }),
  permitsGet: rateLimit({ windowMs: 60_000, max: 30, routeKey: 'permits-get' }),
  permitsPost: rateLimit({ windowMs: 3_600_000, max: 5, routeKey: 'permits-post' }),
  profileAvatar: rateLimit({ windowMs: 3_600_000, max: 10, routeKey: 'profile-avatar' }),
  profilePassword: rateLimit({ windowMs: 3_600_000, max: 5, routeKey: 'profile-pass' }),
  time: rateLimit({ windowMs: 60_000, max: 30, routeKey: 'time' }),
  adminSession: rateLimit({ windowMs: 60_000, max: 30, routeKey: 'admin-session' }),
  standard: rateLimit({ windowMs: 60_000, max: 60, routeKey: 'standard' }),
  files: rateLimit({ windowMs: 60_000, max: 30, routeKey: 'files' }),
}

export { RATE_LIMIT_SCRIPT, defaultStore, rateLimitBackend }
