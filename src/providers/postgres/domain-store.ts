import postgres, { type Sql } from 'postgres'
import { env } from '../../config/env.js'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
import type {
  Absence,
  AcademicPeriod,
  ActivePermitSummary,
  AttendanceActionRpcResponse,
  AuditLog,
  AuditLogEntry,
  BootstrapStatus,
  ClassRoom,
  CreateAcademicPeriodParams,
  CreateClassParams,
  CreateSchoolParams,
  DomainStore,
  InsertAttendanceData,
  InsertPermitData,
  Permit,
  RosterReport,
  SaveAttendanceRecordRpcResponse,
  Schedule,
  School,
  StageRosterParams,
  UserProfile,
} from '../types.js'

const DAY_KEY_MAP = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'] as const

function getTodayWIB(now = new Date()): string {
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  return wib.toISOString().slice(0, 10)
}

function getDayKeyWIB(now = new Date()): string {
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  return DAY_KEY_MAP[wib.getUTCDay()]
}

function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000 // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export interface PostgresDomainStoreOptions {
  sql?: Sql
  databaseUrl?: string
  maxConnections?: number
  idleTimeout?: number
  connectTimeout?: number
}

export class PostgresDomainStore implements DomainStore {
  private readonly sql: Sql
  private readonly ownsSql: boolean

  constructor(options: PostgresDomainStoreOptions = {}) {
    if (options.sql) {
      this.sql = options.sql
      this.ownsSql = false
    } else {
      const url = options.databaseUrl ?? env.databaseUrl
      const max = options.maxConnections ?? env.databaseMaxConnections
      const idle_timeout = options.idleTimeout ?? env.databaseIdleTimeoutSeconds
      const connect_timeout = options.connectTimeout ?? env.databaseConnectTimeoutSeconds

      this.sql = postgres(url, {
        max,
        idle_timeout,
        connect_timeout,
        transform: {
          undefined: null,
        },
      })
      this.ownsSql = true
    }
  }

