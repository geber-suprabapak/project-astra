import { describe, it, expect } from 'vitest'
import { getServerTime } from '../../../src/modules/time/service.js'

describe('getServerTime', () => {
  it('returns now, timezone, and source=bff', () => {
    const result = getServerTime()
    expect(result.timezone).toBe('Asia/Jakarta')
    expect(result.source).toBe('bff')
    expect(result.now).toBeTruthy()
    expect(Number.isFinite(result.epoch_ms)).toBe(true)
  })
})
