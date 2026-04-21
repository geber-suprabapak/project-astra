import type { MiddlewareHandler } from 'hono'
import { env } from '../config/env.js'
import { AppError } from '../lib/errors/app-error.js'
import type { AppEnv } from '../types/context.js'

// ---------------------------------------------------------------------------
// RateLimitStore — abstraction layer for Redis-ready swap
// ---------------------------------------------------------------------------
export interface RateLimitStore {
  /** Returns the number of hits in the current window after incrementing. */
  increment(key: string, windowMs: number): Promise<number>
  reset(key: string): Promise<void>
}

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

// Singleton default store
const defaultStore = new MemoryRateLimitStore()

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
      throw new AppError(
        'VALIDATION_ERROR',
        429,
        'Rate limit exceeded. Please slow down.',
      )
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
}
