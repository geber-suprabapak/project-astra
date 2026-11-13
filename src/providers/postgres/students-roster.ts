import type { Sql } from 'postgres'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
import type {
  CreateStudentParams,
  ProfileLifecycleStatus,
  RosterReport,
  RosterStudent,
  Student,
  StudentBinding,
  StudentRosterRow,
  UserProfile,
} from '../types.js'
import { isPgUniqueViolation, withPgError, type PgQuery } from './shared.js'

export interface StudentBindingInput {
  studentId: string
  userId: string
}

export interface PendingStudentProfileInput {
  userId: string
  nis: string
  email: string
  fullName: string
  className: string
}

export interface StudentProfilesFilter {
  lifecycle_status?: ProfileLifecycleStatus
}

export async function getUserProfile(sql: PgQuery, userId: string): Promise<UserProfile> {
  return withPgError(
    (err) => logger.error({ err, userId }, 'Failed to query user profile'),
    async () => {
      const rows = await sql<UserProfile[]>`
        SELECT user_id, full_name, email, nis, class_name, absence_number, avatar_url, notification_token, role, lifecycle_status, gender
        FROM profiles
        WHERE user_id = ${userId}
        LIMIT 1
      `
      if (!rows || rows.length === 0) {
        throw AppError.notFound('User profile')
      }
      return rows[0]
    },
  )
}

export async function resolveLegacyUserId(sql: Sql, legacyUserId: string): Promise<string | null> {
  return withPgError(
    (err) => logger.error({ err, legacyUserId }, 'Failed to resolve legacy identity mapping'),
    async () => {
      const rows = await sql<{ target_user_id: string }[]>`
        SELECT target_user_id
        FROM legacy_identity_mappings
        WHERE legacy_user_id = ${legacyUserId}::uuid
        LIMIT 1
      `
      return rows[0]?.target_user_id ?? null
    },
  )
}

export async function updateUserProfile(
  sql: Sql,
  userId: string,
  updates: Partial<UserProfile>,
): Promise<void> {
  return withPgError(
    (err) => logger.error({ err, userId }, 'Failed to update profile'),
    async () => {
      // SAFETY: keys of Partial<UserProfile> are valid property names of UserProfile
      const keys = Object.keys(updates) as (keyof UserProfile)[]
      if (keys.length === 0) return

      await sql`
        UPDATE profiles
        SET ${sql(updates)}, updated_at = NOW()
        WHERE user_id = ${userId}
      `
    },
  )
}

export async function getProfileByNis(sql: Sql, nis: string): Promise<UserProfile | null> {
  return withPgError(
    (err) => logger.error({ err, nis }, 'Failed to query profile by NIS'),
    async () => {
      const rows = await sql<UserProfile[]>`
        SELECT user_id, full_name, email, nis, class_name, absence_number, avatar_url, role, lifecycle_status, gender
        FROM profiles
        WHERE nis = ${nis}
        LIMIT 1
      `
      return rows[0] ?? null
    },
  )
}

export async function getStudentByNis(sql: Sql, nis: string): Promise<Student | null> {
  return withPgError(
    (err) => logger.error({ err, nis }, 'Failed to query canonical student by NIS'),
    async () => {
      const rows = await sql<Student[]>`
        SELECT id, nis, full_name, gender, created_at::text, updated_at::text
        FROM students
        WHERE nis = ${nis}
        LIMIT 1
      `
      return rows[0] ?? null
    },
  )
}

export async function createStudent(sql: Sql, params: CreateStudentParams): Promise<Student> {
  try {
    const rows = await sql<Student[]>`
      INSERT INTO students (nis, full_name, gender)
      VALUES (${params.nis}, ${params.fullName}, ${params.gender})
      RETURNING id, nis, full_name, gender, created_at::text, updated_at::text
    `
    if (!rows[0]) throw AppError.internal('Failed to create student.')
    return rows[0]
  } catch (err) {
    if (err instanceof AppError) throw err
    if (isPgUniqueViolation(err)) {
      throw AppError.conflict(`NIS "${params.nis}" already exists in the student roster.`)
    }
    logger.error({ err, params }, 'Failed to create canonical student')
    throw AppError.internal('An unexpected database error occurred.')
  }
}

