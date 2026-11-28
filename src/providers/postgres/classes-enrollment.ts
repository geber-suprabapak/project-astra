import type { Sql } from 'postgres'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
import {
  addDaysYmd,
  buildBatchTransitionPlan,
  clampDateToPeriod,
} from '../shared/academic-batch.js'
import type {
  AcademicPeriod,
  BatchTransitionCommitParams,
  BatchTransitionCommitResult,
  BatchTransitionPreview,
  BatchTransitionPreviewParams,
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
  getTodayWIB,
  isPgUniqueViolation,
  resolveSchoolId,
  runInTransaction,
  withPgError,
  type PgQuery,
} from './shared.js'

export interface ClassEnrollmentFilter {
  studentId?: string
  userId?: string
  classId?: string
  academicPeriodId?: string
  status?: ClassEnrollmentStatus
}

export interface EnrollmentTransitionResult {
  previous: ClassEnrollment
  current: ClassEnrollment
}

function assertPeriodUnlocked(
  period: AcademicPeriod,
  overrideLocked?: boolean,
  reason?: string,
): void {
  if (!period.is_locked) return
  if (overrideLocked === true && (reason?.trim().length ?? 0) >= 3) return
  throw AppError.conflict('Academic period is locked.', {
    reason_code: 'PERIOD_LOCKED',
    academic_period_id: period.id,
  })
}

function validateAbsenceNumber(
  absenceNumber: string | null | undefined,
): string | null | undefined {
  if (absenceNumber === undefined || absenceNumber === null) return absenceNumber
  const trimmed = absenceNumber.trim()
  if (!/^[1-9][0-9]*$/.test(trimmed)) {
    throw AppError.validationError('absence_number must be a positive integer string.')
  }
  return trimmed
}

async function resolveEnrollmentIdentityInTx(
  tx: PgQuery,
  input: { studentId?: string; userId?: string },
): Promise<{ studentId: string | null; userId: string | null }> {
  if (input.studentId) {
    const studentRows = await tx<{ id: string }[]>`
      SELECT id FROM students WHERE id = ${input.studentId}::uuid LIMIT 1
    `
    if (!studentRows[0]) {
      throw AppError.notFound('Student')
    }
    const bindingRows = await tx<{ user_id: string }[]>`
      SELECT user_id FROM student_bindings WHERE student_id = ${input.studentId}::uuid LIMIT 1
    `
    return {
      studentId: input.studentId,
      userId: bindingRows[0]?.user_id ?? input.userId ?? null,
    }
  }

  if (input.userId) {
    const bindingRows = await tx<{ student_id: string }[]>`
      SELECT student_id FROM student_bindings WHERE user_id = ${input.userId} LIMIT 1
    `
    if (bindingRows[0]) {
      return { studentId: bindingRows[0].student_id, userId: input.userId }
    }
    const existingRows = await tx<{ student_id: string | null }[]>`
      SELECT student_id
      FROM class_enrollments
      WHERE user_id = ${input.userId} AND student_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1
    `
    return {
      studentId: existingRows[0]?.student_id ?? null,
      userId: input.userId,
    }
  }

  throw AppError.validationError('Either student_id or user_id is required.')
}

async function assertAbsenceNumberAvailableInTx(
  tx: PgQuery,
  classId: string,
  academicPeriodId: string,
  absenceNumber: string | null | undefined,
): Promise<void> {
  if (!absenceNumber) return
  const existing = await tx<{ id: string }[]>`
    SELECT id
    FROM class_enrollments
    WHERE class_id = ${classId}::uuid
      AND academic_period_id = ${academicPeriodId}::uuid
      AND absence_number = ${absenceNumber}
      AND status = 'active'
    LIMIT 1
  `
  if (existing.length > 0) {
    throw AppError.conflict('Absence number is already used in this class and academic period.', {
      reason_code: 'ABSENCE_NUMBER_CONFLICT',
      class_id: classId,
      academic_period_id: academicPeriodId,
      absence_number: absenceNumber,
    })
  }
}

