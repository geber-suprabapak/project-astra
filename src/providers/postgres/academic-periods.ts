import type { Sql } from 'postgres'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
import type {
  AcademicPeriod,
  CreateAcademicPeriodParams,
  UpdateAcademicPeriodParams,
} from '../types.js'
import {
  DEFAULT_SCHOOL_ID,
  resolveSchoolId,
  runInTransaction,
  withPgError,
  type PgQuery,
} from './shared.js'

export interface AcademicPeriodFilter {
  isActive?: boolean
}

export async function listAcademicPeriods(
  sql: Sql,
  filter?: AcademicPeriodFilter,
): Promise<AcademicPeriod[]> {
  return withPgError(
    (err) => logger.error({ err, filter }, 'Failed to list academic periods'),
    async () => {
      if (filter?.isActive !== undefined) {
        const rows = await sql<AcademicPeriod[]>`
          SELECT id, school_id, name, start_date::text, end_date::text, is_active, created_at::text, updated_at::text
          FROM academic_periods
          WHERE is_active = ${filter.isActive}
          ORDER BY start_date DESC
        `
        return rows ?? []
      }
      const rows = await sql<AcademicPeriod[]>`
        SELECT id, school_id, name, start_date::text, end_date::text, is_active, created_at::text, updated_at::text
        FROM academic_periods
        ORDER BY start_date DESC
      `
      return rows ?? []
    },
  )
}

export async function getAcademicPeriod(sql: PgQuery, id: string): Promise<AcademicPeriod | null> {
  return withPgError(
    (err) => logger.error({ err, id }, 'Failed to get academic period'),
    async () => {
      const rows = await sql<AcademicPeriod[]>`
        SELECT id, school_id, name, start_date::text, end_date::text, is_active, created_at::text, updated_at::text
        FROM academic_periods
        WHERE id = ${id}
        LIMIT 1
      `
      return rows[0] ?? null
    },
  )
}

export async function getActiveAcademicPeriod(sql: PgQuery): Promise<AcademicPeriod | null> {
  return withPgError(
    (err) => logger.error({ err }, 'Failed to query active academic period'),
    async () => {
      const rows = await sql<AcademicPeriod[]>`
        SELECT id, school_id, name, start_date::text, end_date::text, is_active, created_at::text, updated_at::text
        FROM academic_periods
        WHERE is_active = true
        LIMIT 1
      `
      return rows[0] ?? null
    },
  )
}

export async function createAcademicPeriod(
  sql: Sql,
  params: CreateAcademicPeriodParams,
): Promise<AcademicPeriod> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to create academic period'),
    async () => {
      const schoolId = await resolveSchoolId(sql, params.schoolId, DEFAULT_SCHOOL_ID)
      const isActive = params.isActive ?? true

      return await runInTransaction(sql, async (tx) => {
        if (isActive) {
          await tx`UPDATE academic_periods SET is_active = false, updated_at = NOW() WHERE school_id = ${schoolId}`
        }
        const rows = await tx<AcademicPeriod[]>`
          INSERT INTO academic_periods (school_id, name, start_date, end_date, is_active)
          VALUES (${schoolId}, ${params.name}, ${params.startDate}::date, ${params.endDate}::date, ${isActive})
          RETURNING id, school_id, name, start_date::text, end_date::text, is_active, created_at::text, updated_at::text
        `
        if (!rows || rows.length === 0) {
          throw AppError.internal('Failed to create academic period.')
        }
        return rows[0]
      })
    },
  )
}

export async function updateAcademicPeriod(
  sql: Sql,
  id: string,
  params: UpdateAcademicPeriodParams,
): Promise<AcademicPeriod> {
  return withPgError(
    (err) => logger.error({ err, id, params }, 'Failed to update academic period'),
    async () => {
      return await runInTransaction(sql, async (tx) => {
        const existing = await tx<
          { id: string; school_id: string }[]
        >`SELECT id, school_id FROM academic_periods WHERE id = ${id} LIMIT 1`
        if (!existing || existing.length === 0) {
          throw AppError.notFound('Academic period')
        }
        if (params.isActive === true) {
          await tx`UPDATE academic_periods SET is_active = false, updated_at = NOW() WHERE school_id = ${existing[0].school_id}`
        }
        const rows = await tx<AcademicPeriod[]>`
          UPDATE academic_periods
          SET
            name = COALESCE(${params.name ?? null}, name),
            start_date = COALESCE(${params.startDate ? `${params.startDate}::date` : null}, start_date),
            end_date = COALESCE(${params.endDate ? `${params.endDate}::date` : null}, end_date),
            is_active = COALESCE(${params.isActive ?? null}, is_active),
            updated_at = NOW()
          WHERE id = ${id}
          RETURNING id, school_id, name, start_date::text, end_date::text, is_active, created_at::text, updated_at::text
        `
        return rows[0]
      })
    },
  )
}

export async function setActiveAcademicPeriod(sql: Sql, id: string): Promise<AcademicPeriod> {
  return withPgError(
    (err) => logger.error({ err, id }, 'Failed to set active academic period'),
    async () => {
      return await runInTransaction(sql, async (tx) => {
        const existing = await tx<
          { id: string; school_id: string }[]
        >`SELECT id, school_id FROM academic_periods WHERE id = ${id} LIMIT 1`
        if (!existing || existing.length === 0) {
          throw AppError.notFound('Academic period')
        }
        await tx`UPDATE academic_periods SET is_active = false, updated_at = NOW() WHERE school_id = ${existing[0].school_id}`
        const rows = await tx<AcademicPeriod[]>`
          UPDATE academic_periods
          SET is_active = true, updated_at = NOW()
          WHERE id = ${id}
          RETURNING id, school_id, name, start_date::text, end_date::text, is_active, created_at::text, updated_at::text
        `
        return rows[0]
      })
    },
  )
}
