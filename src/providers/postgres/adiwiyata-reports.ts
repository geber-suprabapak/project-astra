import type { Sql } from 'postgres'
import { AppError } from '../../lib/errors/app-error.js'
import { ErrorCode } from '../../lib/errors/codes.js'
import { logger } from '../../lib/logging/logger.js'
import { adiwiyataReportLockName } from '../adiwiyata-lock.js'
import type {
  AdiwiyataAdminReport,
  AdiwiyataReport,
  AdiwiyataReportVerificationParams,
  AdiwiyataReportVerificationResult,
  FileLifecycle,
  FilePurpose,
  SubmitAdiwiyataReportParams,
} from '../types.js'
import {
  getDayKeyWIB,
  insertAuditLogRow,
  isPgUniqueViolation,
  withPgError,
  type PgQuery,
} from './shared.js'

interface AdiwiyataAdminReportDbRow extends AdiwiyataReport {
  site_name: string
  category: AdiwiyataAdminReport['category']
  class_name: string
  uploader_name: string | null
  file_user_id: string | null
  file_purpose: FilePurpose | null
  file_object_path: string | null
  file_content_type: string | null
  file_size_bytes: number | null
  file_lifecycle: FileLifecycle | null
  file_created_at: string | null
  file_updated_at: string | null
}

interface AdiwiyataReportVerificationDbRow extends AdiwiyataReport {
  school_id: string
}

export interface AdiwiyataReportFilter {
  classId?: string
  siteId?: string
  reportedBy?: string
  reportDate?: string
  siteIds?: string[]
}

export interface AdiwiyataAdminReportFilter {
  schoolId: string
  reportDate: string
  classId?: string
  siteId?: string
}

export async function listAdiwiyataReports(
  sql: Sql,
  filter?: AdiwiyataReportFilter,
): Promise<AdiwiyataReport[]> {
  return withPgError(
    (err) => logger.error({ err, filter }, 'Failed to list Adiwiyata reports'),
    async () => {
      if (filter?.siteIds?.length === 0) return []
      return await sql<AdiwiyataReport[]>`
        SELECT id, site_id, class_id, reported_by, file_id, report_date::text,
               created_at::text, verified_at::text, verified_by
        FROM adiwiyata_reports
        WHERE (${filter?.classId ?? null}::uuid IS NULL OR class_id = ${filter?.classId ?? null}::uuid)
          AND (${filter?.siteId ?? null}::uuid IS NULL OR site_id = ${filter?.siteId ?? null}::uuid)
          AND (${filter?.reportedBy ?? null}::text IS NULL OR reported_by = ${filter?.reportedBy ?? null})
          AND (${filter?.reportDate ?? null}::date IS NULL OR report_date = ${filter?.reportDate ?? null}::date)
          AND (${filter?.siteIds ?? null}::uuid[] IS NULL OR site_id = ANY(${filter?.siteIds ?? null}::uuid[]))
        ORDER BY created_at ASC, id ASC
      `
    },
  )
}

export async function listAdiwiyataAdminReports(
  sql: Sql,
  filter: AdiwiyataAdminReportFilter,
): Promise<AdiwiyataAdminReport[]> {
  return withPgError(
    (err) => logger.error({ err, filter }, 'Failed to list Adiwiyata admin reports'),
    async () => {
      const rows = await sql<AdiwiyataAdminReportDbRow[]>`
        SELECT r.id, r.site_id, r.class_id, r.reported_by, r.file_id, r.report_date::text,
               r.created_at::text, r.verified_at::text, r.verified_by,
               s.name AS site_name, s.category, c.name AS class_name, p.full_name AS uploader_name,
               f.user_id AS file_user_id, f.purpose AS file_purpose, f.object_path AS file_object_path,
               f.content_type AS file_content_type, f.size_bytes AS file_size_bytes,
               f.lifecycle AS file_lifecycle, f.created_at::text AS file_created_at,
               f.updated_at::text AS file_updated_at
        FROM adiwiyata_reports r
        JOIN adiwiyata_sites s ON s.id = r.site_id AND s.school_id = ${filter.schoolId}::uuid
        JOIN classes c ON c.id = r.class_id AND c.school_id = s.school_id
        JOIN files f ON f.id = r.file_id AND f.purpose = 'adiwiyata_report'
        LEFT JOIN profiles p ON p.user_id = r.reported_by
        WHERE r.report_date = ${filter.reportDate}::date
          AND (${filter.classId ?? null}::uuid IS NULL OR r.class_id = ${filter.classId ?? null}::uuid)
          AND (${filter.siteId ?? null}::uuid IS NULL OR r.site_id = ${filter.siteId ?? null}::uuid)
        ORDER BY s.sort_order, s.name, c.name, r.created_at, r.id
      `
      return rows.map((row) => ({
        id: row.id,
        site_id: row.site_id,
        class_id: row.class_id,
        reported_by: row.reported_by,
        file_id: row.file_id,
        report_date: row.report_date,
        created_at: row.created_at,
        verified_at: row.verified_at,
        verified_by: row.verified_by,
        site_name: row.site_name,
        category: row.category,
        class_name: row.class_name,
        uploader_name: row.uploader_name,
        photo_file:
          row.file_user_id === null
            ? null
            : {
                id: row.file_id,
                user_id: row.file_user_id,
                purpose: row.file_purpose!,
                object_path: row.file_object_path!,
                content_type: row.file_content_type!,
                size_bytes: row.file_size_bytes,
                lifecycle: row.file_lifecycle!,
                created_at: row.file_created_at ?? undefined,
                updated_at: row.file_updated_at ?? undefined,
              },
      }))
    },
  )
}

