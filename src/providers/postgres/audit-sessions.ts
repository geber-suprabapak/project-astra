import type { Sql } from 'postgres'
import { logger } from '../../lib/logging/logger.js'
import type { CmsProfile } from '../../modules/cms/schema.js'
import type { AuditLog, AuditLogEntry } from '../types.js'
import { insertAuditLogRow, withPgError } from './shared.js'

export async function getCmsProfileBySubject(
  sql: Sql,
  subject: string,
): Promise<CmsProfile | null> {
  const rows = await sql<
    (Omit<CmsProfile, 'session_valid_after'> & {
      session_valid_after: Date | null
    })[]
  >`
    SELECT id, logto_subject, full_name, email, role, jurusan_id, jurusan_slug,
           authz_version, access_enabled, session_valid_after
    FROM cms.profiles
    WHERE logto_subject = ${subject}
    LIMIT 1
  `
  const profile = rows[0]
  return profile
    ? {
        ...profile,
        session_valid_after: profile.session_valid_after?.toISOString() ?? null,
      }
    : null
}

export async function insertAuditLog(sql: Sql, entry: AuditLogEntry): Promise<AuditLog> {
  return withPgError(
    (err) => logger.error({ err, entry }, 'Failed to insert audit log'),
    () => insertAuditLogRow(sql, entry),
  )
}

export async function getAuditLogs(
  sql: Sql,
  entityType?: string,
  entityId?: string,
): Promise<AuditLog[]> {
  return withPgError(
    (err) => logger.error({ err, entityType, entityId }, 'Failed to query audit logs'),
    async () => {
      if (entityType && entityId) {
        const rows = await sql<AuditLog[]>`
          SELECT id, actor_id, action, entity_type, entity_id,
                 CASE WHEN jsonb_typeof(details) = 'string' THEN (details #>> '{}')::jsonb ELSE details END AS details, created_at::text
          FROM audit_logs
          WHERE entity_type = ${entityType} AND entity_id = ${entityId}
          ORDER BY created_at DESC
        `
        return rows ?? []
      }
      if (entityType) {
        const rows = await sql<AuditLog[]>`
          SELECT id, actor_id, action, entity_type, entity_id,
                 CASE WHEN jsonb_typeof(details) = 'string' THEN (details #>> '{}')::jsonb ELSE details END AS details, created_at::text
          FROM audit_logs
          WHERE entity_type = ${entityType}
          ORDER BY created_at DESC
        `
        return rows ?? []
      }
      const rows = await sql<AuditLog[]>`
        SELECT id, actor_id, action, entity_type, entity_id,
               CASE WHEN jsonb_typeof(details) = 'string' THEN (details #>> '{}')::jsonb ELSE details END AS details, created_at::text
        FROM audit_logs
        ORDER BY created_at DESC
      `
      return rows ?? []
    },
  )
}

export async function revokeUserSessions(sql: Sql, userId: string): Promise<void> {
  return withPgError(
    (err) => logger.error({ err, userId }, 'Failed to revoke user sessions'),
    async () => {
      await sql`
        INSERT INTO revoked_sessions (user_id)
        VALUES (${userId})
      `
    },
  )
}

export async function isSessionRevoked(
  sql: Sql,
  userId: string,
  issuedAt?: number,
): Promise<boolean> {
  return withPgError(
    (err) => logger.error({ err, userId }, 'Failed to check session revocation'),
    async () => {
      // JWT iat has second precision; tokens from the revocation second stay revoked.
      const tokenTime =
        issuedAt !== undefined &&
        Number.isSafeInteger(issuedAt) &&
        issuedAt >= 0 &&
        issuedAt <= Math.floor(Date.now() / 1000)
          ? issuedAt
          : null
      const rows = await sql<{ count: string }[]>`
        SELECT COUNT(*) as count FROM revoked_sessions WHERE user_id = ${userId}
          AND (${tokenTime}::double precision IS NULL OR revoked_at >= to_timestamp(${tokenTime}::double precision))
      `
      return Number(rows[0]?.count ?? 0) > 0
    },
  )
}
