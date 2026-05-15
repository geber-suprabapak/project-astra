import { describe, it, expect } from 'vitest'
import { env } from '../../../src/config/env.js'

describe('env config', () => {
  it('has all required timeout env vars', () => {
    expect(env.robinReadyTimeoutMs).toBeDefined()
    expect(env.robinIdentifyTimeoutMs).toBeDefined()
    expect(env.robinEnrollTimeoutMs).toBeDefined()
    expect(env.robinEnrollStatusTimeoutMs).toBeDefined()
    expect(env.supabaseQueryTimeoutMs).toBeDefined()
    expect(env.supabaseStorageUploadTimeoutMs).toBeDefined()
  })

  it('has default timeout values matching plan.md §6.4', () => {
    expect(env.robinReadyTimeoutMs).toBe(3000)
    expect(env.robinIdentifyTimeoutMs).toBe(30000)
    expect(env.robinEnrollTimeoutMs).toBe(60000)
    expect(env.robinEnrollStatusTimeoutMs).toBe(5000)
    expect(env.supabaseQueryTimeoutMs).toBe(5000)
    expect(env.supabaseStorageUploadTimeoutMs).toBe(15000)
  })

  it('has tenant config', () => {
    expect(env.tenantKey).toBeDefined()
    expect(env.tenantName).toBeDefined()
  })

  it('has business timezone', () => {
    expect(env.businessTimezone).toBe('Asia/Jakarta')
  })
})