async function findVerificationReport(
  sql: PgQuery,
  reportId: string,
  schoolId: string,
  forUpdate: boolean,
): Promise<AdiwiyataReportVerificationDbRow | null> {
  const rows = forUpdate
    ? await sql<AdiwiyataReportVerificationDbRow[]>`
        SELECT r.id, r.site_id, r.class_id, r.reported_by, r.file_id, r.report_date::text,
               r.created_at::text, r.verified_at::text, r.verified_by, s.school_id
        FROM adiwiyata_reports r
        JOIN adiwiyata_sites s ON s.id = r.site_id
        JOIN classes c ON c.id = r.class_id AND c.school_id = s.school_id
        WHERE r.id = ${reportId}::uuid AND s.school_id = ${schoolId}::uuid
        FOR UPDATE OF r
      `
    : await sql<AdiwiyataReportVerificationDbRow[]>`
        SELECT r.id, r.site_id, r.class_id, r.reported_by, r.file_id, r.report_date::text,
               r.created_at::text, r.verified_at::text, r.verified_by, s.school_id
        FROM adiwiyata_reports r
        JOIN adiwiyata_sites s ON s.id = r.site_id
        JOIN classes c ON c.id = r.class_id AND c.school_id = s.school_id
        WHERE r.id = ${reportId}::uuid AND s.school_id = ${schoolId}::uuid
      `
  return rows[0] ?? null
}

export async function updateAdiwiyataReportVerification(
  sql: Sql,
  params: AdiwiyataReportVerificationParams,
): Promise<AdiwiyataReportVerificationResult | null> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to update Adiwiyata report verification'),
    async () => {
      return await sql.begin(async (tx) => {
        const initial = await findVerificationReport(tx, params.reportId, params.schoolId, false)
        if (!initial) return null

        const lockName = adiwiyataReportLockName(
          initial.class_id,
          initial.site_id,
          initial.report_date,
        )
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${lockName}, 0))`
        const current = await findVerificationReport(tx, params.reportId, params.schoolId, true)
        if (!current) return null

        const alreadySet = params.verified
          ? current.verified_at !== null
          : current.verified_at === null
        if (!alreadySet) {
          const verifiedAt = params.verified ? params.at : null
          const verifiedBy = params.verified ? params.actorId : null
          const updatedRows = await tx<AdiwiyataReport[]>`
            UPDATE adiwiyata_reports
            SET verified_at = ${verifiedAt}::timestamptz, verified_by = ${verifiedBy}
            WHERE id = ${params.reportId}::uuid
            RETURNING id, site_id, class_id, reported_by, file_id, report_date::text,
                      created_at::text, verified_at::text, verified_by
          `
          const report = updatedRows[0]
          if (!report) throw AppError.internal('Failed to update Adiwiyata report verification.')

          await insertAuditLogRow(
            tx,
            {
              actor_id: params.actorId,
              action: params.verified ? 'verify' : 'unverify',
              entity_type: 'adiwiyata_report',
              entity_id: report.id,
              details: {
                site_id: report.site_id,
                class_id: report.class_id,
                report_date: report.report_date,
                prior_verified_at: current.verified_at,
                prior_verified_by: current.verified_by,
                next_verified_at: report.verified_at,
                next_verified_by: report.verified_by,
              },
            },
            'Failed to record Adiwiyata verification audit.',
          )
        }

        const coverageRows = await tx<{ has_verified: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM adiwiyata_reports
            WHERE class_id = ${current.class_id}::uuid
              AND site_id = ${current.site_id}::uuid
              AND report_date = ${current.report_date}::date
              AND verified_at IS NOT NULL
          ) AS has_verified
        `
        const report: AdiwiyataReport = alreadySet
          ? current
          : {
              ...current,
              verified_at: params.verified ? params.at : null,
              verified_by: params.verified ? params.actorId : null,
            }
        return {
          report,
          coverage_status: coverageRows[0]?.has_verified ? 'verified' : 'reported',
          changed: !alreadySet,
        }
      })
    },
  )
}