export async function bindStudentToUser(
  sql: Sql,
  params: StudentBindingInput,
): Promise<StudentBinding> {
  try {
    return await sql.begin(async (tx) => {
      const student = await tx<{ id: string }[]>`
        SELECT id FROM students WHERE id = ${params.studentId}::uuid LIMIT 1
      `
      if (!student[0]) throw AppError.notFound('Student')
      const existingBinding = await tx<{ user_id: string }[]>`
        SELECT user_id FROM student_bindings
        WHERE student_id = ${params.studentId}::uuid
        LIMIT 1
      `
      if (existingBinding[0] && existingBinding[0].user_id !== params.userId) {
        throw AppError.conflict('Student is already bound to another user.')
      }
      const rows = await tx<StudentBinding[]>`
        INSERT INTO student_bindings (student_id, user_id)
        VALUES (${params.studentId}::uuid, ${params.userId})
        ON CONFLICT (student_id) DO UPDATE SET user_id = EXCLUDED.user_id, updated_at = NOW()
        RETURNING student_id, user_id, created_at::text, updated_at::text
      `
      await tx`
        UPDATE class_enrollments
        SET user_id = ${params.userId}, updated_at = NOW()
        WHERE student_id = ${params.studentId}::uuid
      `
      if (!rows[0]) throw AppError.internal('Failed to bind student to user.')
      return rows[0]
    })
  } catch (err) {
    if (err instanceof AppError) throw err
    if (isPgUniqueViolation(err)) {
      throw AppError.conflict('Student is already bound to another user.')
    }
    logger.error({ err, params }, 'Failed to bind student to user')
    throw AppError.internal('An unexpected database error occurred.')
  }
}

export async function unbindStudentByNis(sql: Sql, nis: string): Promise<void> {
  return withPgError(
    (err) => logger.error({ err, nis }, 'Failed to unbind student by NIS'),
    async () => {
      await sql.begin(async (tx) => {
        await tx`
          DELETE FROM student_bindings
          WHERE student_id IN (SELECT id FROM students WHERE nis = ${nis})
        `
        await tx`
          UPDATE class_enrollments
          SET user_id = NULL, updated_at = NOW()
          WHERE student_id IN (SELECT id FROM students WHERE nis = ${nis})
        `
      })
    },
  )
}

export async function getRosterStudentByNis(sql: Sql, nis: string): Promise<RosterStudent | null> {
  return withPgError(
    (err) => logger.error({ err, nis }, 'Failed to query roster student by NIS'),
    async () => {
      const canonicalRows = await sql<
        (Omit<Student, 'id'> & {
          student_id: string
          class_name?: string | null
          academic_period_id?: string | null
          absence_number?: string | null
          user_id?: string | null
        })[]
      >`
        SELECT s.id AS student_id, s.nis, s.full_name, s.gender,
               ce.class_id, c.name AS class_name, ce.academic_period_id,
               ce.absence_number, sb.user_id
        FROM students s
        LEFT JOIN student_bindings sb ON sb.student_id = s.id
        LEFT JOIN class_enrollments ce ON ce.student_id = s.id AND ce.status = 'active'
        LEFT JOIN classes c ON c.id = ce.class_id
        WHERE s.nis = ${nis}
        ORDER BY ce.created_at DESC NULLS LAST
        LIMIT 1
      `
      if (canonicalRows[0]) {
        const row = canonicalRows[0]
        return {
          student_id: row.student_id,
          user_id: row.user_id ?? null,
          nis: row.nis,
          full_name: row.full_name,
          gender: row.gender,
          class_name: row.class_name ?? '',
          academic_period_id: row.academic_period_id ?? null,
          absence_number: row.absence_number ?? null,
        }
      }
      const reports = await sql<RosterReport[]>`
        SELECT rows FROM roster_reports WHERE status = 'accepted' ORDER BY accepted_at DESC
      `
      for (const report of reports) {
        const rows = Array.isArray(report.rows) ? report.rows : []
        const row = rows.find((candidate) => candidate.nis === nis)
        if (row) {
          return {
            student_id: null,
            nis: row.nis,
            full_name: row.full_name,
            class_name: row.class_name,
            grade: row.grade,
          }
        }
      }

      const profileRows = await sql<UserProfile[]>`
        SELECT nis, full_name, class_name FROM profiles WHERE nis = ${nis} LIMIT 1
      `
      if (profileRows.length > 0 && profileRows[0].full_name && profileRows[0].class_name) {
        return {
          nis: profileRows[0].nis!,
          full_name: profileRows[0].full_name,
          class_name: profileRows[0].class_name,
        }
      }
      return null
    },
  )
}