  async getUserProfile(userId: string): Promise<UserProfile> {
    try {
      const rows = await this.sql<UserProfile[]>`
        SELECT user_id, full_name, email, nis, class_name, absence_number, avatar_url, role, lifecycle_status, gender
        FROM profiles
        WHERE user_id = ${userId}
        LIMIT 1
      `
      if (!rows || rows.length === 0) {
        throw AppError.notFound('User profile')
      }
      return rows[0]
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId }, 'Failed to query user profile')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async updateUserProfile(userId: string, updates: Partial<UserProfile>): Promise<void> {
    try {
      // SAFETY: keys of Partial<UserProfile> are valid property names of UserProfile
      const keys = Object.keys(updates) as (keyof UserProfile)[]
      if (keys.length === 0) return

      await this.sql`
        UPDATE profiles
        SET ${this.sql(updates)}, updated_at = NOW()
        WHERE user_id = ${userId}
      `
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId }, 'Failed to update profile')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getProfileByNis(nis: string): Promise<UserProfile | null> {
    try {
      const rows = await this.sql<UserProfile[]>`
        SELECT user_id, full_name, email, nis, class_name, absence_number, avatar_url, role, lifecycle_status, gender
        FROM profiles
        WHERE nis = ${nis}
        LIMIT 1
      `
      return rows[0] ?? null
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, nis }, 'Failed to query profile by NIS')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getTodayAbsences(userId: string, dateWIB: string): Promise<Absence[]> {
    try {
      const rows = await this.sql<Absence[]>`
        SELECT status, created_at, date, user_id
        FROM attendances
        WHERE user_id = ${userId} AND date = ${dateWIB}
        ORDER BY created_at ASC
      `
      return rows ?? []
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId, dateWIB }, 'Failed to query attendances')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async insertAttendance(data: InsertAttendanceData): Promise<Absence> {
    try {
      const createdAt = data.created_at ?? new Date().toISOString()
      const rows = await this.sql<Absence[]>`
        INSERT INTO attendances (user_id, date, status, created_at)
        VALUES (${data.user_id}, ${data.date}, ${data.status}, ${createdAt})
        RETURNING status, created_at, date, user_id
      `
      if (!rows || rows.length === 0) {
        logger.error({ data }, 'Failed to insert attendance record: empty return')
        throw AppError.internal('Failed to insert attendance record.')
      }
      return rows[0]
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, data }, 'Failed to insert attendance')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getActiveSchedule(dayKey: string): Promise<Schedule | null> {
    try {
      const rows = await this.sql<Schedule[]>`
        SELECT day_of_week AS hari, start_time::text AS mulai_masuk, end_time::text AS selesai_masuk,
               start_checkout::text AS mulai_pulang, end_checkout::text AS selesai_pulang,
               grace_period_minutes AS kompensasi_waktu, is_active
        FROM schedules
        WHERE (day_of_week = ${dayKey.toLowerCase()} OR day_of_week = ${dayKey}) AND is_active = true
        LIMIT 1
      `
      return rows[0] ?? null
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, dayKey }, 'Failed to query schedule')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getActivePermitsToday(
    userId: string,
    startISO: string,
    endISO: string,
  ): Promise<ActivePermitSummary[]> {
    try {
      const rows = await this.sql<ActivePermitSummary[]>`
        SELECT id, approval_status, category AS kategori_izin
        FROM leave_requests
        WHERE user_id = ${userId}
          AND approval_status IN ('pending', 'approved')
          AND date >= ${startISO}
          AND date < ${endISO}
      `
      return rows ?? []
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId, startISO, endISO }, 'Failed to query permits')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getPermitHistory(userId: string): Promise<Permit[]> {
    try {
      const rows = await this.sql<Permit[]>`
        SELECT id, user_id, category AS kategori_izin, description AS deskripsi,
               status, attachment_url AS link_foto, date::text AS tanggal,
               approval_status, created_at::text, rejection_reason, rejected_at::text
        FROM leave_requests
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
      `
      return rows ?? []
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId }, 'Failed to query permit history')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async insertPermit(data: InsertPermitData): Promise<Permit> {
    try {
      const rows = await this.sql<Permit[]>`
        INSERT INTO leave_requests (user_id, category, description, status, attachment_url, date)
        VALUES (${data.user_id}, ${data.kategori_izin}, ${data.deskripsi}, ${data.status}, ${data.link_foto}, ${data.tanggal})
        RETURNING id, user_id, category AS kategori_izin, description AS deskripsi,
                   status, attachment_url AS link_foto, date::text AS tanggal,
                   approval_status, created_at::text, rejection_reason, rejected_at::text
      `
      if (!rows || rows.length === 0) {
        logger.error({ data }, 'Failed to insert permit: empty return')
        throw AppError.internal('Failed to insert permit.')
      }
      return rows[0]
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, data }, 'Failed to insert permit')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async validateAttendanceAction(params: {
    userId: string
    latitude: number
    longitude: number
  }): Promise<AttendanceActionRpcResponse> {
    try {
      // 1. Check geofence location
      const locations = await this.sql<{ id: string; name: string; latitude: number; longitude: number; radius_meters: number }[]>`
        SELECT id, name, latitude, longitude, radius_meters
        FROM locations
        WHERE is_active = true
        LIMIT 1
      `

      let locationName = 'School Campus'
      if (locations && locations.length > 0) {
        const loc = locations[0]
        locationName = loc.name
        const dist = calculateDistanceMeters(params.latitude, params.longitude, loc.latitude, loc.longitude)
        if (dist > loc.radius_meters) {
          return {
            actionable: false,
            action_type: 'none',
            message: `Di luar radius lokasi sekolah (${loc.name}).`,
            details: {
              location_name: loc.name,
            },
          }
        }
      }

      // 2. Query today's attendances
      const now = new Date()
      const todayWIB = getTodayWIB(now)
      const dayKey = getDayKeyWIB(now)

      const attendances = await this.sql<{ status: string; action_type: string | null }[]>`
        SELECT status, action_type
        FROM attendances
        WHERE user_id = ${params.userId} AND date = ${todayWIB}
        ORDER BY created_at ASC
      `

      const hasCheckedIn = attendances.some((r) => r.status === 'Hadir' || r.status === 'Terlambat' || r.action_type === 'check_in')
      const hasCheckedOut = attendances.some((r) => r.status === 'Pulang' || r.action_type === 'check_out')
      const hasAbsent = attendances.some((r) => r.status === 'Alpha')

      if (hasAbsent || (hasCheckedIn && hasCheckedOut)) {
        return {
          actionable: false,
          action_type: 'none',
          message: 'Attendance for today is already complete.',
          details: {
            location_name: locationName,
          },
        }
      }

      const actionType: 'check_in' | 'check_out' = hasCheckedIn ? 'check_out' : 'check_in'

      // 3. Check schedule for late status if check_in
      let statusLabel: 'Hadir' | 'Terlambat' = 'Hadir'
      if (actionType === 'check_in') {
        const schedule = await this.getActiveSchedule(dayKey)
        if (schedule?.selesai_masuk) {
          const [h = 0, m = 0, s = 0] = schedule.selesai_masuk.split(':').map(Number)
          const [year = 1970, month = 1, day = 1] = todayWIB.split('-').map(Number)
          const endUtc = new Date(Date.UTC(year, month - 1, day, h - 7, m, s, 0))
          if (now > endUtc) {
            statusLabel = 'Terlambat'
          }
        }
      }

      return {
        actionable: true,
        action_type: actionType,
        message: 'Validation successful.',
        details: {
          location_name: locationName,
          status: statusLabel,
        },
      }
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to validate attendance action')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async saveAttendanceRecord(params: {
    userId: string
    actionType: 'check_in' | 'check_out'
    latitude: number
    longitude: number
  }): Promise<SaveAttendanceRecordRpcResponse> {
    try {
      const now = new Date()
      const todayWIB = getTodayWIB(now)
      const dayKey = getDayKeyWIB(now)

      let status: 'Hadir' | 'Terlambat' | 'Pulang' = params.actionType === 'check_in' ? 'Hadir' : 'Pulang'

      if (params.actionType === 'check_in') {
        const schedule = await this.getActiveSchedule(dayKey)
        if (schedule?.selesai_masuk) {
          const [h = 0, m = 0, s = 0] = schedule.selesai_masuk.split(':').map(Number)
          const [year = 1970, month = 1, day = 1] = todayWIB.split('-').map(Number)
          const endUtc = new Date(Date.UTC(year, month - 1, day, h - 7, m, s, 0))
          if (now > endUtc) {
            status = 'Terlambat'
          }
        }
      }

      await this.sql`
        INSERT INTO attendances (user_id, date, status, action_type, latitude, longitude, created_at)
        VALUES (${params.userId}, ${todayWIB}, ${status}, ${params.actionType}, ${params.latitude}, ${params.longitude}, ${now.toISOString()})
      `

      return { success: true }
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to save attendance record')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getSchool(): Promise<School | null> {
    try {
      const rows = await this.sql<School[]>`
        SELECT id, name, slug, timezone, signup_open, created_at::text, updated_at::text
        FROM schools
        LIMIT 1
      `
      return rows[0] ?? null
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err }, 'Failed to query school')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getSchoolBySlug(slug: string): Promise<School | null> {
    try {
      const rows = await this.sql<School[]>`
        SELECT id, name, slug, timezone, signup_open, created_at::text, updated_at::text
        FROM schools
        WHERE slug = ${slug}
        LIMIT 1
      `
      return rows[0] ?? null
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, slug }, 'Failed to query school by slug')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async createSchool(params: CreateSchoolParams): Promise<School> {
    try {
      const timezone = params.timezone ?? 'Asia/Jakarta'
      const rows = await this.sql<School[]>`
        INSERT INTO schools (name, slug, timezone, signup_open)
        VALUES (${params.name}, ${params.slug}, ${timezone}, false)
        RETURNING id, name, slug, timezone, signup_open, created_at::text, updated_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.internal('Failed to create school.')
      }
      const school = rows[0]

      await this.sql`
        INSERT INTO academic_periods (school_id, name, start_date, end_date, is_active)
        SELECT ${school.id}, '2026/2027 Ganjil', '2026-07-01'::date, '2026-12-31'::date, true
        WHERE NOT EXISTS (SELECT 1 FROM academic_periods WHERE school_id = ${school.id})
      `

      return school
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to create school')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async createInitialSchoolAdmin(params: {
    userId: string
    fullName?: string | null
    email?: string | null
  }): Promise<UserProfile> {
    try {
      const fullName = params.fullName ?? null
      const email = params.email ?? null
      const rows = await this.sql<UserProfile[]>`
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
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to create initial school admin')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getActiveAcademicPeriod(): Promise<AcademicPeriod | null> {
    try {
      const rows = await this.sql<AcademicPeriod[]>`
        SELECT id, school_id, name, start_date::text, end_date::text, is_active, created_at::text, updated_at::text
        FROM academic_periods
        WHERE is_active = true
        LIMIT 1
      `
      return rows[0] ?? null
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err }, 'Failed to query active academic period')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async createAcademicPeriod(params: CreateAcademicPeriodParams): Promise<AcademicPeriod> {
    try {
      const rows = await this.sql<AcademicPeriod[]>`
        INSERT INTO academic_periods (school_id, name, start_date, end_date, is_active)
        VALUES (${params.schoolId}, ${params.name}, ${params.startDate}::date, ${params.endDate}::date, ${params.isActive})
        RETURNING id, school_id, name, start_date::text, end_date::text, is_active, created_at::text, updated_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.internal('Failed to create academic period.')
      }
      return rows[0]
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to create academic period')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getClasses(schoolId?: string): Promise<ClassRoom[]> {
    try {
      if (schoolId) {
        const rows = await this.sql<ClassRoom[]>`
          SELECT id, school_id, academic_period_id, name, grade, created_at::text, updated_at::text
          FROM classes
          WHERE school_id = ${schoolId}
          ORDER BY name ASC
        `
        return rows ?? []
      }
      const rows = await this.sql<ClassRoom[]>`
        SELECT id, school_id, academic_period_id, name, grade, created_at::text, updated_at::text
        FROM classes
        ORDER BY name ASC
      `
      return rows ?? []
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, schoolId }, 'Failed to query classes')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async createClass(params: CreateClassParams): Promise<ClassRoom> {
    try {
      const rows = await this.sql<ClassRoom[]>`
        INSERT INTO classes (school_id, academic_period_id, name, grade)
        VALUES (${params.schoolId}, ${params.academicPeriodId ?? null}, ${params.name}, ${params.grade ?? null})
        RETURNING id, school_id, academic_period_id, name, grade, created_at::text, updated_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.internal('Failed to create class.')
      }
      return rows[0]
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to create class')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async stageRosterReport(params: StageRosterParams): Promise<RosterReport> {
    try {
      const rowsJson = JSON.stringify(params.rows)
      const rejectedJson = JSON.stringify(params.rejectedItems)
      const rows = await this.sql<RosterReport[]>`
        INSERT INTO roster_reports (school_id, total_rows, valid_rows, rejected_rows, status, review_state, rows, rejected_items)
        VALUES (${params.schoolId ?? null}, ${params.totalRows}, ${params.validRows}, ${params.rejectedRows}, ${params.status}, ${params.reviewState}, ${rowsJson}::jsonb, ${rejectedJson}::jsonb)
        RETURNING id, school_id, total_rows, valid_rows, rejected_rows, status, review_state, rows, rejected_items, accepted_at::text, accepted_by, created_at::text, updated_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.internal('Failed to stage roster report.')
      }
      return rows[0]
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to stage roster report')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getRosterReport(id: string): Promise<RosterReport | null> {
    try {
      const rows = await this.sql<RosterReport[]>`
        SELECT id, school_id, total_rows, valid_rows, rejected_rows, status, review_state, rows, rejected_items, accepted_at::text, accepted_by, created_at::text, updated_at::text
        FROM roster_reports
        WHERE id = ${id}
        LIMIT 1
      `
      return rows[0] ?? null
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, id }, 'Failed to query roster report')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async acceptRosterReport(id: string, acceptedBy: string): Promise<RosterReport> {
    try {
      const report = await this.getRosterReport(id)
      if (!report) {
        throw AppError.notFound('Roster report')
      }
      if (report.rejected_rows > 0 || (report.rejected_items && report.rejected_items.length > 0)) {
        throw AppError.validationError('Cannot accept a roster report with rejected rows.')
      }

      const school = await this.getSchool()
      const period = await this.getActiveAcademicPeriod()

      await this.sql.begin(async (sql) => {
        for (const row of report.rows) {
          let classId: string | null = null
          if (school) {
            const classRows = await sql<{ id: string }[]>`
              SELECT id FROM classes WHERE school_id = ${school.id} AND LOWER(name) = LOWER(${row.class_name}) LIMIT 1
            `
            if (classRows.length > 0) {
              classId = classRows[0].id
            } else {
              const newClassRows = await sql<{ id: string }[]>`
                INSERT INTO classes (school_id, academic_period_id, name, grade)
                VALUES (${school.id}, ${period?.id ?? null}, ${row.class_name}, ${row.grade ?? null})
                RETURNING id
              `
              classId = newClassRows[0].id
            }
          }

          const studentUserId = `student-${row.nis}`
          await sql`
            INSERT INTO profiles (user_id, full_name, nis, class_name, role, lifecycle_status)
            VALUES (${studentUserId}, ${row.full_name}, ${row.nis}, ${row.class_name}, 'student', 'approved')
            ON CONFLICT (user_id) DO UPDATE
            SET full_name = EXCLUDED.full_name, nis = EXCLUDED.nis, class_name = EXCLUDED.class_name, updated_at = NOW()
          `

          if (classId && period) {
            await sql`
              INSERT INTO class_enrollments (user_id, class_id, academic_period_id, status)
              VALUES (${studentUserId}, ${classId}, ${period.id}, 'active')
            `
          }
        }

        await sql`
          UPDATE roster_reports
          SET status = 'accepted', review_state = 'accepted', accepted_at = NOW(), accepted_by = ${acceptedBy}, updated_at = NOW()
          WHERE id = ${id}
        `
      })

      const updated = await this.getRosterReport(id)
      if (!updated) {
        throw AppError.internal('Failed to load accepted roster report.')
      }
      return updated
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, id, acceptedBy }, 'Failed to accept roster report')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async openSignup(): Promise<void> {
    try {
      await this.sql`
        UPDATE schools
        SET signup_open = true, updated_at = NOW()
      `
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err }, 'Failed to open signup')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async isSignupOpen(): Promise<boolean> {
    try {
      const school = await this.getSchool()
      return school?.signup_open === true
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err }, 'Failed to check signup status')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getBootstrapStatus(): Promise<BootstrapStatus> {
    try {
      const school = await this.getSchool()
      const activePeriod = await this.getActiveAcademicPeriod()
      const schoolAdminRows = await this.sql<{ count: string }[]>`
        SELECT COUNT(*) as count FROM profiles WHERE role = 'school_admin' AND lifecycle_status = 'approved'
      `
      const hasSchoolAdmin = Number(schoolAdminRows[0]?.count ?? 0) > 0

      const reportRows = await this.sql<RosterReport[]>`
        SELECT id, school_id, total_rows, valid_rows, rejected_rows, status, review_state, rows, rejected_items, accepted_at::text, accepted_by, created_at::text, updated_at::text
        FROM roster_reports
        ORDER BY created_at DESC
        LIMIT 1
      `
      const latestReport = reportRows[0] ?? null

      const acceptedRows = await this.sql<{ count: string }[]>`
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
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err }, 'Failed to get bootstrap status')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async insertAuditLog(entry: AuditLogEntry): Promise<void> {
    try {
      const detailsJson = entry.details ? JSON.stringify(entry.details) : null
      await this.sql`
        INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details)
        VALUES (${entry.actor_id ?? null}, ${entry.action}, ${entry.entity_type}, ${entry.entity_id ?? null}, ${detailsJson}::jsonb)
      `
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, entry }, 'Failed to insert audit log')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getAuditLogs(entityType?: string, entityId?: string): Promise<AuditLog[]> {
    try {
      if (entityType && entityId) {
        const rows = await this.sql<AuditLog[]>`
          SELECT id, actor_id, action, entity_type, entity_id, details, created_at::text
          FROM audit_logs
          WHERE entity_type = ${entityType} AND entity_id = ${entityId}
          ORDER BY created_at DESC
        `
        return rows ?? []
      }
      if (entityType) {
        const rows = await this.sql<AuditLog[]>`
          SELECT id, actor_id, action, entity_type, entity_id, details, created_at::text
          FROM audit_logs
          WHERE entity_type = ${entityType}
          ORDER BY created_at DESC
        `
        return rows ?? []
      }
      const rows = await this.sql<AuditLog[]>`
        SELECT id, actor_id, action, entity_type, entity_id, details, created_at::text
        FROM audit_logs
        ORDER BY created_at DESC
      `
      return rows ?? []
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, entityType, entityId }, 'Failed to query audit logs')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      const rows = await this.sql`SELECT 1 as ok`
      return Boolean(rows && rows.length > 0)
    } catch {
      return false
    }
  }

  async close(): Promise<void> {
    if (this.ownsSql) {
      await this.sql.end()
    }
  }
}
