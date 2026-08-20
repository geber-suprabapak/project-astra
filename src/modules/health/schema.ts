import { z } from 'zod'

export const CheckStatusSchema = z.enum(['ok', 'fail'])
export type CheckStatus = z.infer<typeof CheckStatusSchema>

export const HealthChecksSchema = z.object({
  database: CheckStatusSchema,
  objectStorage: CheckStatusSchema,
  identity: CheckStatusSchema,
  mlService: CheckStatusSchema,
  redis: CheckStatusSchema,
})
export type HealthChecks = z.infer<typeof HealthChecksSchema>

export const ReadinessResponseSchema = z.object({
  healthy: z.boolean(),
  checks: HealthChecksSchema,
})
export type ReadinessResult = z.infer<typeof ReadinessResponseSchema>

export const LivenessResponseSchema = z.object({
  status: z.literal('ok'),
})
export type LivenessResponse = z.infer<typeof LivenessResponseSchema>

export const MobileHealthStatusSchema = z.enum(['healthy', 'unhealthy'])
export type MobileHealthStatus = z.infer<typeof MobileHealthStatusSchema>

export const MobileHealthDataSchema = z.object({
  status: MobileHealthStatusSchema,
})
export type MobileHealthData = z.infer<typeof MobileHealthDataSchema>
