import type { Sql } from 'postgres'
import { z } from 'zod'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
import {
  notificationPayloadSchema,
  type ClaimPendingNotificationsParams,
  type EnqueueNotificationParams,
  type ListNotificationsFilter,
  type NotificationChannel,
  type NotificationRecord,
  type NotificationStatus,
  type UpdateNotificationStatusParams,
} from '../types.js'
import { withPgError, type PgQuery } from './shared.js'

const storedNotificationPayloadSchema = z.union([
  notificationPayloadSchema,
  z.string().transform((value) => notificationPayloadSchema.parse(JSON.parse(value))),
])

interface NotificationDbRow {
  id: string
  user_id: string
  channel: string
  payload: z.infer<typeof storedNotificationPayloadSchema>
  status: string
  retry_count: number | string | null
  next_retry_at: string | Date | null
  error_message: string | null
  created_at: string | Date | null
  updated_at: string | Date | null
}

function mapNotificationRow(row: NotificationDbRow): NotificationRecord {
  // Older writes stored serialized JSON inside a JSONB string; validate both forms.
  const payload = storedNotificationPayloadSchema.parse(row.payload ?? {})
  return {
    id: row.id,
    user_id: row.user_id,
    // SAFETY: channel is validated by table check constraint
    channel: row.channel as NotificationChannel,
    payload,
    // SAFETY: status is validated by table check constraint
    status: row.status as NotificationStatus,
    retry_count: Number(row.retry_count ?? 0),
    next_retry_at: row.next_retry_at ? new Date(row.next_retry_at).toISOString() : null,
    error_message: row.error_message ?? null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
  }
}

export async function insertNotificationOutboxRow(
  sql: PgQuery,
  params: EnqueueNotificationParams,
): Promise<NotificationRecord> {
  const eventKey =
    params.eventKey ?? (params.payload?.event_key ? String(params.payload.event_key) : null)
  const normalizedPayload = eventKey
    ? { ...params.payload, event_key: eventKey }
    : { ...params.payload }

  if (eventKey) {
    const existing = await sql<NotificationDbRow[]>`
      SELECT
        id,
        user_id,
        channel,
        payload,
        status,
        retry_count,
        next_retry_at::text,
        error_message,
        created_at::text,
        updated_at::text
      FROM notification_outbox
      WHERE user_id = ${params.userId}
        AND channel = ${params.channel}
        AND payload->>'event_key' = ${eventKey}
      ORDER BY created_at DESC
      LIMIT 1
    `
    if (existing && existing.length > 0) {
      return mapNotificationRow(existing[0])
    }
  }

  const payloadJson = JSON.stringify(normalizedPayload)
  const nextRetryAtVal = params.nextRetryAt ? new Date(params.nextRetryAt).toISOString() : null
  const rows = await sql<NotificationDbRow[]>`
    INSERT INTO notification_outbox (
      user_id,
      channel,
      payload,
      status,
      retry_count,
      next_retry_at
    )
    VALUES (
      ${params.userId},
      ${params.channel},
      ${payloadJson}::text::jsonb,
      ${params.status ?? 'pending'},
      0,
      ${nextRetryAtVal ? sql`${nextRetryAtVal}::timestamptz` : null}
    )
    RETURNING
      id,
      user_id,
      channel,
      payload,
      status,
      retry_count,
      next_retry_at::text,
      error_message,
      created_at::text,
      updated_at::text
  `
  if (!rows || rows.length === 0) {
    throw AppError.internal('Failed to enqueue notification.')
  }
  return mapNotificationRow(rows[0])
}

export async function enqueueNotification(
  sql: Sql,
  params: EnqueueNotificationParams,
): Promise<NotificationRecord> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to enqueue notification'),
    () => insertNotificationOutboxRow(sql, params),
  )
}

export async function getNotificationById(
  sql: Sql,
  id: string,
): Promise<NotificationRecord | null> {
  return withPgError(
    (err) => logger.error({ err, id }, 'Failed to get notification by id'),
    async () => {
      const rows = await sql<NotificationDbRow[]>`
        SELECT
          id,
          user_id,
          channel,
          payload,
          status,
          retry_count,
          next_retry_at::text,
          error_message,
          created_at::text,
          updated_at::text
        FROM notification_outbox
        WHERE id = ${id}
        LIMIT 1
      `
      if (!rows || rows.length === 0) return null
      return mapNotificationRow(rows[0])
    },
  )
}