async function assertStudentAdiwiyataEligible(
  tx: PgQuery,
  userId: string,
): Promise<{ full_name: string | null }> {
  const profile = await tx<{ full_name: string | null; role: string; lifecycle_status: string }[]>`
    SELECT full_name, role, lifecycle_status
    FROM profiles
    WHERE user_id = ${userId}
    LIMIT 1
  `
  if (profile[0]?.role !== 'student' || profile[0].lifecycle_status !== 'approved') {
    throw new AppError(
      ErrorCode.ADIWIYATA_NOT_ELIGIBLE,
      403,
      'Akun Siswa tidak lagi memenuhi syarat Adiwiyata.',
    )
  }
  const eligibility = await tx<{ is_active: boolean }[]>`
    SELECT is_active FROM adiwiyata_eligibility WHERE user_id = ${userId} LIMIT 1
  `
  if (!eligibility[0]?.is_active) {
    throw new AppError(ErrorCode.ADIWIYATA_NOT_ELIGIBLE, 403, 'Akses Adiwiyata tidak lagi aktif.')
  }
  return profile[0]
}

async function assertAdiwiyataScheduleAndSite(
  tx: PgQuery,
  params: SubmitAdiwiyataReportParams,
  period: { id: string; school_id: string },
): Promise<void> {
  const sites = await tx<{ id: string }[]>`
    SELECT id
    FROM adiwiyata_sites
    WHERE id = ${params.siteId}::uuid
      AND school_id = ${period.school_id}::uuid
      AND is_active = TRUE
      AND (class_id IS NULL OR class_id = ${params.classId}::uuid)
    LIMIT 1
  `
  if (!sites[0]) {
    throw AppError.validationError('Site tidak aktif atau tidak terlihat untuk kelas ini.')
  }

  const schedules = await tx<{ class_id: string | null }[]>`
    SELECT class_id
    FROM schedules
    WHERE school_id = ${period.school_id}::uuid
      AND academic_period_id = ${period.id}::uuid
      AND is_active = TRUE
      AND day_of_week = ${getDayKeyWIB(new Date(`${params.reportDate}T12:00:00+07:00`))}
  `
  const scheduleCount = await tx<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM schedules
    WHERE school_id = ${period.school_id}::uuid
      AND academic_period_id = ${period.id}::uuid
      AND is_active = TRUE
  `
  if (Number(scheduleCount[0]?.count ?? 0) === 0) {
    throw new AppError(
      ErrorCode.ADIWIYATA_CONFIGURATION_ERROR,
      503,
      'Belum ada jadwal aktif untuk sekolah dan Periode Akademik ini.',
    )
  }
  const classSchedules = schedules.filter((schedule) => schedule.class_id === params.classId)
  const applicableSchedules =
    classSchedules.length > 0
      ? classSchedules
      : schedules.filter((schedule) => schedule.class_id === null)
  if (applicableSchedules.length > 1) {
    throw new AppError(
      ErrorCode.ADIWIYATA_CONFIGURATION_ERROR,
      503,
      'Ada beberapa jadwal aktif pada tingkat kelas yang berlaku untuk hari ini.',
    )
  }
  const holidays = await tx<{ id: string }[]>`
    SELECT id
    FROM calendar_exceptions
    WHERE date = ${params.reportDate}::date
      AND is_holiday = TRUE
      AND (school_id IS NULL OR school_id = ${period.school_id}::uuid)
      AND (academic_period_id IS NULL OR academic_period_id = ${period.id}::uuid)
    LIMIT 1
  `
  if (holidays[0] || applicableSchedules.length !== 1) {
    throw AppError.conflict('Laporan hanya dapat dikirim pada hari sekolah yang dijadwalkan.')
  }
}

export async function submitAdiwiyataReport(
  sql: Sql,
  params: SubmitAdiwiyataReportParams,
): Promise<AdiwiyataReport> {
  try {
    return await sql.begin(async (tx) => {
      // Ticket 06 verify/unverify must take this same transaction lock name.
      const lockName = adiwiyataReportLockName(params.classId, params.siteId, params.reportDate)
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${lockName}, 0))`

      const profile = await assertStudentAdiwiyataEligible(tx, params.userId)
      const periods = await tx<{ id: string; school_id: string }[]>`
        SELECT id, school_id FROM academic_periods WHERE is_active = TRUE ORDER BY id
      `
      if (periods.length !== 1) {
        throw new AppError(
          ErrorCode.ADIWIYATA_CONFIGURATION_ERROR,
          503,
          'Astra harus memiliki tepat satu Periode Akademik aktif.',
        )
      }
      const period = periods[0]!
      const enrollments = await tx<
        { class_id: string; class_name: string; school_id: string; academic_period_id: string }[]
      >`
        SELECT c.id AS class_id, c.name AS class_name, c.school_id, c.academic_period_id
        FROM class_enrollments ce
        JOIN classes c ON c.id = ce.class_id
        WHERE ce.user_id = ${params.userId}
          AND ce.academic_period_id = ${period.id}::uuid
          AND ce.status = 'active'
        FOR UPDATE OF ce
      `
      if (enrollments.length !== 1 || enrollments[0]!.class_id !== params.classId) {
        throw AppError.conflict(
          'Enrollment Siswa berubah. Muat ulang dashboard sebelum mengirim foto.',
        )
      }
      const enrollment = enrollments[0]!
      if (
        enrollment.school_id !== period.school_id ||
        enrollment.academic_period_id !== period.id ||
        enrollment.class_name !== params.className ||
        profile.full_name?.trim() !== params.profileName
      ) {
        throw AppError.conflict(
          'Profil atau kelas berubah. Muat ulang dashboard sebelum mengirim foto.',
        )
      }

      await assertAdiwiyataScheduleAndSite(tx, params, period)

      const duplicate = await tx<{ id: string }[]>`
        SELECT id FROM adiwiyata_reports
        WHERE site_id = ${params.siteId}::uuid
          AND reported_by = ${params.userId}
          AND report_date = ${params.reportDate}::date
        LIMIT 1
      `
      if (duplicate[0]) {
        throw AppError.conflict(
          'Siswa sudah mengirim laporan untuk Site ini pada tanggal WIB tersebut.',
        )
      }
      const verified = await tx<{ id: string }[]>`
        SELECT id FROM adiwiyata_reports
        WHERE site_id = ${params.siteId}::uuid
          AND class_id = ${params.classId}::uuid
          AND report_date = ${params.reportDate}::date
          AND verified_at IS NOT NULL
        LIMIT 1
      `
      if (verified[0]) {
        throw AppError.conflict('Laporan kelas untuk Site ini sudah diverifikasi dan ditutup.')
      }
      const file = await tx<{ id: string }[]>`
        SELECT id FROM files
        WHERE id = ${params.fileId}::uuid
          AND user_id = ${params.userId}
          AND purpose = 'adiwiyata_report'
          AND lifecycle = 'pending_upload'
        FOR UPDATE
      `
      if (!file[0]) throw AppError.internal('Metadata foto laporan tidak tersedia.')

      const reports = await tx<AdiwiyataReport[]>`
        INSERT INTO adiwiyata_reports (
          id, site_id, class_id, reported_by, file_id, report_date, created_at
        ) VALUES (
          ${params.reportId}::uuid, ${params.siteId}::uuid, ${params.classId}::uuid,
          ${params.userId}, ${params.fileId}::uuid, ${params.reportDate}::date,
          ${params.createdAt}::timestamptz
        )
        RETURNING id, site_id, class_id, reported_by, file_id, report_date::text,
                  created_at::text, verified_at::text, verified_by
      `
      if (!reports[0]) throw AppError.internal('Failed to create Adiwiyata report.')
      const updatedFile = await tx<{ id: string }[]>`
        UPDATE files
        SET lifecycle = 'available', size_bytes = ${params.fileSizeBytes}, updated_at = ${params.createdAt}::timestamptz
        WHERE id = ${params.fileId}::uuid AND lifecycle = 'pending_upload'
        RETURNING id
      `
      if (!updatedFile[0]) {
        throw AppError.internal('Failed to activate Adiwiyata report file metadata.')
      }
      return reports[0]
    })
  } catch (err) {
    if (err instanceof AppError) throw err
    if (isPgUniqueViolation(err)) {
      throw AppError.conflict(
        'Siswa sudah mengirim laporan untuk Site ini pada tanggal WIB tersebut.',
      )
    }
    logger.error(
      { err, userId: params.userId, siteId: params.siteId },
      'Failed to submit Adiwiyata report',
    )
    throw AppError.internal('An unexpected database error occurred.')
  }
}
