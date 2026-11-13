import type { Sql } from 'postgres'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
import type {
  CreateFileRecordParams,
  CreatePasswordResetCodeParams,
  FaceEnrollmentRecord,
  FileLifecycle,
  FilePurpose,
  FileRecord,
  PasswordResetCode,
  SaveFaceEnrollmentParams,
} from '../types.js'
import { withPgError } from './shared.js'

export interface FileListFilter {
  userId?: string
  purpose?: FilePurpose
  lifecycle?: FileLifecycle
}

export async function createPasswordResetCode(
  sql: Sql,
  params: CreatePasswordResetCodeParams,
): Promise<PasswordResetCode> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to create password reset code'),
    async () => {
      const rows = await sql<PasswordResetCode[]>`
        INSERT INTO password_reset_codes (user_id, code, expires_at, created_by)
        VALUES (${params.userId}, ${params.code}, ${params.expiresAt}, ${params.createdBy ?? null})
        RETURNING id, user_id, code, expires_at::text, used, used_at::text, created_by, created_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.internal('Failed to create password reset code.')
      }
      return rows[0]
    },
  )
}

export async function getActivePasswordResetCode(
  sql: Sql,
  userId: string,
  code: string,
): Promise<PasswordResetCode | null> {
  return withPgError(
    (err) => logger.error({ err, userId, code }, 'Failed to query active reset code'),
    async () => {
      const rows = await sql<PasswordResetCode[]>`
        SELECT id, user_id, code, expires_at::text, used, used_at::text, created_by, created_at::text
        FROM password_reset_codes
        WHERE user_id = ${userId} AND code = ${code} AND used = false AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
      `
      return rows[0] ?? null
    },
  )
}

export async function markPasswordResetCodeUsed(sql: Sql, codeId: string): Promise<void> {
  return withPgError(
    (err) => logger.error({ err, codeId }, 'Failed to mark password reset code as used'),
    async () => {
      await sql`
        UPDATE password_reset_codes
        SET used = true, used_at = NOW()
        WHERE id = ${codeId}
      `
    },
  )
}

export async function createFileRecord(
  sql: Sql,
  params: CreateFileRecordParams,
): Promise<FileRecord> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to create file record'),
    async () => {
      const rows = await sql<FileRecord[]>`
        INSERT INTO files (user_id, purpose, object_path, content_type, size_bytes, lifecycle)
        VALUES (
          ${params.userId},
          ${params.purpose},
          ${params.objectPath},
          ${params.contentType},
          ${params.sizeBytes ?? null},
          ${params.lifecycle ?? 'available'}
        )
        RETURNING id, user_id, purpose, object_path, content_type, size_bytes::double precision AS size_bytes, lifecycle, created_at::text, updated_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.internal('Failed to create file record.')
      }
      return rows[0]
    },
  )
}

export async function getFileRecord(sql: Sql, id: string): Promise<FileRecord | null> {
  return withPgError(
    (err) => logger.error({ err, id }, 'Failed to get file record'),
    async () => {
      const rows = await sql<FileRecord[]>`
        SELECT id, user_id, purpose, object_path, content_type, size_bytes::double precision AS size_bytes, lifecycle, created_at::text, updated_at::text
        FROM files
        WHERE id = ${id}
        LIMIT 1
      `
      return rows[0] ?? null
    },
  )
}

export async function listFiles(sql: Sql, filter?: FileListFilter): Promise<FileRecord[]> {
  return withPgError(
    (err) => logger.error({ err, filter }, 'Failed to list file records'),
    async () => {
      const rows = await sql<FileRecord[]>`
        SELECT id, user_id, purpose, object_path, content_type, size_bytes::double precision AS size_bytes, lifecycle, created_at::text, updated_at::text
        FROM files
        WHERE (${filter?.userId ?? null}::text IS NULL OR user_id = ${filter?.userId ?? null})
          AND (${filter?.purpose ?? null}::text IS NULL OR purpose = ${filter?.purpose ?? null})
          AND (${filter?.lifecycle ?? null}::text IS NULL OR lifecycle = ${filter?.lifecycle ?? null})
        ORDER BY created_at DESC
      `
      return rows
    },
  )
}

export async function updateFileLifecycle(
  sql: Sql,
  id: string,
  lifecycle: FileLifecycle,
): Promise<FileRecord> {
  return withPgError(
    (err) => logger.error({ err, id, lifecycle }, 'Failed to update file lifecycle'),
    async () => {
      const rows = await sql<FileRecord[]>`
        UPDATE files
        SET lifecycle = ${lifecycle}, updated_at = NOW()
        WHERE id = ${id}
        RETURNING id, user_id, purpose, object_path, content_type, size_bytes::double precision AS size_bytes, lifecycle, created_at::text, updated_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.notFound('File record')
      }
      return rows[0]
    },
  )
}

export async function deleteFileRecord(sql: Sql, id: string): Promise<void> {
  return withPgError(
    (err) => logger.error({ err, id }, 'Failed to delete file record'),
    async () => {
      await sql`
        UPDATE files
        SET lifecycle = 'deleted', updated_at = NOW()
        WHERE id = ${id}
      `
    },
  )
}

export async function deleteFaceEnrollmentFiles(sql: Sql, userId: string): Promise<number> {
  return withPgError(
    (err) => logger.error({ err, userId }, 'Failed to delete face enrollment files'),
    async () => {
      const result = await sql`
        UPDATE files
        SET lifecycle = 'deleted', updated_at = NOW()
        WHERE user_id = ${userId} AND purpose = 'face_enrollment' AND lifecycle != 'deleted'
      `
      return result.count ?? 0
    },
  )
}

export async function getFaceEnrollment(
  sql: Sql,
  userId: string,
): Promise<FaceEnrollmentRecord | null> {
  return withPgError(
    (err) => logger.error({ err, userId }, 'Failed to get face enrollment'),
    async () => {
      const rows = await sql<FaceEnrollmentRecord[]>`
        SELECT id, user_id, status, sample_count, created_at::text, updated_at::text
        FROM face_enrollments
        WHERE user_id = ${userId}
        LIMIT 1
      `
      return rows[0] ?? null
    },
  )
}

export async function saveFaceEnrollment(
  sql: Sql,
  params: SaveFaceEnrollmentParams,
): Promise<FaceEnrollmentRecord> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to save face enrollment'),
    async () => {
      const rows = await sql<FaceEnrollmentRecord[]>`
        INSERT INTO face_enrollments (user_id, status, sample_count, updated_at)
        VALUES (${params.userId}, ${params.status}, ${params.sampleCount ?? 10}, NOW())
        ON CONFLICT (user_id) DO UPDATE
        SET status = EXCLUDED.status,
            sample_count = EXCLUDED.sample_count,
            updated_at = NOW()
        RETURNING id, user_id, status, sample_count, created_at::text, updated_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.internal('Failed to save face enrollment record.')
      }
      return rows[0]
    },
  )
}

export async function deleteFaceEnrollment(sql: Sql, userId: string): Promise<void> {
  return withPgError(
    (err) => logger.error({ err, userId }, 'Failed to delete face enrollment'),
    async () => {
      await sql`
        UPDATE face_enrollments
        SET status = 'not_enrolled', sample_count = 0, updated_at = NOW()
        WHERE user_id = ${userId}
      `
    },
  )
}
