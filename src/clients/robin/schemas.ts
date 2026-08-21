import { z } from 'zod'

// Observed from mobile CameraAttendance.tsx FaceRecogResponse interface
export const RobinIdentifyResponseSchema = z.object({
  status: z.string(),
  student_id: z.string().optional(),
  student_name: z.string().optional(),
  confidence: z.number().optional(),
  quality_score: z.number().optional(),
  process_time_ms: z.number().optional(),
  message: z.string().optional(),
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
  embedding_count: z.number().optional(),
  user_id: z.string().optional(),
})

export const RobinEnrollResponseSchema = z.object({
  images_processed: z.number().optional(),
  images_failed: z.number().optional(),
  total_embeddings: z.number().optional(),
  message: z.string().optional(),
})

export const RobinReadinessSchema = z.object({
  status: z.string().optional(),
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
