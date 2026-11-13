import { z } from 'zod'

export const filePurposeSchema = z.enum([
  'avatar',
  'permit_attachment',
  'face_enrollment',
  'adiwiyata_report',
])
export type FilePurpose = z.infer<typeof filePurposeSchema>

export const fileLifecycleSchema = z.enum(['pending_upload', 'available', 'rejected', 'deleted'])
export type FileLifecycle = z.infer<typeof fileLifecycleSchema>

export interface FileRecord {
  id: string
  user_id: string
  purpose: FilePurpose
  object_path: string
  content_type: string
  size_bytes?: number | null
  lifecycle: FileLifecycle
  created_at?: string
  updated_at?: string
}

export interface CreateFileRecordParams {
  userId: string
  purpose: FilePurpose
  objectPath: string
  contentType: string
  sizeBytes?: number | null
  lifecycle?: FileLifecycle
}

export const faceEnrollmentStatusSchema = z.enum(['not_enrolled', 'pending', 'enrolled', 'failed'])
export type FaceEnrollmentStatus = z.infer<typeof faceEnrollmentStatusSchema>

export interface FaceEnrollmentRecord {
  id: string
  user_id: string
  status: FaceEnrollmentStatus
  sample_count: number
  created_at?: string
  updated_at?: string
}

export interface SaveFaceEnrollmentParams {
  userId: string
  status: FaceEnrollmentStatus
  sampleCount?: number
}

export const notificationChannelSchema = z.enum(['push', 'email'])
export type NotificationChannel = z.infer<typeof notificationChannelSchema>

export const notificationStatusSchema = z.enum(['pending', 'processing', 'delivered', 'failed'])
export type NotificationStatus = z.infer<typeof notificationStatusSchema>

export const notificationPayloadValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.undefined(),
  z.array(z.string()),
  z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.undefined()])),
])
export type NotificationPayloadValue = z.infer<typeof notificationPayloadValueSchema>

export const notificationPayloadSchema = z.record(z.string(), notificationPayloadValueSchema)
export type NotificationPayload = z.infer<typeof notificationPayloadSchema>

export interface NotificationRecord {
  id: string
  user_id: string
  channel: NotificationChannel
  payload: NotificationPayload
  status: NotificationStatus
  retry_count: number
  next_retry_at?: string | null
  error_message?: string | null
  created_at?: string
  updated_at?: string
}

export interface EnqueueNotificationParams {
  userId: string
  channel: NotificationChannel
  payload: NotificationPayload
  eventKey?: string | null
  nextRetryAt?: string | null
  status?: NotificationStatus
}

export interface ListNotificationsFilter {
  userId?: string
  channel?: NotificationChannel
  status?: NotificationStatus
  limit?: number
  offset?: number
}

export interface UpdateNotificationStatusParams {
  id: string
  status: NotificationStatus
  errorMessage?: string | null
  retryCount?: number
  nextRetryAt?: string | null
  expectedCurrentStatus?: NotificationStatus
  expectedUpdatedAt?: string
}

export interface ClaimPendingNotificationsParams {
  limit?: number
  maxRetries?: number
  now?: Date | string
  leaseMs?: number
}
