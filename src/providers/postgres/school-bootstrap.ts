import type { Sql } from 'postgres'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
import type {
  BootstrapStatus,
  CreateSchoolParams,
  RosterReport,
  School,
  StageRosterParams,
  UserProfile,
} from '../types.js'
import { getAcademicPeriod, getActiveAcademicPeriod } from './academic-periods.js'
import { isPgUniqueViolation, querySchool, withPgError } from './shared.js'

export interface InitialSchoolAdminParams {
  userId: string
  fullName?: string | null
  email?: string | null
}

export async function getSchool(sql: Sql): Promise<School | null> {
  return withPgError(
    (err) => logger.error({ err }, 'Failed to query school'),
    () => querySchool(sql),
  )
}

export async function getSchoolBySlug(sql: Sql, slug: string): Promise<School | null> {
  return withPgError(
    (err) => logger.error({ err, slug }, 'Failed to query school by slug'),
    async () => {
      const rows = await sql<School[]>`
        SELECT id, name, slug, timezone, signup_open, created_at::text, updated_at::text
        FROM schools
        WHERE slug = ${slug}
        LIMIT 1
      `
      return rows[0] ?? null
    },
  )
}

export async function createSchool(sql: Sql, params: CreateSchoolParams): Promise<School> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to create school'),
    async () => {
      const timezone = params.timezone ?? 'Asia/Jakarta'
      const rows = await sql<School[]>`
        INSERT INTO schools (name, slug, timezone, signup_open)
        VALUES (${params.name}, ${params.slug}, ${timezone}, false)
        RETURNING id, name, slug, timezone, signup_open, created_at::text, updated_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.internal('Failed to create school.')
      }
      const school = rows[0]

      await sql`
        INSERT INTO academic_periods (school_id, name, start_date, end_date, is_active)
        SELECT ${school.id}, '2026/2027 Ganjil', '2026-07-01'::date, '2026-12-31'::date, true
        WHERE NOT EXISTS (SELECT 1 FROM academic_periods WHERE school_id = ${school.id})
      `

      return school
    },
  )
}

export async function createInitialSchoolAdmin(
  sql: Sql,
  params: InitialSchoolAdminParams,
): Promise<UserProfile> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to create initial school admin'),
    async () => {
      const fullName = params.fullName ?? null
      const email = params.email ?? null
      const rows = await sql<UserProfile[]>`
        INSERT INTO profiles (user_id, full_name, email, role, lifecycle_status)
        VALUES (${params.userId}, ${fullName}, ${email}, 'school_admin', 'approved')
        ON CONFLICT (user_id) DO UPDATE
        SET role = 'school_admin', lifecycle_status = 'approved',
            full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
            email = COALESCE(EXCLUDED.email, profiles.email),
            updated_at = NOW()
        RETURNING user_id, full_name, email, nis, class_name, absence_number, avatar_url, role, lifecycle_status, gender
      `
      if (!rows || rows.length === 0) {
        throw AppError.internal('Failed to create school admin profile.')
      }
      return rows[0]
    },
  )
}

export async function stageRosterReport(
  sql: Sql,
  params: StageRosterParams,
): Promise<RosterReport> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to stage roster report'),
    async () => {
      const rowsJson = JSON.stringify(params.rows)
      const rejectedJson = JSON.stringify(params.rejectedItems)
      // Bind serialized JSON as text so postgres.js does not JSON-encode it again.
      const rows = await sql<RosterReport[]>`
        INSERT INTO roster_reports (school_id, academic_period_id, total_rows, valid_rows, rejected_rows, status, review_state, rows, rejected_items)
        VALUES (${params.schoolId ?? null}, ${params.academicPeriodId ?? null}, ${params.totalRows}, ${params.validRows}, ${params.rejectedRows}, ${params.status}, ${params.reviewState}, ${rowsJson}::text::jsonb, ${rejectedJson}::text::jsonb)
        RETURNING id, school_id, academic_period_id, total_rows, valid_rows, rejected_rows, status, review_state, rows, rejected_items, accepted_at::text, accepted_by, created_at::text, updated_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.internal('Failed to stage roster report.')
      }
      return rows[0]
    },
  )
}

export async function getRosterReport(sql: Sql, id: string): Promise<RosterReport | null> {
  return withPgError(
    (err) => logger.error({ err, id }, 'Failed to query roster report'),
    async () => {
      const rows = await sql<RosterReport[]>`
        SELECT id, school_id, academic_period_id, total_rows, valid_rows, rejected_rows, status, review_state,
          CASE WHEN jsonb_typeof(rows) = 'string' THEN (rows #>> '{}')::jsonb ELSE rows END AS rows,
          CASE WHEN jsonb_typeof(rejected_items) = 'string' THEN (rejected_items #>> '{}')::jsonb ELSE rejected_items END AS rejected_items,
          accepted_at::text, accepted_by, created_at::text, updated_at::text
        FROM roster_reports
        WHERE id = ${id}
        LIMIT 1
      `
      return rows[0] ?? null
    },
  )
}

