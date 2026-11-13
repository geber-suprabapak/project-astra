import type { Sql } from 'postgres'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
import type {
  ClassEnrollment,
  ClassEnrollmentStatus,
  ClassRoom,
  CreateClassParams,
  EnrollStudentParams,
  ExitStudentEnrollmentParams,
  PromoteStudentEnrollmentParams,
  TransferStudentEnrollmentParams,
  UpdateClassParams,
} from '../types.js'
import { getAcademicPeriod, getActiveAcademicPeriod } from './academic-periods.js'
import {
  DEFAULT_SCHOOL_ID,
  resolveSchoolId,
  runInTransaction,
  withPgError,
  type PgQuery,
} from './shared.js'

export interface ClassEnrollmentFilter {
  userId?: string
  classId?: string
  academicPeriodId?: string
  status?: ClassEnrollmentStatus
}

export interface EnrollmentTransitionResult {
  previous: ClassEnrollment
  current: ClassEnrollment
}

export async function getClasses(
  sql: Sql,
  schoolId?: string,
  academicPeriodId?: string,
): Promise<ClassRoom[]> {
  return withPgError(
    (err) => logger.error({ err, schoolId, academicPeriodId }, 'Failed to query classes'),
    async () => {
      const sId = schoolId ?? null
      const aId = academicPeriodId ?? null
      const rows = await sql<ClassRoom[]>`
        SELECT id, school_id, academic_period_id, name, grade, created_at::text, updated_at::text
        FROM classes
        WHERE (${sId}::uuid IS NULL OR school_id = ${sId}::uuid)
          AND (${aId}::uuid IS NULL OR academic_period_id = ${aId}::uuid)
        ORDER BY name ASC
      `
      return rows ?? []
    },
  )
}

export async function getClassById(sql: PgQuery, id: string): Promise<ClassRoom | null> {
  return withPgError(
    (err) => logger.error({ err, id }, 'Failed to get class by id'),
    async () => {
      const rows = await sql<ClassRoom[]>`
        SELECT id, school_id, academic_period_id, name, grade, created_at::text, updated_at::text
        FROM classes
        WHERE id = ${id}
        LIMIT 1
      `
      return rows[0] ?? null
    },
  )
}

