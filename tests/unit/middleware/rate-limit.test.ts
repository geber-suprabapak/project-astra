import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRateLimitStore } from '../../../src/middleware/rate-limit.js'

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