export async function getClasses(
  sql: PgQuery,
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

export async function deleteClass(
  sql: Sql,
  id: string,
  options?: { overrideLocked?: boolean; reason?: string },
): Promise<void> {
  return withPgError(
    (err) => logger.error({ err, id, options }, 'Failed to delete class'),
    async () => {
      await runInTransaction(sql, async (tx) => {
        const cls = await getClassById(tx, id)
        if (!cls) throw AppError.notFound('Class')

        if (cls.academic_period_id) {
          const period = await getAcademicPeriod(tx, cls.academic_period_id)
          if (period) {
            assertPeriodUnlocked(period, options?.overrideLocked, options?.reason)
          }
        }

        const enrollmentCountRows = await tx<{ count: string }[]>`
          SELECT COUNT(*) AS count FROM class_enrollments WHERE class_id = ${id}::uuid
        `
        const scheduleCountRows = await tx<{ count: string }[]>`
          SELECT COUNT(*) AS count FROM schedules WHERE class_id = ${id}::uuid
        `
        const siteCountRows = await tx<{ count: string }[]>`
          SELECT COUNT(*) AS count FROM adiwiyata_sites WHERE class_id = ${id}::uuid
        `
        const inUse =
          Number(enrollmentCountRows[0]?.count ?? 0) > 0 ||
          Number(scheduleCountRows[0]?.count ?? 0) > 0 ||
          Number(siteCountRows[0]?.count ?? 0) > 0
        if (inUse) {
          throw AppError.conflict(
            'Class is still referenced by enrollments, schedules, or sites.',
            {
              reason_code: 'CLASS_IN_USE',
              class_id: id,
            },
          )
        }

        const res = await tx`DELETE FROM classes WHERE id = ${id}::uuid`
        if (res.count === 0) throw AppError.notFound('Class')
      })
    },
  )
}

export async function listClassEnrollments(
  sql: PgQuery,
  filter?: ClassEnrollmentFilter,
): Promise<ClassEnrollment[]> {
  return withPgError(
    (err) => logger.error({ err, filter }, 'Failed to list class enrollments'),
    async () => {
      const rows = await sql<ClassEnrollment[]>`
        SELECT ce.id, ce.student_id, ce.user_id, ce.class_id, ce.academic_period_id,
               COALESCE(ce.absence_number, p.absence_number) AS absence_number,
               ce.status,
               ce.effective_start_date::text,
               ce.effective_end_date::text,
               ce.created_at::text, ce.updated_at::text,
               c.name AS class_name, COALESCE(s.full_name, p.full_name) AS student_name,
               COALESCE(s.nis, p.nis) AS nis,
               ap.name AS period_name
        FROM class_enrollments ce
        LEFT JOIN classes c ON c.id = ce.class_id
        LEFT JOIN students s ON s.id = ce.student_id
        LEFT JOIN profiles p ON p.user_id = ce.user_id
        LEFT JOIN academic_periods ap ON ap.id = ce.academic_period_id
        WHERE (${filter?.studentId ?? null}::uuid IS NULL OR ce.student_id = ${filter?.studentId ?? null}::uuid)
          AND (${filter?.userId ?? null}::text IS NULL OR ce.user_id = ${filter?.userId ?? null})
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
               ce.status,
               ce.effective_start_date::text,
               ce.effective_end_date::text,
               ce.created_at::text, ce.updated_at::text,
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
  const absenceNumber = validateAbsenceNumber(params.absenceNumber)
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to enroll student in class'),
    async () => {
      const cls = await getClassById(sql, params.classId)
      if (!cls) throw AppError.notFound('Class')
      const period = await getAcademicPeriod(sql, params.academicPeriodId)
      if (!period) throw AppError.notFound('Academic period')
      assertPeriodUnlocked(period, params.overrideLocked, params.reason)

      const effectiveStart =
        params.effectiveDate ?? clampDateToPeriod(getTodayWIB(), period.start_date, period.end_date)

      return await runInTransaction(sql, async (tx) => {
        const identity = await resolveEnrollmentIdentityInTx(tx, {
          studentId: params.studentId,
          userId: params.userId,
        })

        const existing = identity.studentId
          ? await tx<ClassEnrollment[]>`
              SELECT id FROM class_enrollments
              WHERE (student_id = ${identity.studentId}::uuid OR (${identity.userId}::text IS NOT NULL AND user_id = ${identity.userId}))
                AND academic_period_id = ${params.academicPeriodId}::uuid
                AND status = 'active'
              LIMIT 1
            `
          : await tx<ClassEnrollment[]>`
              SELECT id FROM class_enrollments
              WHERE user_id = ${identity.userId!} AND academic_period_id = ${params.academicPeriodId}::uuid AND status = 'active'
              LIMIT 1
            `
        if (existing && existing.length > 0) {
          throw AppError.conflict(
            'Student already has an active class enrollment in this academic period.',
          )
        }

        await assertAbsenceNumberAvailableInTx(
          tx,
          params.classId,
          params.academicPeriodId,
          absenceNumber,
        )

        try {
          const rows = await tx<ClassEnrollment[]>`
            INSERT INTO class_enrollments (student_id, user_id, class_id, academic_period_id, absence_number, status, effective_start_date)
            VALUES (${identity.studentId}, ${identity.userId}, ${params.classId}::uuid, ${params.academicPeriodId}::uuid, ${absenceNumber ?? null}, 'active', ${effectiveStart}::date)
            RETURNING id, student_id, user_id, class_id, academic_period_id, absence_number, status, effective_start_date::text, effective_end_date::text, created_at::text, updated_at::text
          `

          if (identity.userId && period.is_active) {
            await tx`
              UPDATE profiles SET class_name = ${cls.name}, updated_at = NOW() WHERE user_id = ${identity.userId}
            `
          }

          return {
            ...rows[0],
            class_name: cls.name,
            period_name: period.name,
          }
        } catch (err) {
          if (isPgUniqueViolation(err)) {
            throw AppError.conflict(
              'Student enrollment or absence number conflicts with an existing active enrollment.',
              {
                reason_code: 'ABSENCE_NUMBER_CONFLICT',
                class_id: params.classId,
                academic_period_id: params.academicPeriodId,
                absence_number: absenceNumber ?? null,
              },
            )
          }
          throw err
        }
      })
    },
  )
}

export async function transferStudentEnrollment(
  sql: Sql,
  params: TransferStudentEnrollmentParams,
): Promise<EnrollmentTransitionResult> {
  const requestedAbsence = validateAbsenceNumber(params.absenceNumber)
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to transfer student enrollment'),
    async () => {
      const targetClass = await getClassById(sql, params.toClassId)
      if (!targetClass) throw AppError.notFound('Target class')
      const period = await getAcademicPeriod(sql, params.academicPeriodId)
      if (!period) throw AppError.notFound('Academic period')
      assertPeriodUnlocked(period, params.overrideLocked, params.reason)

      const effectiveDate = params.effectiveDate ?? getTodayWIB()

      return await runInTransaction(sql, async (tx) => {
        const identity = await resolveEnrollmentIdentityInTx(tx, {
          studentId: params.studentId,
          userId: params.userId,
        })

        const activeRows = identity.studentId
          ? await tx<ClassEnrollment[]>`
              SELECT id, student_id, user_id, class_id, academic_period_id, absence_number, status, effective_start_date::text, effective_end_date::text, created_at::text, updated_at::text
              FROM class_enrollments
              WHERE (student_id = ${identity.studentId}::uuid OR (${identity.userId}::text IS NOT NULL AND user_id = ${identity.userId}))
                AND academic_period_id = ${params.academicPeriodId}::uuid
                AND status = 'active'
              LIMIT 1
            `
          : await tx<ClassEnrollment[]>`
              SELECT id, student_id, user_id, class_id, academic_period_id, absence_number, status, effective_start_date::text, effective_end_date::text, created_at::text, updated_at::text
              FROM class_enrollments
              WHERE user_id = ${identity.userId!} AND academic_period_id = ${params.academicPeriodId}::uuid AND status = 'active'
              LIMIT 1
            `
        if (!activeRows || activeRows.length === 0) {
          throw AppError.notFound('Active class enrollment in this academic period')
        }
        const prev = activeRows[0]
        if (prev.class_id === params.toClassId) {
          throw AppError.validationError('Target class must be different from current class.')
        }

        const nextAbsenceNumber =
          requestedAbsence !== undefined ? requestedAbsence : (prev.absence_number ?? null)
        await assertAbsenceNumberAvailableInTx(
          tx,
          params.toClassId,
          params.academicPeriodId,
          nextAbsenceNumber,
        )

        const prevStart = prev.effective_start_date ?? period.start_date
        const candidateEnd = addDaysYmd(effectiveDate, -1)
        const prevEnd = candidateEnd > prevStart ? candidateEnd : prevStart

        const updatedPrevRows = await tx<ClassEnrollment[]>`
          UPDATE class_enrollments
          SET status = 'transferred', effective_end_date = ${prevEnd}::date, updated_at = NOW()
          WHERE id = ${prev.id}
          RETURNING id, student_id, user_id, class_id, academic_period_id, absence_number, status, effective_start_date::text, effective_end_date::text, created_at::text, updated_at::text
        `

        const resolvedUserId = prev.user_id ?? identity.userId ?? null
        const resolvedStudentId = prev.student_id ?? identity.studentId ?? null

        try {
          const newRows = await tx<ClassEnrollment[]>`
            INSERT INTO class_enrollments (student_id, user_id, class_id, academic_period_id, absence_number, status, effective_start_date)
            VALUES (${resolvedStudentId}, ${resolvedUserId}, ${params.toClassId}::uuid, ${params.academicPeriodId}::uuid, ${nextAbsenceNumber}, 'active', ${effectiveDate}::date)
            RETURNING id, student_id, user_id, class_id, academic_period_id, absence_number, status, effective_start_date::text, effective_end_date::text, created_at::text, updated_at::text
          `

          if (resolvedUserId && period.is_active) {
            await tx`
              UPDATE profiles SET class_name = ${targetClass.name}, updated_at = NOW() WHERE user_id = ${resolvedUserId}
            `
          }

          return {
            previous: updatedPrevRows[0],
            current: {
              ...newRows[0],
              class_name: targetClass.name,
            },
          }
        } catch (err) {
          if (isPgUniqueViolation(err)) {
            throw AppError.conflict('Absence number is already used in target class.', {
              reason_code: 'ABSENCE_NUMBER_CONFLICT',
              class_id: params.toClassId,
              academic_period_id: params.academicPeriodId,
              absence_number: nextAbsenceNumber,
            })
          }
          throw err
        }
      })
    },
  )
}

export async function promoteStudentEnrollment(
  sql: Sql,
  params: PromoteStudentEnrollmentParams,
): Promise<EnrollmentTransitionResult> {
  const requestedAbsence = validateAbsenceNumber(params.absenceNumber)
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to promote student enrollment'),
    async () => {
      const targetClass = await getClassById(sql, params.toClassId)
      if (!targetClass) throw AppError.notFound('Target class')
      const fromPeriod = await getAcademicPeriod(sql, params.fromAcademicPeriodId)
      if (!fromPeriod) throw AppError.notFound('Source academic period')
      const targetPeriod = await getAcademicPeriod(sql, params.toAcademicPeriodId)
      if (!targetPeriod) throw AppError.notFound('Target academic period')

      assertPeriodUnlocked(fromPeriod, params.overrideLocked, params.reason)
      assertPeriodUnlocked(targetPeriod, params.overrideLocked, params.reason)

      return await runInTransaction(sql, async (tx) => {
        const identity = await resolveEnrollmentIdentityInTx(tx, {
          studentId: params.studentId,
          userId: params.userId,
        })

        const sourceRows = identity.studentId
          ? await tx<ClassEnrollment[]>`
              SELECT id, student_id, user_id, class_id, academic_period_id, absence_number, status, effective_start_date::text, effective_end_date::text, created_at::text, updated_at::text
              FROM class_enrollments
              WHERE (student_id = ${identity.studentId}::uuid OR (${identity.userId}::text IS NOT NULL AND user_id = ${identity.userId}))
                AND academic_period_id = ${params.fromAcademicPeriodId}::uuid
                AND status = 'active'
              LIMIT 1
            `
          : await tx<ClassEnrollment[]>`
              SELECT id, student_id, user_id, class_id, academic_period_id, absence_number, status, effective_start_date::text, effective_end_date::text, created_at::text, updated_at::text
              FROM class_enrollments
              WHERE user_id = ${identity.userId!} AND academic_period_id = ${params.fromAcademicPeriodId}::uuid AND status = 'active'
              LIMIT 1
            `
        if (!sourceRows || sourceRows.length === 0) {
          throw AppError.notFound('Active class enrollment in source academic period')
        }
        const source = sourceRows[0]

        const existingTarget = identity.studentId
          ? await tx<ClassEnrollment[]>`
              SELECT id FROM class_enrollments
              WHERE (student_id = ${identity.studentId}::uuid OR (${identity.userId}::text IS NOT NULL AND user_id = ${identity.userId}))
                AND academic_period_id = ${params.toAcademicPeriodId}::uuid
                AND status = 'active'
              LIMIT 1
            `
          : await tx<ClassEnrollment[]>`
              SELECT id FROM class_enrollments
              WHERE user_id = ${identity.userId!} AND academic_period_id = ${params.toAcademicPeriodId}::uuid AND status = 'active'
              LIMIT 1
            `
        if (existingTarget && existingTarget.length > 0) {
          throw AppError.conflict(
            'Student already has an active class enrollment in target academic period.',
          )
        }

        const nextAbsenceNumber =
          requestedAbsence !== undefined ? requestedAbsence : (source.absence_number ?? null)
        await assertAbsenceNumberAvailableInTx(
          tx,
          params.toClassId,
          params.toAcademicPeriodId,
          nextAbsenceNumber,
        )

        const sourceStart = source.effective_start_date ?? fromPeriod.start_date
        const sourceEnd = fromPeriod.end_date >= sourceStart ? fromPeriod.end_date : sourceStart
        const targetStart = params.effectiveDate ?? targetPeriod.start_date

        const updatedSourceRows = await tx<ClassEnrollment[]>`
          UPDATE class_enrollments
          SET status = 'promoted', effective_end_date = ${sourceEnd}::date, updated_at = NOW()
          WHERE id = ${source.id}
          RETURNING id, student_id, user_id, class_id, academic_period_id, absence_number, status, effective_start_date::text, effective_end_date::text, created_at::text, updated_at::text
        `

        const resolvedUserId = source.user_id ?? identity.userId ?? null
        const resolvedStudentId = source.student_id ?? identity.studentId ?? null

        try {
          const newRows = await tx<ClassEnrollment[]>`
            INSERT INTO class_enrollments (student_id, user_id, class_id, academic_period_id, absence_number, status, effective_start_date)
            VALUES (${resolvedStudentId}, ${resolvedUserId}, ${params.toClassId}::uuid, ${params.toAcademicPeriodId}::uuid, ${nextAbsenceNumber}, 'active', ${targetStart}::date)
            RETURNING id, student_id, user_id, class_id, academic_period_id, absence_number, status, effective_start_date::text, effective_end_date::text, created_at::text, updated_at::text
          `

          if (resolvedUserId && targetPeriod.is_active) {
            await tx`
              UPDATE profiles SET class_name = ${targetClass.name}, updated_at = NOW() WHERE user_id = ${resolvedUserId}
            `
          }

          return {
            previous: updatedSourceRows[0],
            current: {
              ...newRows[0],
              class_name: targetClass.name,
              period_name: targetPeriod.name,
            },
          }
        } catch (err) {
          if (isPgUniqueViolation(err)) {
            throw AppError.conflict('Absence number is already used in target class.', {
              reason_code: 'ABSENCE_NUMBER_CONFLICT',
              class_id: params.toClassId,
              academic_period_id: params.toAcademicPeriodId,
              absence_number: nextAbsenceNumber,
            })
          }
          throw err
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
      const period = await getAcademicPeriod(sql, params.academicPeriodId)
      if (!period) throw AppError.notFound('Academic period')
      assertPeriodUnlocked(period, params.overrideLocked, params.reason)

      const status = params.status ?? 'archived'
      const effectiveDate = params.effectiveDate ?? getTodayWIB()

      return await runInTransaction(sql, async (tx) => {
        const identity = await resolveEnrollmentIdentityInTx(tx, {
          studentId: params.studentId,
          userId: params.userId,
        })

        const activeRows = identity.studentId
          ? await tx<ClassEnrollment[]>`
              SELECT id, student_id, user_id, class_id, academic_period_id, absence_number, status, effective_start_date::text, effective_end_date::text
              FROM class_enrollments
              WHERE (student_id = ${identity.studentId}::uuid OR (${identity.userId}::text IS NOT NULL AND user_id = ${identity.userId}))
                AND academic_period_id = ${params.academicPeriodId}::uuid
                AND status = 'active'
              LIMIT 1
            `
          : await tx<ClassEnrollment[]>`
              SELECT id, student_id, user_id, class_id, academic_period_id, absence_number, status, effective_start_date::text, effective_end_date::text
              FROM class_enrollments
              WHERE user_id = ${identity.userId!} AND academic_period_id = ${params.academicPeriodId}::uuid AND status = 'active'
              LIMIT 1
            `
        const active = activeRows[0]
        if (!active) {
          throw AppError.notFound('Active class enrollment')
        }

        const startDate = active.effective_start_date ?? period.start_date
        const endDate = effectiveDate >= startDate ? effectiveDate : startDate

        const rows = await tx<ClassEnrollment[]>`
          UPDATE class_enrollments
          SET status = ${status}, effective_end_date = ${endDate}::date, updated_at = NOW()
          WHERE id = ${active.id}
          RETURNING id, student_id, user_id, class_id, academic_period_id, absence_number, status, effective_start_date::text, effective_end_date::text, created_at::text, updated_at::text
        `
        if (!rows || rows.length === 0) {
          throw AppError.notFound('Active class enrollment')
        }

        const resolvedUserId = active.user_id ?? identity.userId ?? null
        if (resolvedUserId && (period.is_active || status === 'graduated')) {
          await tx`
            UPDATE profiles SET class_name = NULL, updated_at = NOW() WHERE user_id = ${resolvedUserId}
          `
        }

        return rows[0]
      })
    },
  )
}

async function loadBatchTransitionInputsInTx(tx: PgQuery, params: BatchTransitionPreviewParams) {
  if (params.fromAcademicPeriodId === params.toAcademicPeriodId) {
    throw AppError.validationError('Source and target academic periods must differ.')
  }
  const fromPeriod = await getAcademicPeriod(tx, params.fromAcademicPeriodId)
  if (!fromPeriod) throw AppError.notFound('Source academic period')
  const toPeriod = await getAcademicPeriod(tx, params.toAcademicPeriodId)
  if (!toPeriod) throw AppError.notFound('Target academic period')

  const [fromClasses, toClasses, sourceActiveEnrollments, targetActiveEnrollments] =
    await Promise.all([
      getClasses(tx, undefined, fromPeriod.id),
      getClasses(tx, undefined, toPeriod.id),
      listClassEnrollments(tx, { academicPeriodId: fromPeriod.id, status: 'active' }),
      listClassEnrollments(tx, { academicPeriodId: toPeriod.id, status: 'active' }),
    ])

  return buildBatchTransitionPlan({
    fromPeriod,
    toPeriod,
    mode: params.mode,
    fromClasses,
    toClasses,
    sourceActiveEnrollments,
    targetActiveEnrollments,
    classMappings: params.classMappings,
    overrides: params.overrides,
    clearConflictingAbsenceNumbers: params.clearConflictingAbsenceNumbers,
    effectiveDate: params.effectiveDate,
  })
}

export async function previewBatchEnrollmentTransition(
  sql: Sql,
  params: BatchTransitionPreviewParams,
): Promise<BatchTransitionPreview> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to preview batch enrollment transition'),
    async () => {
      const built = await loadBatchTransitionInputsInTx(sql, params)
      return built.preview
    },
  )
}

export async function commitBatchEnrollmentTransition(
  sql: Sql,
  params: BatchTransitionCommitParams,
): Promise<BatchTransitionCommitResult> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to commit batch enrollment transition'),
    async () => {
      return await runInTransaction(sql, async (tx) => {
        const fromPeriod = await getAcademicPeriod(tx, params.fromAcademicPeriodId)
        if (!fromPeriod) throw AppError.notFound('Source academic period')
        const toPeriod = await getAcademicPeriod(tx, params.toAcademicPeriodId)
        if (!toPeriod) throw AppError.notFound('Target academic period')

        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${fromPeriod.school_id}, 1))`

        const built = await loadBatchTransitionInputsInTx(tx, params)
        if (built.preview.source_hash !== params.sourceHash) {
          throw AppError.conflict(
            'Enrollment state changed since preview. Please refresh the preview.',
            {
              reason_code: 'STALE_PREVIEW',
              expected_source_hash: built.preview.source_hash,
            },
          )
        }

        if (built.preview.requires_lock_override) {
          const reason = params.reason?.trim() ?? ''
          if (params.overrideLocked !== true || reason.length < 3) {
            throw AppError.conflict('One or more academic periods are locked.', {
              reason_code: 'PERIOD_LOCKED',
              academic_period_id: fromPeriod.is_locked ? fromPeriod.id : toPeriod.id,
            })
          }
        }

        if (built.preview.unmapped_classes.length > 0 || built.preview.conflicts.length > 0) {
          throw AppError.conflict(
            'Batch transition cannot commit while unmapped classes or conflicts remain.',
            {
              reason_code: 'BATCH_TRANSITION_CONFLICT',
              conflicts_count: built.preview.conflicts.length,
              unmapped_count: built.preview.unmapped_classes.length,
            },
          )
        }

        if (built.plannedRows.length > 0) {
          const closeIds = built.plannedRows.map((r) => r.enrollment.id)
          const closeStatuses = built.plannedRows.map((r) => r.sourceExitStatus)
          await tx`
            UPDATE class_enrollments ce
            SET status = u.status,
                effective_end_date = GREATEST(COALESCE(ce.effective_start_date, ${built.effectiveEndDate}::date), ${built.effectiveEndDate}::date),
                updated_at = NOW()
            FROM UNNEST(${closeIds}::uuid[], ${closeStatuses}::text[]) AS u(id, status)
            WHERE ce.id = u.id
          `
        }

        const createRows = built.plannedRows.filter((r) => r.toClass !== null)
        if (createRows.length > 0) {
          const studentIds = createRows.map((r) => r.enrollment.student_id ?? null)
          const userIds = createRows.map((r) => r.enrollment.user_id ?? null)
          const classIds = createRows.map((r) => r.toClass!.id)
          const absenceNumbers = createRows.map((r) => r.resolvedAbsenceNumber ?? null)
          await tx`
            INSERT INTO class_enrollments (
              student_id, user_id, class_id, academic_period_id, absence_number, status, effective_start_date
            )
            SELECT
              u.student_id,
              u.user_id,
              u.class_id,
              ${toPeriod.id}::uuid,
              u.absence_number,
              'active',
              ${built.effectiveStartDate}::date
            FROM UNNEST(
              ${studentIds}::uuid[],
              ${userIds}::text[],
              ${classIds}::uuid[],
              ${absenceNumbers}::text[]
            ) AS u(student_id, user_id, class_id, absence_number)
          `
        }

        const clearedUserIds = built.plannedRows
          .filter(
            (r) =>
              r.toClass === null &&
              r.enrollment.user_id != null &&
              (fromPeriod.is_active || r.sourceExitStatus === 'graduated'),
          )
          .map((r) => r.enrollment.user_id!)
        if (clearedUserIds.length > 0) {
          await tx`
            UPDATE profiles
            SET class_name = NULL, updated_at = NOW()
            WHERE user_id = ANY(${clearedUserIds}::text[])
          `
        }

        if (toPeriod.is_active) {
          const updatedUsers = createRows.filter((r) => r.enrollment.user_id != null)
          if (updatedUsers.length > 0) {
            const targetUserIds = updatedUsers.map((r) => r.enrollment.user_id!)
            const targetClassNames = updatedUsers.map((r) => r.toClass!.name)
            await tx`
              UPDATE profiles p
              SET class_name = u.class_name, updated_at = NOW()
              FROM UNNEST(${targetUserIds}::text[], ${targetClassNames}::text[]) AS u(user_id, class_name)
              WHERE p.user_id = u.user_id
            `
          }
        }

        return {
          from_academic_period_id: fromPeriod.id,
          to_academic_period_id: toPeriod.id,
          mode: params.mode,
          source_hash: built.preview.source_hash,
          summary: built.preview.summary,
          created_count: createRows.length,
          closed_count: built.plannedRows.length,
        }
      })
    },
  )
}