export async function acceptRosterReport(
  sql: Sql,
  id: string,
  acceptedBy: string,
): Promise<RosterReport> {
  try {
    const report = await getRosterReport(sql, id)
    if (!report) {
      throw AppError.notFound('Roster report')
    }
    if (report.status === 'accepted') return report
    if (report.rejected_rows > 0 || (report.rejected_items && report.rejected_items.length > 0)) {
      throw AppError.validationError('Cannot accept a roster report with rejected rows.')
    }

    const school = await getSchool(sql)
    const period = report.academic_period_id
      ? await getAcademicPeriod(sql, report.academic_period_id)
      : null
    if (!school || !period || period.school_id !== school.id) {
      throw AppError.validationError('Academic period is required for roster acceptance.')
    }

    await sql.begin(async (tx) => {
      for (const row of report.rows) {
        const classRows = row.class_id
          ? await tx<{ id: string }[]>`
              SELECT id FROM classes
              WHERE id = ${row.class_id}::uuid AND school_id = ${school.id}::uuid
                AND academic_period_id = ${period.id}::uuid
              LIMIT 1
            `
          : await tx<{ id: string }[]>`
              SELECT id FROM classes
              WHERE school_id = ${school.id}::uuid AND academic_period_id = ${period.id}::uuid
                AND LOWER(name) = LOWER(${row.class_name})
              LIMIT 1
            `
        if (!classRows[0]) {
          throw AppError.validationError(`Class "${row.class_name}" does not exist.`)
        }
        if (row.gender !== 'L' && row.gender !== 'P') {
          throw AppError.validationError('Gender must be L or P.')
        }
        const studentRows = await tx<{ id: string }[]>`
          INSERT INTO students (nis, full_name, gender)
          VALUES (${row.nis}, ${row.full_name}, ${row.gender})
          RETURNING id
        `
        if (!studentRows[0]) throw AppError.internal('Failed to create canonical student.')
        await tx`
          INSERT INTO class_enrollments (student_id, user_id, class_id, academic_period_id, absence_number, status)
          VALUES (${studentRows[0].id}::uuid, NULL, ${classRows[0].id}::uuid, ${period.id}::uuid, ${String(row.absence_number ?? '').trim()}, 'active')
        `
      }

      await tx`
        UPDATE roster_reports
        SET status = 'accepted', review_state = 'accepted', accepted_at = NOW(), accepted_by = ${acceptedBy}, updated_at = NOW()
        WHERE id = ${id}
      `
    })

    const updated = await getRosterReport(sql, id)
    if (!updated) {
      throw AppError.internal('Failed to load accepted roster report.')
    }
    return updated
  } catch (err) {
    if (err instanceof AppError) throw err
    if (isPgUniqueViolation(err)) {
      throw AppError.conflict('Roster acceptance conflicts with an existing student or enrollment.')
    }
    logger.error({ err, id, acceptedBy }, 'Failed to accept roster report')
    throw AppError.internal('An unexpected database error occurred.')
  }
}

export async function openSignup(sql: Sql): Promise<void> {
  return withPgError(
    (err) => logger.error({ err }, 'Failed to open signup'),
    async () => {
      await sql`
        UPDATE schools
        SET signup_open = true, updated_at = NOW()
      `
    },
  )
}

export async function isSignupOpen(sql: Sql): Promise<boolean> {
  return withPgError(
    (err) => logger.error({ err }, 'Failed to check signup status'),
    async () => {
      const school = await getSchool(sql)
      return school?.signup_open === true
    },
  )
}

export async function getBootstrapStatus(sql: Sql): Promise<BootstrapStatus> {
  return withPgError(
    (err) => logger.error({ err }, 'Failed to get bootstrap status'),
    async () => {
      const school = await getSchool(sql)
      const activePeriod = await getActiveAcademicPeriod(sql)
      const schoolAdminRows = await sql<{ count: string }[]>`
        SELECT COUNT(*) as count FROM profiles WHERE role = 'school_admin' AND lifecycle_status = 'approved'
      `
      const hasSchoolAdmin = Number(schoolAdminRows[0]?.count ?? 0) > 0

      const reportRows = await sql<RosterReport[]>`
        SELECT id, school_id, academic_period_id, total_rows, valid_rows, rejected_rows, status, review_state,
          CASE WHEN jsonb_typeof(rows) = 'string' THEN (rows #>> '{}')::jsonb ELSE rows END AS rows,
          CASE WHEN jsonb_typeof(rejected_items) = 'string' THEN (rejected_items #>> '{}')::jsonb ELSE rejected_items END AS rejected_items,
          accepted_at::text, accepted_by, created_at::text, updated_at::text
        FROM roster_reports
        ORDER BY created_at DESC
        LIMIT 1
      `
      const latestReport = reportRows[0] ?? null

      const acceptedRows = await sql<{ count: string }[]>`
        SELECT COUNT(*) as count FROM roster_reports WHERE status = 'accepted'
      `
      const rosterAccepted = Number(acceptedRows[0]?.count ?? 0) > 0

      return {
        school_configured: school !== null,
        school,
        school_admin_created: hasSchoolAdmin,
        active_academic_period: activePeriod !== null,
        latest_roster_report: latestReport,
        roster_accepted: rosterAccepted,
        signup_open: school?.signup_open === true,
      }
    },
  )
}
