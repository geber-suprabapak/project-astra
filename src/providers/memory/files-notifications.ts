import { AppError } from '../../lib/errors/app-error.js'
import type {
  ClaimPendingNotificationsParams,
  CreateFileRecordParams,
  EnqueueNotificationParams,
  FaceEnrollmentRecord,
  FileLifecycle,
  FilePurpose,
  FileRecord,
  ListNotificationsFilter,
  NotificationRecord,
  SaveFaceEnrollmentParams,
  UpdateNotificationStatusParams,
} from '../types.js'
import type { MemoryDomainState } from './domain-state.js'

export function createMemoryFileRecord(
  store: MemoryDomainState,
  params: CreateFileRecordParams,
): FileRecord {
  const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const now = new Date().toISOString()
  const record: FileRecord = {
    id,
    user_id: params.userId,
    purpose: params.purpose,
    object_path: params.objectPath,
    content_type: params.contentType,
    size_bytes: params.sizeBytes ?? null,
    lifecycle: params.lifecycle ?? 'available',
    created_at: now,
    updated_at: now,
  }
  store.files.set(id, record)
  return { ...record }
}

export function getMemoryFileRecord(store: MemoryDomainState, id: string): FileRecord | null {
  const record = store.files.get(id)
  return record ? { ...record } : null
}

export function listMemoryFiles(
  store: MemoryDomainState,
  filter?: {
    userId?: string
    purpose?: FilePurpose
    lifecycle?: FileLifecycle
  },
): FileRecord[] {
  let result = Array.from(store.files.values())
  if (filter?.userId) {
    result = result.filter((f) => f.user_id === filter.userId)
  }
  if (filter?.purpose) {
    result = result.filter((f) => f.purpose === filter.purpose)
  }
  if (filter?.lifecycle) {
    result = result.filter((f) => f.lifecycle === filter.lifecycle)
  }
  return result.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
}

export function updateMemoryFileLifecycle(
  store: MemoryDomainState,
  id: string,
  lifecycle: FileLifecycle,
): FileRecord {
  const record = store.files.get(id)
  if (!record) {
    throw AppError.notFound('File record')
  }
  const updated: FileRecord = {
    ...record,
    lifecycle,
    updated_at: new Date().toISOString(),
  }
  store.files.set(id, updated)
  return { ...updated }
}

export function deleteMemoryFileRecord(store: MemoryDomainState, id: string): void {
  const record = store.files.get(id)
  if (record) {
    store.files.set(id, {
      ...record,
      lifecycle: 'deleted',
      updated_at: new Date().toISOString(),
    })
  }
}

export function deleteMemoryFaceEnrollmentFiles(store: MemoryDomainState, userId: string): number {
  let count = 0
  for (const [id, file] of store.files.entries()) {
    if (
      file.user_id === userId &&
      file.purpose === 'face_enrollment' &&
      file.lifecycle !== 'deleted'
    ) {
      store.files.set(id, {
        ...file,
        lifecycle: 'deleted',
        updated_at: new Date().toISOString(),
      })
      count++
    }
  }
  return count
}

export function getMemoryFaceEnrollment(
  store: MemoryDomainState,
  userId: string,
): FaceEnrollmentRecord | null {
  const record = store.faceEnrollments.get(userId)
  return record ? { ...record } : null
}

