import { z } from 'zod'

export const MetaSchema = z.object({
  request_id: z.string(),
  timestamp: z.string().datetime(),
})

export const SuccessEnvelopeSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.unknown(),
  meta: MetaSchema,
})

export const ErrorDetailSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
})

export const ErrorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: ErrorDetailSchema,
  meta: MetaSchema,
})

export type Meta = z.infer<typeof MetaSchema>
export type SuccessEnvelope = z.infer<typeof SuccessEnvelopeSchema>
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>