export async function listNotifications(
  sql: Sql,
  filter?: ListNotificationsFilter,
): Promise<NotificationRecord[]> {
  return withPgError(
    (err) => logger.error({ err, filter }, 'Failed to list notifications'),
    async () => {
      const limit = filter?.limit ?? 50
      const offset = filter?.offset ?? 0
      const rows = await sql<NotificationDbRow[]>`
        SELECT
          id,
          user_id,
          channel,
          payload,
          status,
          retry_count,
          next_retry_at::text,
          error_message,
          created_at::text,
          updated_at::text
        FROM notification_outbox
        WHERE (${filter?.userId ?? null}::text IS NULL OR user_id = ${filter?.userId ?? null})
          AND (${filter?.channel ?? null}::text IS NULL OR channel = ${filter?.channel ?? null})
          AND (${filter?.status ?? null}::text IS NULL OR status = ${filter?.status ?? null})
        ORDER BY created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `
      return rows.map((row) => mapNotificationRow(row))
    },
  )
}

export async function claimPendingNotifications(
  sql: Sql,
  params?: ClaimPendingNotificationsParams,
): Promise<NotificationRecord[]> {
  const limit = params?.limit ?? 10
  const maxRetries = params?.maxRetries ?? 3
  const leaseMs = params?.leaseMs ?? 120_000
  const nowMs = params?.now ? new Date(params.now).getTime() : Date.now()
  const nowIso = new Date(nowMs).toISOString()
  const leaseCutoffIso = new Date(nowMs - leaseMs).toISOString()

  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to claim pending notifications'),
    async () => {
      const rows = await sql<NotificationDbRow[]>`
        WITH claimable AS (
          SELECT id
          FROM notification_outbox
          WHERE (
            (status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= ${nowIso}::timestamptz))
            OR (status = 'processing' AND updated_at <= ${leaseCutoffIso}::timestamptz)
          )
            AND retry_count < ${maxRetries}
          ORDER BY created_at ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE notification_outbox
        SET status = 'processing', updated_at = ${nowIso}::timestamptz
        FROM claimable
        WHERE notification_outbox.id = claimable.id
        RETURNING
          notification_outbox.id,
          notification_outbox.user_id,
          notification_outbox.channel,
          notification_outbox.payload,
          notification_outbox.status,
          notification_outbox.retry_count,
          notification_outbox.next_retry_at::text,
          notification_outbox.error_message,
          notification_outbox.created_at::text,
          notification_outbox.updated_at::text
      `
      return rows.map((row) => mapNotificationRow(row))
    },
  )
}

export async function updateNotificationStatus(
  sql: Sql,
  params: UpdateNotificationStatusParams,
): Promise<NotificationRecord> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to update notification status'),
    async () => {
      const nextRetryAtVal = params.nextRetryAt ? new Date(params.nextRetryAt).toISOString() : null
      const statusGuard = params.expectedCurrentStatus
        ? sql`AND status = ${params.expectedCurrentStatus}`
        : sql``
      const leaseGuard = params.expectedUpdatedAt
        ? sql`AND updated_at = ${params.expectedUpdatedAt}::timestamptz`
        : sql``
      const rows = await sql<NotificationDbRow[]>`
        UPDATE notification_outbox
        SET
          status = ${params.status},
          error_message = ${params.errorMessage !== undefined ? params.errorMessage : null},
          retry_count = ${params.retryCount !== undefined ? params.retryCount : sql`retry_count`},
          next_retry_at = ${params.nextRetryAt !== undefined ? (nextRetryAtVal ? sql`${nextRetryAtVal}::timestamptz` : null) : sql`next_retry_at`},
          updated_at = NOW()
        WHERE id = ${params.id}
          ${statusGuard}
          ${leaseGuard}
        RETURNING
          id,
          user_id,
          channel,
          payload,
          status,
          retry_count,
          next_retry_at::text,
          error_message,
          created_at::text,
          updated_at::text
      `
      if (!rows || rows.length === 0) {
        if (params.expectedCurrentStatus || params.expectedUpdatedAt) {
          const existing = await getNotificationById(sql, params.id)
          if (existing) {
            throw AppError.conflict('Notification claim lease is no longer active.')
          }
        }
        throw AppError.notFound('Notification')
      }
      return mapNotificationRow(rows[0])
    },
  )
}

export async function deleteNotification(sql: Sql, id: string): Promise<void> {
  return withPgError(
    (err) => logger.error({ err, id }, 'Failed to delete notification'),
    async () => {
      await sql`DELETE FROM notification_outbox WHERE id = ${id}`
    },
  )
}