export function saveMemoryFaceEnrollment(
  store: MemoryDomainState,
  params: SaveFaceEnrollmentParams,
): FaceEnrollmentRecord {
  const existing = store.faceEnrollments.get(params.userId)
  const now = new Date().toISOString()
  const record: FaceEnrollmentRecord = {
    id: existing?.id ?? `face-enrollment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    user_id: params.userId,
    status: params.status,
    sample_count: params.sampleCount ?? existing?.sample_count ?? 10,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  }
  store.faceEnrollments.set(params.userId, record)
  return { ...record }
}

export function deleteMemoryFaceEnrollment(store: MemoryDomainState, userId: string): void {
  const existing = store.faceEnrollments.get(userId)
  if (existing) {
    store.faceEnrollments.set(userId, {
      ...existing,
      status: 'not_enrolled',
      sample_count: 0,
      updated_at: new Date().toISOString(),
    })
  }
}

export function enqueueMemoryNotification(
  store: MemoryDomainState,
  params: EnqueueNotificationParams,
): NotificationRecord {
  const eventKey =
    params.eventKey ?? (params.payload?.event_key ? String(params.payload.event_key) : null)
  const normalizedPayload = eventKey
    ? { ...params.payload, event_key: eventKey }
    : { ...params.payload }

  if (eventKey) {
    for (const existing of store.notifications.values()) {
      if (
        existing.user_id === params.userId &&
        existing.channel === params.channel &&
        existing.payload?.event_key === eventKey
      ) {
        return { ...existing }
      }
    }
  }

  const now = new Date().toISOString()
  const record: NotificationRecord = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    user_id: params.userId,
    channel: params.channel,
    payload: normalizedPayload,
    status: params.status ?? 'pending',
    retry_count: 0,
    next_retry_at: params.nextRetryAt ?? null,
    error_message: null,
    created_at: now,
    updated_at: now,
  }
  store.notifications.set(record.id, record)
  return { ...record }
}

export function getMemoryNotificationById(
  store: MemoryDomainState,
  id: string,
): NotificationRecord | null {
  const record = store.notifications.get(id)
  return record ? { ...record } : null
}

export function listMemoryNotifications(
  store: MemoryDomainState,
  filter?: ListNotificationsFilter,
): NotificationRecord[] {
  let result = Array.from(store.notifications.values())
  if (filter?.userId) {
    result = result.filter((n) => n.user_id === filter.userId)
  }
  if (filter?.channel) {
    result = result.filter((n) => n.channel === filter.channel)
  }
  if (filter?.status) {
    result = result.filter((n) => n.status === filter.status)
  }
  result.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  if (filter?.offset) {
    result = result.slice(filter.offset)
  }
  if (filter?.limit) {
    result = result.slice(0, filter.limit)
  }
  return result.map((r) => ({ ...r }))
}

export function claimMemoryPendingNotifications(
  store: MemoryDomainState,
  params?: ClaimPendingNotificationsParams,
): NotificationRecord[] {
  const limit = params?.limit ?? 10
  const maxRetries = params?.maxRetries ?? 3
  const leaseMs = params?.leaseMs ?? 120_000
  const now = params?.now ? new Date(params.now).getTime() : Date.now()
  const leaseCutoff = now - leaseMs
  const claimed: NotificationRecord[] = []

  for (const record of store.notifications.values()) {
    if (claimed.length >= limit) break
    if (record.retry_count >= maxRetries) continue

    const isClaimablePending =
      record.status === 'pending' &&
      (!record.next_retry_at || new Date(record.next_retry_at).getTime() <= now)
    const isStaleProcessing =
      record.status === 'processing' &&
      (!record.updated_at || new Date(record.updated_at).getTime() <= leaseCutoff)

    if (!isClaimablePending && !isStaleProcessing) continue

    const updated: NotificationRecord = {
      ...record,
      status: 'processing',
      updated_at: new Date(now).toISOString(),
    }
    store.notifications.set(record.id, updated)
    claimed.push({ ...updated })
  }

  return claimed
}

export function updateMemoryNotificationStatus(
  store: MemoryDomainState,
  params: UpdateNotificationStatusParams,
): NotificationRecord {
  const record = store.notifications.get(params.id)
  if (!record) {
    throw AppError.notFound('Notification')
  }
  if (
    (params.expectedCurrentStatus && record.status !== params.expectedCurrentStatus) ||
    (params.expectedUpdatedAt && record.updated_at !== params.expectedUpdatedAt)
  ) {
    throw AppError.conflict('Notification claim lease is no longer active.')
  }
  const updated: NotificationRecord = {
    ...record,
    status: params.status,
    retry_count: params.retryCount !== undefined ? params.retryCount : record.retry_count,
    next_retry_at: params.nextRetryAt !== undefined ? params.nextRetryAt : record.next_retry_at,
    error_message: params.errorMessage !== undefined ? params.errorMessage : record.error_message,
    updated_at: new Date().toISOString(),
  }
  store.notifications.set(params.id, updated)
  return { ...updated }
}

export function deleteMemoryNotification(store: MemoryDomainState, id: string): void {
  store.notifications.delete(id)
}