export async function createClass(sql: Sql, params: CreateClassParams): Promise<ClassRoom> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to create class'),
    async () => {
      const schoolId = await resolveSchoolId(sql, params.schoolId, DEFAULT_SCHOOL_ID)
      const rows = await sql<ClassRoom[]>`
        INSERT INTO classes (school_id, academic_period_id, name, grade)
        VALUES (${schoolId}, ${params.academicPeriodId ?? null}, ${params.name}, ${params.grade ?? null})
        RETURNING id, school_id, academic_period_id, name, grade, created_at::text, updated_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.internal('Failed to create class.')
      }
      return rows[0]
    },
  )
}

export async function updateClass(
  sql: Sql,
  id: string,
  params: UpdateClassParams,
): Promise<ClassRoom> {
  return withPgError(
    (err) => logger.error({ err, id, params }, 'Failed to update class'),
    async () => {
      const existing = await getClassById(sql, id)
      if (!existing) throw AppError.notFound('Class')

      const rows = await sql<ClassRoom[]>`
        UPDATE classes
        SET
          name = COALESCE(${params.name ?? null}, name),
          grade = COALESCE(${params.grade ?? null}, grade),
          academic_period_id = COALESCE(${params.academicPeriodId ?? null}, academic_period_id),
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING id, school_id, academic_period_id, name, grade, created_at::text, updated_at::text
      `
      return rows[0]
    },
  )
}

export async function listClassEnrollments(
  sql: Sql,
  filter?: ClassEnrollmentFilter,
): Promise<ClassEnrollment[]> {
  return withPgError(
    (err) => logger.error({ err, filter }, 'Failed to list class enrollments'),
    async () => {
      const rows = await sql<ClassEnrollment[]>`
        SELECT ce.id, ce.student_id, ce.user_id, ce.class_id, ce.academic_period_id,
               COALESCE(ce.absence_number, p.absence_number) AS absence_number,
               ce.status, ce.created_at::text, ce.updated_at::text,
               c.name AS class_name, COALESCE(s.full_name, p.full_name) AS student_name,
               COALESCE(s.nis, p.nis) AS nis,
               ap.name AS period_name
        FROM class_enrollments ce
        LEFT JOIN classes c ON c.id = ce.class_id
        LEFT JOIN students s ON s.id = ce.student_id
        LEFT JOIN profiles p ON p.user_id = ce.user_id
        LEFT JOIN academic_periods ap ON ap.id = ce.academic_period_id
        WHERE (${filter?.userId ?? null}::text IS NULL OR ce.user_id = ${filter?.userId ?? null})
          AND (${filter?.classId ?? null}::uuid IS NULL OR ce.class_id = ${filter?.classId ?? null}::uuid)
          AND (${filter?.academicPeriodId ?? null}::uuid IS NULL OR ce.academic_period_id = ${filter?.academicPeriodId ?? null}::uuid)
          AND (${filter?.status ?? null}::text IS NULL OR ce.status = ${filter?.status ?? null})
        ORDER BY ce.created_at DESC
      `
      return rows ?? []
    },
  )
}

export async function getActiveClassEnrollment(
  sql: Sql,
  userId: string,
  academicPeriodId?: string,
): Promise<ClassEnrollment | null> {
  return withPgError(
    (err) =>
      logger.error({ err, userId, academicPeriodId }, 'Failed to get active class enrollment'),
    async () => {
      let targetPeriodId = academicPeriodId
      if (!targetPeriodId) {
        const activePeriod = await getActiveAcademicPeriod(sql)
        if (!activePeriod) return null
        targetPeriodId = activePeriod.id
      }

      const rows = await sql<ClassEnrollment[]>`
        SELECT ce.id, ce.student_id, ce.user_id, ce.class_id, ce.academic_period_id,
               COALESCE(ce.absence_number, p.absence_number) AS absence_number,
               ce.status, ce.created_at::text, ce.updated_at::text,
               c.name AS class_name, COALESCE(s.full_name, p.full_name) AS student_name,
               COALESCE(s.nis, p.nis) AS nis,
               ap.name AS period_name
        FROM class_enrollments ce
        LEFT JOIN classes c ON c.id = ce.class_id
        LEFT JOIN students s ON s.id = ce.student_id
        LEFT JOIN profiles p ON p.user_id = ce.user_id
        LEFT JOIN academic_periods ap ON ap.id = ce.academic_period_id
        WHERE ce.user_id = ${userId}
          AND ce.academic_period_id = ${targetPeriodId}::uuid
          AND ce.status = 'active'
        LIMIT 1
      `
      return rows[0] ?? null
    },
  )
}

export async function enrollStudentInClass(
  sql: Sql,
  params: EnrollStudentParams,
): Promise<ClassEnrollment> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to enroll student in class'),
    async () => {
      const cls = await getClassById(sql, params.classId)
      if (!cls) throw AppError.notFound('Class')
      const period = await getAcademicPeriod(sql, params.academicPeriodId)
      if (!period) throw AppError.notFound('Academic period')

      return await runInTransaction(sql, async (tx) => {
        const existing = await tx<ClassEnrollment[]>`
          SELECT id FROM class_enrollments
          WHERE user_id = ${params.userId} AND academic_period_id = ${params.academicPeriodId}::uuid AND status = 'active'
          LIMIT 1
        `
        if (existing && existing.length > 0) {
          throw AppError.conflict(
            'Student already has an active class enrollment in this academic period.',
          )
        }

        const rows = await tx<ClassEnrollment[]>`
          INSERT INTO class_enrollments (user_id, class_id, academic_period_id, status)
          VALUES (${params.userId}, ${params.classId}::uuid, ${params.academicPeriodId}::uuid, 'active')
          RETURNING id, user_id, class_id, academic_period_id, status, created_at::text, updated_at::text
        `

        await tx`
          UPDATE profiles SET class_name = ${cls.name}, updated_at = NOW() WHERE user_id = ${params.userId}
        `

        return {
          ...rows[0],
          class_name: cls.name,
          period_name: period.name,
        }
      })
    },
  )
}

export async function transferStudentEnrollment(
  sql: Sql,
  params: TransferStudentEnrollmentParams,
): Promise<EnrollmentTransitionResult> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to transfer student enrollment'),
    async () => {
      const targetClass = await getClassById(sql, params.toClassId)
      if (!targetClass) throw AppError.notFound('Target class')

      return await runInTransaction(sql, async (tx) => {
        const activeRows = await tx<ClassEnrollment[]>`
          SELECT id, student_id, user_id, class_id, academic_period_id, absence_number, status, created_at::text, updated_at::text
          FROM class_enrollments
          WHERE user_id = ${params.userId} AND academic_period_id = ${params.academicPeriodId}::uuid AND status = 'active'
          LIMIT 1
        `
        if (!activeRows || activeRows.length === 0) {
          throw AppError.notFound('Active class enrollment in this academic period')
        }
        const prev = activeRows[0]
        if (prev.class_id === params.toClassId) {
          throw AppError.validationError('Target class must be different from current class.')
        }

        const updatedPrevRows = await tx<ClassEnrollment[]>`
          UPDATE class_enrollments
          SET status = 'transferred', updated_at = NOW()
          WHERE id = ${prev.id}
          RETURNING id, student_id, user_id, class_id, academic_period_id, absence_number, status, created_at::text, updated_at::text
        `

        const newRows = await tx<ClassEnrollment[]>`
          INSERT INTO class_enrollments (student_id, user_id, class_id, academic_period_id, absence_number, status)
          VALUES (${prev.student_id ?? null}, ${params.userId}, ${params.toClassId}::uuid, ${params.academicPeriodId}::uuid, ${prev.absence_number ?? null}, 'active')
          RETURNING id, student_id, user_id, class_id, academic_period_id, absence_number, status, created_at::text, updated_at::text
        `

        await tx`
          UPDATE profiles SET class_name = ${targetClass.name}, updated_at = NOW() WHERE user_id = ${params.userId}
        `

        return {
          previous: updatedPrevRows[0],
          current: {
            ...newRows[0],
            class_name: targetClass.name,
          },
        }
      })
    },
  )
}

export async function promoteStudentEnrollment(
  sql: Sql,
  params: PromoteStudentEnrollmentParams,
): Promise<EnrollmentTransitionResult> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to promote student enrollment'),
    async () => {
      const targetClass = await getClassById(sql, params.toClassId)
      if (!targetClass) throw AppError.notFound('Target class')
      const targetPeriod = await getAcademicPeriod(sql, params.toAcademicPeriodId)
      if (!targetPeriod) throw AppError.notFound('Target academic period')

      return await runInTransaction(sql, async (tx) => {
        const sourceRows = await tx<ClassEnrollment[]>`
          SELECT id, student_id, user_id, class_id, academic_period_id, absence_number, status, created_at::text, updated_at::text
          FROM class_enrollments
          WHERE user_id = ${params.userId} AND academic_period_id = ${params.fromAcademicPeriodId}::uuid AND status = 'active'
          LIMIT 1
        `
        if (!sourceRows || sourceRows.length === 0) {
          throw AppError.notFound('Active class enrollment in source academic period')
        }

        const existingTarget = await tx<ClassEnrollment[]>`
          SELECT id FROM class_enrollments
          WHERE user_id = ${params.userId} AND academic_period_id = ${params.toAcademicPeriodId}::uuid AND status = 'active'
          LIMIT 1
        `
        if (existingTarget && existingTarget.length > 0) {
          throw AppError.conflict(
            'Student already has an active class enrollment in target academic period.',
          )
        }

        const updatedSourceRows = await tx<ClassEnrollment[]>`
          UPDATE class_enrollments
          SET status = 'promoted', updated_at = NOW()
          WHERE id = ${sourceRows[0].id}
          RETURNING id, student_id, user_id, class_id, academic_period_id, absence_number, status, created_at::text, updated_at::text
        `

        const newRows = await tx<ClassEnrollment[]>`
          INSERT INTO class_enrollments (student_id, user_id, class_id, academic_period_id, absence_number, status)
          VALUES (${sourceRows[0].student_id ?? null}, ${params.userId}, ${params.toClassId}::uuid, ${params.toAcademicPeriodId}::uuid, ${sourceRows[0].absence_number ?? null}, 'active')
          RETURNING id, student_id, user_id, class_id, academic_period_id, absence_number, status, created_at::text, updated_at::text
        `

        await tx`
          UPDATE profiles SET class_name = ${targetClass.name}, updated_at = NOW() WHERE user_id = ${params.userId}
        `

        return {
          previous: updatedSourceRows[0],
          current: {
            ...newRows[0],
            class_name: targetClass.name,
            period_name: targetPeriod.name,
          },
        }
      })
    },
  )
}

export async function exitStudentEnrollment(
  sql: Sql,
  params: ExitStudentEnrollmentParams,
): Promise<ClassEnrollment> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to exit student enrollment'),
    async () => {
      const status = params.status ?? 'archived'
      const rows = await sql<ClassEnrollment[]>`
        UPDATE class_enrollments
        SET status = ${status}, updated_at = NOW()
        WHERE user_id = ${params.userId} AND academic_period_id = ${params.academicPeriodId}::uuid AND status = 'active'
        RETURNING id, user_id, class_id, academic_period_id, status, created_at::text, updated_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.notFound('Active class enrollment')
      }
      return rows[0]
    },
  )
}
