import { describe, it, expect } from 'vitest'
import {
  ReadinessResponseSchema,
  LivenessResponseSchema,
  MobileHealthDataSchema,
  HealthChecksSchema,
} from '../../../src/modules/health/schema.js'

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