export async function listStudentProfiles(
  sql: Sql,
  filter?: StudentProfilesFilter,
): Promise<StudentRosterRow[]> {
  return withPgError(
    (err) => logger.error({ err, filter }, 'Failed to list student profiles'),
    async () => {
      const lifecycle = filter?.lifecycle_status ?? null
      const rows = await sql<StudentRosterRow[]>`
        SELECT s.id AS student_id, sb.user_id, s.full_name, p.email, s.nis,
               c.id AS class_id, c.name AS class_name, ce.absence_number,
               p.avatar_url, p.role, p.lifecycle_status, s.gender,
               ce.academic_period_id, ap.name AS period_name
        FROM students s
        LEFT JOIN student_bindings sb ON sb.student_id = s.id
        LEFT JOIN profiles p ON p.user_id = sb.user_id
        LEFT JOIN class_enrollments ce ON ce.student_id = s.id AND ce.status = 'active'
        LEFT JOIN classes c ON c.id = ce.class_id
        LEFT JOIN academic_periods ap ON ap.id = ce.academic_period_id
        WHERE (${lifecycle}::text IS NULL OR p.lifecycle_status = ${lifecycle})
        UNION ALL
        SELECT NULL::uuid AS student_id, p.user_id, p.full_name, p.email, p.nis,
               NULL::uuid AS class_id, p.class_name, p.absence_number,
               p.avatar_url, p.role, p.lifecycle_status, p.gender,
               NULL::uuid AS academic_period_id, NULL::text AS period_name
        FROM profiles p
        LEFT JOIN students s ON s.nis = p.nis
        WHERE p.role = 'student' AND s.id IS NULL
          AND (${lifecycle}::text IS NULL OR p.lifecycle_status = ${lifecycle})
        ORDER BY nis ASC NULLS LAST, full_name ASC NULLS LAST
      `
      return rows ?? []
    },
  )
}

export async function createPendingStudentProfile(
  sql: Sql,
  params: PendingStudentProfileInput,
): Promise<UserProfile> {
  try {
    const rows = await sql<UserProfile[]>`
      INSERT INTO profiles (user_id, full_name, nis, email, class_name, role, lifecycle_status)
      VALUES (${params.userId}, ${params.fullName}, ${params.nis}, ${params.email}, ${params.className}, 'student', 'pending')
      ON CONFLICT (user_id) DO UPDATE
      SET full_name = EXCLUDED.full_name,
          nis = EXCLUDED.nis,
          email = EXCLUDED.email,
          class_name = EXCLUDED.class_name,
          role = 'student',
          lifecycle_status = 'pending',
          updated_at = NOW()
      RETURNING user_id, full_name, email, nis, class_name, absence_number, avatar_url, role, lifecycle_status, gender
    `
    if (!rows || rows.length === 0) {
      throw AppError.internal('Failed to create student profile.')
    }
    return rows[0]
  } catch (err) {
    if (err instanceof AppError) throw err
    if (isPgUniqueViolation(err)) {
      throw AppError.conflict(`A student account is already registered for NIS "${params.nis}".`)
    }
    logger.error({ err, params }, 'Failed to create pending student profile')
    throw AppError.internal('An unexpected database error occurred.')
  }
}

export async function updateProfileLifecycle(
  sql: Sql,
  userId: string,
  status: ProfileLifecycleStatus,
): Promise<UserProfile> {
  return withPgError(
    (err) => logger.error({ err, userId, status }, 'Failed to update profile lifecycle status'),
    async () => {
      const rows = await sql<UserProfile[]>`
        UPDATE profiles
        SET lifecycle_status = ${status}, updated_at = NOW()
        WHERE user_id = ${userId}
        RETURNING user_id, full_name, email, nis, class_name, absence_number, avatar_url, role, lifecycle_status, gender
      `
      if (!rows || rows.length === 0) {
        throw AppError.notFound('User profile')
      }
      return rows[0]
    },
  )
}

export async function updateProfileEmail(
  sql: Sql,
  userId: string,
  email: string,
): Promise<UserProfile> {
  return withPgError(
    (err) => logger.error({ err, userId, email }, 'Failed to update profile email'),
    async () => {
      const rows = await sql<UserProfile[]>`
        UPDATE profiles
        SET email = ${email}, updated_at = NOW()
        WHERE user_id = ${userId}
        RETURNING user_id, full_name, email, nis, class_name, absence_number, avatar_url, role, lifecycle_status, gender
      `
      if (!rows || rows.length === 0) {
        throw AppError.notFound('User profile')
      }
      return rows[0]
    },
  )
}
