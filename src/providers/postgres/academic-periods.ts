import type { Sql } from 'postgres'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
import type {
  AcademicPeriod,
  CreateAcademicPeriodParams,
  LockAcademicPeriodParams,
  UnlockAcademicPeriodParams,
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

async function assertPeriodReadyForActivationInTx(
  tx: PgQuery,
  schoolId: string,
  targetPeriodId: string | null,
  isLocked: boolean,
): Promise<void> {
  if (isLocked && targetPeriodId) {
    throw AppError.conflict('Locked academic period cannot be activated.', {
      reason_code: 'PERIOD_LOCKED',
      academic_period_id: targetPeriodId,
    })
  }

  await tx`SELECT id FROM schools WHERE id = ${schoolId}::uuid FOR UPDATE`

  const enrollmentExistsRows = await tx<{ exists: boolean }[]>`
    SELECT EXISTS(
      SELECT 1
      FROM class_enrollments ce
      JOIN academic_periods ap ON ap.id = ce.academic_period_id
      WHERE ap.school_id = ${schoolId}::uuid
    ) AS exists
  `
  const rosterExistsRows = await tx<{ exists: boolean }[]>`
    SELECT EXISTS(
      SELECT 1
      FROM roster_reports
      WHERE school_id = ${schoolId}::uuid AND status = 'accepted'
    ) AS exists
  `
  const isNonBootstrap =
    Boolean(enrollmentExistsRows[0]?.exists) || Boolean(rosterExistsRows[0]?.exists)

  if (!isNonBootstrap) return

  const activeEnrollmentRows = targetPeriodId
    ? await tx<{ count: string }[]>`
        SELECT COUNT(*) AS count
        FROM class_enrollments
        WHERE academic_period_id = ${targetPeriodId}::uuid AND status = 'active'
      `
    : [{ count: '0' }]
  const activeEnrollments = Number(activeEnrollmentRows[0]?.count ?? 0)

  const activeScheduleRows = targetPeriodId
    ? await tx<{ count: string }[]>`
        SELECT COUNT(*) AS count
        FROM schedules
        WHERE is_active = true
          AND (school_id = ${schoolId}::uuid OR school_id IS NULL)
          AND (academic_period_id = ${targetPeriodId}::uuid OR academic_period_id IS NULL)
      `
    : [{ count: '0' }]
  const activeSchedules = Number(activeScheduleRows[0]?.count ?? 0)

  if (activeEnrollments === 0 || activeSchedules === 0) {
    throw AppError.conflict('Target academic period is not ready for activation.', {
      reason_code: 'PERIOD_NOT_READY_FOR_ACTIVATION',
      target_period_id: targetPeriodId ?? 'new',
      active_enrollments: activeEnrollments,
      active_schedules: activeSchedules,
    })
  }
}

async function syncProfilesForActivePeriodInTx(tx: PgQuery, activePeriodId: string): Promise<void> {
  await tx`
    UPDATE profiles p
    SET class_name = sub.class_name, updated_at = NOW()
    FROM (
      SELECT ce.user_id, c.name AS class_name
      FROM class_enrollments ce
      JOIN classes c ON c.id = ce.class_id
      WHERE ce.academic_period_id = ${activePeriodId}::uuid
        AND ce.status = 'active'
        AND ce.user_id IS NOT NULL
    ) sub
    WHERE p.user_id = sub.user_id
  `
  await tx`
    UPDATE profiles p
    SET class_name = NULL, updated_at = NOW()
    WHERE p.role = 'student'
      AND p.class_name IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM class_enrollments ce
        WHERE ce.user_id = p.user_id
          AND ce.academic_period_id = ${activePeriodId}::uuid
          AND ce.status = 'active'
      )
  `
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
          SELECT id, school_id, name, start_date::text, end_date::text, is_active,
                 COALESCE(is_locked, false) AS is_locked, locked_at::text, locked_by, lock_reason,
                 created_at::text, updated_at::text
          FROM academic_periods
          WHERE is_active = ${filter.isActive}
          ORDER BY start_date DESC
        `
        return rows ?? []
      }
      const rows = await sql<AcademicPeriod[]>`
        SELECT id, school_id, name, start_date::text, end_date::text, is_active,
               COALESCE(is_locked, false) AS is_locked, locked_at::text, locked_by, lock_reason,
               created_at::text, updated_at::text
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
        SELECT id, school_id, name, start_date::text, end_date::text, is_active,
               COALESCE(is_locked, false) AS is_locked, locked_at::text, locked_by, lock_reason,
               created_at::text, updated_at::text
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
        SELECT id, school_id, name, start_date::text, end_date::text, is_active,
               COALESCE(is_locked, false) AS is_locked, locked_at::text, locked_by, lock_reason,
               created_at::text, updated_at::text
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
  if (params.startDate > params.endDate) {
    throw AppError.validationError('start_date must be less than or equal to end_date.')
  }
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to create academic period'),
    async () => {
      const schoolId = await resolveSchoolId(sql, params.schoolId, DEFAULT_SCHOOL_ID)
      const isActive = params.isActive ?? false

      return await runInTransaction(sql, async (tx) => {
        if (isActive && schoolId) {
          await assertPeriodReadyForActivationInTx(tx, schoolId, null, false)
          await tx`UPDATE academic_periods SET is_active = false, updated_at = NOW() WHERE school_id = ${schoolId}`
        }
        const rows = await tx<AcademicPeriod[]>`
          INSERT INTO academic_periods (school_id, name, start_date, end_date, is_active)
          VALUES (${schoolId}, ${params.name}, ${params.startDate}::date, ${params.endDate}::date, ${isActive})
          RETURNING id, school_id, name, start_date::text, end_date::text, is_active,
                    COALESCE(is_locked, false) AS is_locked, locked_at::text, locked_by, lock_reason,
                    created_at::text, updated_at::text
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
        const existingRows = await tx<
          {
            id: string
            school_id: string
            start_date: string
            end_date: string
            is_active: boolean
            is_locked: boolean
          }[]
        >`
          SELECT id, school_id, start_date::text, end_date::text, is_active, COALESCE(is_locked, false) AS is_locked
          FROM academic_periods
          WHERE id = ${id}
          LIMIT 1
        `
        const existing = existingRows[0]
        if (!existing) {
          throw AppError.notFound('Academic period')
        }

        const effectiveStart = params.startDate ?? existing.start_date
        const effectiveEnd = params.endDate ?? existing.end_date
        if (effectiveStart && effectiveEnd && effectiveStart > effectiveEnd) {
          throw AppError.validationError('start_date must be less than or equal to end_date.')
        }

        const modifiesCoreFields =
          params.name !== undefined ||
          params.startDate !== undefined ||
          params.endDate !== undefined
        if (existing.is_locked && modifiesCoreFields) {
          const reason = params.reason?.trim() ?? ''
          if (!params.overrideLocked || reason.length < 3) {
            throw AppError.conflict('Academic period is locked.', {
              reason_code: 'PERIOD_LOCKED',
              academic_period_id: id,
            })
          }
        }

        if (params.isActive === false && existing.is_active) {
          throw AppError.conflict('Cannot deactivate the currently active academic period.', {
            reason_code: 'CANNOT_DEACTIVATE_ACTIVE_PERIOD',
            academic_period_id: id,
          })
        }

        if (params.isActive === true && !existing.is_active) {
          await assertPeriodReadyForActivationInTx(
            tx,
            existing.school_id,
            id,
            Boolean(existing.is_locked),
          )
          await tx`UPDATE academic_periods SET is_active = false, updated_at = NOW() WHERE school_id = ${existing.school_id}`
        }

        const rows = await tx<AcademicPeriod[]>`
          UPDATE academic_periods
          SET
            name = COALESCE(${params.name ?? null}, name),
            start_date = COALESCE(${params.startDate ?? null}::date, start_date),
            end_date = COALESCE(${params.endDate ?? null}::date, end_date),
            is_active = COALESCE(${params.isActive ?? null}, is_active),
            updated_at = NOW()
          WHERE id = ${id}
          RETURNING id, school_id, name, start_date::text, end_date::text, is_active,
                    COALESCE(is_locked, false) AS is_locked, locked_at::text, locked_by, lock_reason,
                    created_at::text, updated_at::text
        `
        if (params.isActive === true && !existing.is_active) {
          await syncProfilesForActivePeriodInTx(tx, id)
        }
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
        const existingRows = await tx<
          { id: string; school_id: string; is_locked?: boolean }[]
        >`SELECT id, school_id, COALESCE(is_locked, false) AS is_locked FROM academic_periods WHERE id = ${id} LIMIT 1`
        const existing = existingRows[0]
        if (!existing) {
          throw AppError.notFound('Academic period')
        }

        await assertPeriodReadyForActivationInTx(
          tx,
          existing.school_id,
          id,
          Boolean(existing.is_locked),
        )

        await tx`UPDATE academic_periods SET is_active = false, updated_at = NOW() WHERE school_id = ${existing.school_id}`
        const rows = await tx<AcademicPeriod[]>`
          UPDATE academic_periods
          SET is_active = true, updated_at = NOW()
          WHERE id = ${id}
          RETURNING id, school_id, name, start_date::text, end_date::text, is_active,
                    COALESCE(is_locked, false) AS is_locked, locked_at::text, locked_by, lock_reason,
                    created_at::text, updated_at::text
        `
        await syncProfilesForActivePeriodInTx(tx, id)
        return rows[0]
      })
    },
  )
}

export async function lockAcademicPeriod(
  sql: Sql,
  params: LockAcademicPeriodParams,
): Promise<AcademicPeriod> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to lock academic period'),
    async () => {
      return await runInTransaction(sql, async (tx) => {
        const existing = await getAcademicPeriod(tx, params.id)
        if (!existing) throw AppError.notFound('Academic period')
        if (existing.is_locked) {
          throw AppError.conflict('Academic period is already locked.', {
            reason_code: 'PERIOD_ALREADY_LOCKED',
            academic_period_id: params.id,
          })
        }
        const rows = await tx<AcademicPeriod[]>`
          UPDATE academic_periods
          SET is_locked = true,
              locked_at = NOW(),
              locked_by = ${params.lockedBy},
              lock_reason = ${params.reason},
              updated_at = NOW()
          WHERE id = ${params.id}
          RETURNING id, school_id, name, start_date::text, end_date::text, is_active,
                    COALESCE(is_locked, false) AS is_locked, locked_at::text, locked_by, lock_reason,
                    created_at::text, updated_at::text
        `
        return rows[0]
      })
    },
  )
}

export async function unlockAcademicPeriod(
  sql: Sql,
  params: UnlockAcademicPeriodParams,
): Promise<AcademicPeriod> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to unlock academic period'),
    async () => {
      return await runInTransaction(sql, async (tx) => {
        const existing = await getAcademicPeriod(tx, params.id)
        if (!existing) throw AppError.notFound('Academic period')
        if (!existing.is_locked) {
          throw AppError.conflict('Academic period is not locked.', {
            reason_code: 'PERIOD_NOT_LOCKED',
            academic_period_id: params.id,
          })
        }
        const rows = await tx<AcademicPeriod[]>`
          UPDATE academic_periods
          SET is_locked = false,
              locked_at = NULL,
              locked_by = NULL,
              lock_reason = NULL,
              updated_at = NOW()
          WHERE id = ${params.id}
          RETURNING id, school_id, name, start_date::text, end_date::text, is_active,
                    COALESCE(is_locked, false) AS is_locked, locked_at::text, locked_by, lock_reason,
                    created_at::text, updated_at::text
        `
        return rows[0]
      })
    },
  )
}
