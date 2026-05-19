import { describe, it, expect } from 'vitest'
import { env, parseEnv } from '../../../src/config/env.js'

const baseEnv = {
  NODE_ENV: 'test',
  TENANT_KEY: 'test-school',
  TENANT_NAME: 'Test School',
  CORS_ALLOWED_ORIGINS: 'http://localhost:8081',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_JWT_SECRET: 'jwt-secret',
  ROBIN_BASE_URL: 'http://localhost:8000',
} satisfies Record<string, string>

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

  it('requires REDIS_URL in production', () => {
    const parsed = parseEnv({
      ...baseEnv,
      NODE_ENV: 'production',
    })

    expect(parsed.success).toBe(false)
    expect(parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'))).toContain(
      'REDIS_URL',
    )
  })

  it('allows non-production envs without REDIS_URL', () => {
    const parsed = parseEnv(baseEnv)

    expect(parsed.success).toBe(true)
  })

  it('sets the default Redis key prefix', () => {
    const parsed = parseEnv({
      ...baseEnv,
      REDIS_URL: 'redis://localhost:6379',
    })

    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.REDIS_KEY_PREFIX).toBe('astra:ratelimit')
    }
  })
})
