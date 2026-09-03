import { z } from 'zod'

// Observed from mobile CameraAttendance.tsx FaceRecogResponse interface
export const RobinIdentifyResponseSchema = z.object({
  status: z.string(),
  student_id: z.string().nullish(),
  student_name: z.string().nullish(),
  confidence: z.number().nullish(),
  quality_score: z.number().nullish(),
  process_time_ms: z.number().nullish(),
  message: z.string().nullish(),
})

export interface RobinIdentifyResult {
  status: string
  confidence?: number
  qualityScore?: number
  processTimeMs: number
  message?: string
}

// Observed from mobile utils/enrollment.ts EnrollmentStatusResponse interface
export const RobinEnrollStatusResponseSchema = z.object({
  is_enrolled: z.boolean(),
  embedding_count: z.number().nullish(),
  user_id: z.string().nullish(),
})

export const RobinEnrollResponseSchema = z.object({
  status: z.string().nullish(),
  student_id: z.string().nullish(),
  images_processed: z.number().nullish(),
  images_failed: z.number().nullish(),
  total_embeddings: z.number().nullish(),
  message: z.string().nullish(),
})

export const RobinReadinessSchema = z.object({
  status: z.string().nullish(),
})

export type RobinIdentifyResponse = z.infer<typeof RobinIdentifyResponseSchema>
export type RobinEnrollStatusResponse = z.infer<typeof RobinEnrollStatusResponseSchema>
export type RobinEnrollResponse = z.infer<typeof RobinEnrollResponseSchema>

// Mobile-safe normalized types (no identity leakage)
export interface RobinEnrollStatus {
  status: 'enrolled' | 'not_enrolled'
  embeddingCount: number
  message: string
}

export interface RobinEnrollResult {
  imagesProcessed: number
  imagesFailed: number
  totalEmbeddings: number
}
