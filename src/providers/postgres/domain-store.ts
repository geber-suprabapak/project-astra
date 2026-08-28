import postgres, { type Sql } from 'postgres'
import { env } from '../../config/env.js'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
import type {
  Absence,
  AcademicPeriod,
  ActivePermitSummary,
  AttendanceActionRpcResponse,
  AttendanceActionType,
  AttendanceAttempt,
  AttendanceAttemptStatus,
  AttendanceRecord,
  AttendanceStatus,
  AuditLog,
  AuditLogEntry,
  BootstrapStatus,
  CalendarException,
  ClassEnrollment,
  ClassEnrollmentStatus,
  ClassRoom,
  ClaimPendingNotificationsParams,
  CreateAcademicPeriodParams,
  CreateCalendarExceptionParams,
  CreateClassParams,
  CreateFileRecordParams,
  CreateLeaveRequestData,
  CreateLocationParams,
  CreateManualAttendanceParams,
  CreatePasswordResetCodeParams,
  CreatePermissionParams,
  CreateRoleParams,
  CreateScheduleParams,
  CreateSchoolParams,
  CreateStaffParams,
  DomainStore,
  EnqueueNotificationParams,
  EnrollStudentParams,
  ExitStudentEnrollmentParams,
  FaceEnrollmentRecord,
  FileLifecycle,
  FilePurpose,
  FileRecord,
  InsertAttendanceData,
  InsertPermitData,
  LeaveRequest,
  ListLeaveRequestsFilter,
  ListNotificationsFilter,
  Location,
  NotificationChannel,
  NotificationPayload,
  NotificationRecord,
  NotificationStatus,
  PasswordResetCode,
  Permission,
  Permit,
  ProfileLifecycleStatus,
  PromoteStudentEnrollmentParams,
  RecordAttendanceAttemptParams,
  Role,
  RosterReport,
  RosterStudent,
  SaveAttendanceRecordRpcResponse,
  SaveFaceEnrollmentParams,
  Schedule,
  School,
  StageRosterParams,
  TransferStudentEnrollmentParams,
  UpdateAcademicPeriodParams,
  UpdateCalendarExceptionParams,
  UpdateClassParams,
  UpdateLocationParams,
  UpdateRoleParams,
  UpdateScheduleParams,
  UpdateStaffParams,
  UpdateLeaveRequestStatusParams,
  UpdateNotificationStatusParams,
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
        SELECT user_id, full_name, email, nis, class_name, absence_number, avatar_url, notification_token, role, lifecycle_status, gender
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

  async resolveLegacyUserId(legacyUserId: string): Promise<string | null> {
    try {
      const rows = await this.sql<{ target_user_id: string }[]>`
        SELECT target_user_id
        FROM legacy_identity_mappings
        WHERE legacy_user_id = ${legacyUserId}::uuid
        LIMIT 1
      `
      return rows[0]?.target_user_id ?? null
    } catch (err) {
      logger.error({ err, legacyUserId }, 'Failed to resolve legacy identity mapping')
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

  async getActiveSchedule(
    dayKey: string,
    params?: { classId?: string; academicPeriodId?: string },
  ): Promise<Schedule | null> {
    try {
      const day = dayKey.toLowerCase()
      const classId = params?.classId ?? null
      const periodId = params?.academicPeriodId ?? null

      const rows = await this.sql<Schedule[]>`
        SELECT id, school_id, class_id, academic_period_id, location_id,
               day_of_week, day_of_week AS hari, start_time::text AS mulai_masuk, end_time::text AS selesai_masuk,
               start_checkout::text AS mulai_pulang, end_checkout::text AS selesai_pulang,
               grace_period_minutes AS kompensasi_waktu, is_active,
               created_at::text, updated_at::text
        FROM schedules
        WHERE is_active = true
          AND (day_of_week = ${day})
          AND (
            (${classId}::uuid IS NOT NULL AND ${periodId}::uuid IS NOT NULL AND class_id = ${classId}::uuid AND academic_period_id = ${periodId}::uuid)
            OR (${classId}::uuid IS NOT NULL AND class_id = ${classId}::uuid AND academic_period_id IS NULL)
            OR (${periodId}::uuid IS NOT NULL AND academic_period_id = ${periodId}::uuid AND class_id IS NULL)
            OR (class_id IS NULL AND academic_period_id IS NULL)
          )
        ORDER BY
          CASE
            WHEN ${classId}::uuid IS NOT NULL AND ${periodId}::uuid IS NOT NULL AND class_id = ${classId}::uuid AND academic_period_id = ${periodId}::uuid THEN 1
            WHEN ${classId}::uuid IS NOT NULL AND class_id = ${classId}::uuid THEN 2
            WHEN ${periodId}::uuid IS NOT NULL AND academic_period_id = ${periodId}::uuid THEN 3
            ELSE 4
          END ASC
        LIMIT 1
      `
      if (rows && rows.length > 0) {
        return rows[0]
      }

      // Fallback for simple single-day matches if not class/period specific
      const fallbackRows = await this.sql<Schedule[]>`
        SELECT id, school_id, class_id, academic_period_id, location_id,
               day_of_week, day_of_week AS hari, start_time::text AS mulai_masuk, end_time::text AS selesai_masuk,
               start_checkout::text AS mulai_pulang, end_checkout::text AS selesai_pulang,
               grace_period_minutes AS kompensasi_waktu, is_active,
               created_at::text, updated_at::text
        FROM schedules
        WHERE is_active = true AND day_of_week = ${day}
        LIMIT 1
      `
      return fallbackRows[0] ?? null
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, dayKey, params }, 'Failed to query schedule')
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

  async createLeaveRequest(data: CreateLeaveRequestData): Promise<LeaveRequest> {
    try {
      const approvalStatus = data.approval_status ?? 'approved'
      const status = data.status !== undefined ? data.status : approvalStatus === 'approved'
      const rows = await this.sql<LeaveRequest[]>`
        INSERT INTO leave_requests (user_id, category, description, status, attachment_url, date, approval_status)
        VALUES (${data.user_id}, ${data.category}, ${data.description}, ${status}, ${data.attachment_url ?? null}, ${data.date}, ${approvalStatus})
        RETURNING id, user_id, category, description, status,
                   attachment_url, date::text AS date, approval_status,
                   rejection_reason, rejected_at::text, created_at::text, updated_at::text
      `
      if (!rows || rows.length === 0) {
        logger.error({ data }, 'Failed to insert leave request: empty return')
        throw AppError.internal('Failed to create leave request.')
      }
      const created = rows[0]
      const profile = await this.getUserProfile(created.user_id).catch(() => null)
      if (profile) {
        created.student_name = profile.full_name ?? null
        created.student_nis = profile.nis ?? null
        created.student_class = profile.class_name ?? null
        created.absence_number = profile.absence_number ?? null
      }
      return created
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, data }, 'Failed to insert leave request')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getLeaveRequestById(id: string): Promise<LeaveRequest | null> {
    try {
      const rows = await this.sql<LeaveRequest[]>`
        SELECT lr.id, lr.user_id, lr.category, lr.description, lr.status,
               lr.attachment_url, lr.date::text AS date, lr.approval_status,
               lr.rejection_reason, lr.rejected_at::text, lr.created_at::text, lr.updated_at::text,
               p.full_name AS student_name, p.nis AS student_nis, p.class_name AS student_class,
               p.absence_number
        FROM leave_requests lr
        LEFT JOIN profiles p ON lr.user_id = p.user_id
        WHERE lr.id = ${id}
        LIMIT 1
      `
      return rows[0] ?? null
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, id }, 'Failed to get leave request by ID')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async listLeaveRequests(filter?: ListLeaveRequestsFilter): Promise<LeaveRequest[]> {
    try {
      const rows = await this.sql<LeaveRequest[]>`
        SELECT lr.id, lr.user_id, lr.category, lr.description, lr.status,
               lr.attachment_url, lr.date::text AS date, lr.approval_status,
               lr.rejection_reason, lr.rejected_at::text, lr.created_at::text, lr.updated_at::text,
               p.full_name AS student_name, p.nis AS student_nis, p.class_name AS student_class,
               p.absence_number
        FROM leave_requests lr
        LEFT JOIN profiles p ON lr.user_id = p.user_id
        WHERE 1=1
          ${filter?.userId ? this.sql`AND lr.user_id = ${filter.userId}` : this.sql``}
          ${filter?.approvalStatus ? this.sql`AND lr.approval_status = ${filter.approvalStatus}` : this.sql``}
          ${filter?.category ? this.sql`AND lr.category = ${filter.category}` : this.sql``}
          ${filter?.startDate ? this.sql`AND lr.date >= ${filter.startDate}` : this.sql``}
          ${filter?.endDate ? this.sql`AND lr.date <= ${filter.endDate}` : this.sql``}
        ORDER BY lr.created_at DESC
        ${filter?.limit ? this.sql`LIMIT ${filter.limit}` : this.sql``}
        ${filter?.offset ? this.sql`OFFSET ${filter.offset}` : this.sql``}
      `
      return rows ?? []
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, filter }, 'Failed to list leave requests')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async updateLeaveRequestStatus(params: UpdateLeaveRequestStatusParams): Promise<LeaveRequest> {
    try {
      const statusValue =
        params.status !== undefined ? params.status : params.approvalStatus === 'approved'
      const rows = await this.sql<LeaveRequest[]>`
        UPDATE leave_requests
        SET approval_status = ${params.approvalStatus},
            status = ${statusValue},
            rejection_reason = ${params.rejectionReason ?? null},
            rejected_at = ${params.rejectedAt ? params.rejectedAt : params.approvalStatus === 'rejected' ? this.sql`NOW()` : null},
            updated_at = NOW()
        WHERE id = ${params.id}
        RETURNING id, user_id, category, description, status,
                  attachment_url, date::text AS date, approval_status,
                  rejection_reason, rejected_at::text, created_at::text, updated_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.notFound('Leave request')
      }
      const updated = rows[0]
      const profile = await this.getUserProfile(updated.user_id).catch(() => null)
      if (profile) {
        updated.student_name = profile.full_name ?? null
        updated.student_nis = profile.nis ?? null
        updated.student_class = profile.class_name ?? null
        updated.absence_number = profile.absence_number ?? null
      }
      return updated
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to update leave request status')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async deleteLeaveRequest(id: string): Promise<void> {
    try {
      await this.sql`
        DELETE FROM leave_requests
        WHERE id = ${id}
      `
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, id }, 'Failed to delete leave request')
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
      const locations = await this.sql<
        { id: string; name: string; latitude: number; longitude: number; radius_meters: number }[]
      >`
        SELECT id, name, latitude, longitude, radius_meters
        FROM locations
        WHERE is_active = true
      `

      if (!locations || locations.length === 0) {
        return {
          actionable: false,
          action_type: 'none',
          message: 'No active attendance location/geofence configured.',
          details: null,
        }
      }

      let matchedLocation: {
        id: string
        name: string
        latitude: number
        longitude: number
        radius_meters: number
      } | null = null
      for (const loc of locations) {
        const dist = calculateDistanceMeters(
          params.latitude,
          params.longitude,
          loc.latitude,
          loc.longitude,
        )
        if (dist <= loc.radius_meters) {
          matchedLocation = loc
          break
        }
      }

      if (!matchedLocation) {
        const loc = locations[0]
        return {
          actionable: false,
          action_type: 'none',
          message: `Di luar radius lokasi sekolah (${loc.name}).`,
          details: {
            location_name: loc.name,
          },
        }
      }

      const locationName = matchedLocation.name

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

      const hasCheckedIn = attendances.some(
        (r) => r.status === 'Hadir' || r.status === 'Terlambat' || r.action_type === 'check_in',
      )
      const hasCheckedOut = attendances.some(
        (r) => r.status === 'Pulang' || r.action_type === 'check_out',
      )
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

      let status: 'Hadir' | 'Terlambat' | 'Pulang' =
        params.actionType === 'check_in' ? 'Hadir' : 'Pulang'

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

  async recordAttendanceAttempt(params: RecordAttendanceAttemptParams): Promise<AttendanceAttempt> {
    try {
      const rows = await this.sql<AttendanceAttempt[]>`
        INSERT INTO attendance_attempts (
          user_id, action_type, status, reason, quality_score, confidence, latitude, longitude, process_time_ms
        )
        VALUES (
          ${params.userId}, ${params.actionType}, ${params.status},
          ${params.reason ?? null}, ${params.qualityScore ?? null}, ${params.confidence ?? null},
          ${params.latitude ?? null}, ${params.longitude ?? null}, ${params.processTimeMs ?? null}
        )
        RETURNING id, user_id, action_type, status, reason, quality_score, confidence,
                  latitude, longitude, process_time_ms, created_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.internal('Failed to record attendance attempt.')
      }
      return rows[0]
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to record attendance attempt')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async listAttendanceAttempts(filter?: {
    userId?: string
    status?: AttendanceAttemptStatus
    actionType?: AttendanceActionType
    limit?: number
  }): Promise<AttendanceAttempt[]> {
    try {
      const limit = Math.min(Math.max(filter?.limit ?? 50, 1), 100)
      const rows = await this.sql<AttendanceAttempt[]>`
        SELECT id, user_id, action_type, status, reason, quality_score, confidence,
               latitude, longitude, process_time_ms, created_at::text
        FROM attendance_attempts
        WHERE 1 = 1
          ${filter?.userId ? this.sql`AND user_id = ${filter.userId}` : this.sql``}
          ${filter?.status ? this.sql`AND status = ${filter.status}` : this.sql``}
          ${filter?.actionType ? this.sql`AND action_type = ${filter.actionType}` : this.sql``}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `
      return rows
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, filter }, 'Failed to list attendance attempts')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getAttendanceAttempt(id: string): Promise<AttendanceAttempt | null> {
    try {
      const rows = await this.sql<AttendanceAttempt[]>`
        SELECT id, user_id, action_type, status, reason, quality_score, confidence,
               latitude, longitude, process_time_ms, created_at::text
        FROM attendance_attempts
        WHERE id = ${id}
        LIMIT 1
      `
      return rows[0] ?? null
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, id }, 'Failed to get attendance attempt')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async createManualAttendance(params: CreateManualAttendanceParams): Promise<AttendanceRecord> {
    try {
      const now = new Date()
      const todayWIB = params.date ?? getTodayWIB(now)
      const dayKey = getDayKeyWIB(now)

      let status: AttendanceStatus =
        params.status ?? (params.actionType === 'check_in' ? 'Hadir' : 'Pulang')

      if (!params.status && params.actionType === 'check_in') {
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

      const rows = await this.sql<AttendanceRecord[]>`
        INSERT INTO attendances (user_id, date, status, action_type, latitude, longitude, created_at)
        VALUES (${params.userId}, ${todayWIB}, ${status}, ${params.actionType}, ${params.latitude ?? null}, ${params.longitude ?? null}, ${now.toISOString()})
        RETURNING id, user_id, date, status, action_type, latitude, longitude, created_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.internal('Failed to create manual attendance record.')
      }
      return rows[0]
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to create manual attendance record')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async listAttendances(filter?: {
    userId?: string
    date?: string
    status?: string
    actionType?: string
    limit?: number
  }): Promise<AttendanceRecord[]> {
    try {
      const limit = Math.min(Math.max(filter?.limit ?? 50, 1), 100)
      const rows = await this.sql<AttendanceRecord[]>`
        SELECT id, user_id, date, status, action_type, latitude, longitude, created_at::text
        FROM attendances
        WHERE 1 = 1
          ${filter?.userId ? this.sql`AND user_id = ${filter.userId}` : this.sql``}
          ${filter?.date ? this.sql`AND date = ${filter.date}` : this.sql``}
          ${filter?.status ? this.sql`AND status = ${filter.status}` : this.sql``}
          ${filter?.actionType ? this.sql`AND action_type = ${filter.actionType}` : this.sql``}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `
      return rows
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, filter }, 'Failed to list attendances')
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

  async listAcademicPeriods(filter?: { isActive?: boolean }): Promise<AcademicPeriod[]> {
    try {
      if (filter?.isActive !== undefined) {
        const rows = await this.sql<AcademicPeriod[]>`
          SELECT id, school_id, name, start_date::text, end_date::text, is_active, created_at::text, updated_at::text
          FROM academic_periods
          WHERE is_active = ${filter.isActive}
          ORDER BY start_date DESC
        `
        return rows ?? []
      }
      const rows = await this.sql<AcademicPeriod[]>`
        SELECT id, school_id, name, start_date::text, end_date::text, is_active, created_at::text, updated_at::text
        FROM academic_periods
        ORDER BY start_date DESC
      `
      return rows ?? []
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, filter }, 'Failed to list academic periods')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getAcademicPeriod(id: string): Promise<AcademicPeriod | null> {
    try {
      const rows = await this.sql<AcademicPeriod[]>`
        SELECT id, school_id, name, start_date::text, end_date::text, is_active, created_at::text, updated_at::text
        FROM academic_periods
        WHERE id = ${id}
        LIMIT 1
      `
      return rows[0] ?? null
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, id }, 'Failed to get academic period')
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
      let schoolId = params.schoolId
      if (!schoolId) {
        const school = await this.getSchool()
        schoolId = school?.id ?? 'a0000000-0000-0000-0000-000000000001'
      }
      const isActive = params.isActive ?? true

      const beginFn = this.sql.begin
        ? this.sql.begin.bind(this.sql)
        : async (cb: (sql: Sql) => Promise<AcademicPeriod>) => cb(this.sql)
      return await beginFn(async (sql) => {
        if (isActive) {
          await sql`UPDATE academic_periods SET is_active = false, updated_at = NOW() WHERE school_id = ${schoolId}`
        }
        const rows = await sql<AcademicPeriod[]>`
          INSERT INTO academic_periods (school_id, name, start_date, end_date, is_active)
          VALUES (${schoolId}, ${params.name}, ${params.startDate}::date, ${params.endDate}::date, ${isActive})
          RETURNING id, school_id, name, start_date::text, end_date::text, is_active, created_at::text, updated_at::text
        `
        if (!rows || rows.length === 0) {
          throw AppError.internal('Failed to create academic period.')
        }
        return rows[0]
      })
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to create academic period')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async updateAcademicPeriod(
    id: string,
    params: UpdateAcademicPeriodParams,
  ): Promise<AcademicPeriod> {
    try {
      const beginFn = this.sql.begin
        ? this.sql.begin.bind(this.sql)
        : async (cb: (sql: Sql) => Promise<AcademicPeriod>) => cb(this.sql)
      return await beginFn(async (sql) => {
        const existing = await sql<
          { id: string; school_id: string }[]
        >`SELECT id, school_id FROM academic_periods WHERE id = ${id} LIMIT 1`
        if (!existing || existing.length === 0) {
          throw AppError.notFound('Academic period')
        }
        if (params.isActive === true) {
          await sql`UPDATE academic_periods SET is_active = false, updated_at = NOW() WHERE school_id = ${existing[0].school_id}`
        }
        const rows = await sql<AcademicPeriod[]>`
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
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, id, params }, 'Failed to update academic period')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async setActiveAcademicPeriod(id: string): Promise<AcademicPeriod> {
    try {
      const beginFn = this.sql.begin
        ? this.sql.begin.bind(this.sql)
        : async (cb: (sql: Sql) => Promise<AcademicPeriod>) => cb(this.sql)
      return await beginFn(async (sql) => {
        const existing = await sql<
          { id: string; school_id: string }[]
        >`SELECT id, school_id FROM academic_periods WHERE id = ${id} LIMIT 1`
        if (!existing || existing.length === 0) {
          throw AppError.notFound('Academic period')
        }
        await sql`UPDATE academic_periods SET is_active = false, updated_at = NOW() WHERE school_id = ${existing[0].school_id}`
        const rows = await sql<AcademicPeriod[]>`
          UPDATE academic_periods
          SET is_active = true, updated_at = NOW()
          WHERE id = ${id}
          RETURNING id, school_id, name, start_date::text, end_date::text, is_active, created_at::text, updated_at::text
        `
        return rows[0]
      })
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, id }, 'Failed to set active academic period')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getClasses(schoolId?: string, academicPeriodId?: string): Promise<ClassRoom[]> {
    try {
      const sId = schoolId ?? null
      const aId = academicPeriodId ?? null
      const rows = await this.sql<ClassRoom[]>`
        SELECT id, school_id, academic_period_id, name, grade, created_at::text, updated_at::text
        FROM classes
        WHERE (${sId}::uuid IS NULL OR school_id = ${sId}::uuid)
          AND (${aId}::uuid IS NULL OR academic_period_id = ${aId}::uuid)
        ORDER BY name ASC
      `
      return rows ?? []
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, schoolId, academicPeriodId }, 'Failed to query classes')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getClassById(id: string): Promise<ClassRoom | null> {
    try {
      const rows = await this.sql<ClassRoom[]>`
        SELECT id, school_id, academic_period_id, name, grade, created_at::text, updated_at::text
        FROM classes
        WHERE id = ${id}
        LIMIT 1
      `
      return rows[0] ?? null
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, id }, 'Failed to get class by id')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async createClass(params: CreateClassParams): Promise<ClassRoom> {
    try {
      let schoolId = params.schoolId
      if (!schoolId) {
        const school = await this.getSchool()
        schoolId = school?.id ?? 'a0000000-0000-0000-0000-000000000001'
      }
      const rows = await this.sql<ClassRoom[]>`
        INSERT INTO classes (school_id, academic_period_id, name, grade)
        VALUES (${schoolId}, ${params.academicPeriodId ?? null}, ${params.name}, ${params.grade ?? null})
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

  async updateClass(id: string, params: UpdateClassParams): Promise<ClassRoom> {
    try {
      const existing = await this.getClassById(id)
      if (!existing) throw AppError.notFound('Class')

      const rows = await this.sql<ClassRoom[]>`
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
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, id, params }, 'Failed to update class')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async listClassEnrollments(filter?: {
    userId?: string
    classId?: string
    academicPeriodId?: string
    status?: ClassEnrollmentStatus
  }): Promise<ClassEnrollment[]> {
    try {
      const rows = await this.sql<ClassEnrollment[]>`
        SELECT ce.id, ce.user_id, ce.class_id, ce.academic_period_id, ce.status,
               ce.created_at::text, ce.updated_at::text,
               c.name AS class_name, p.full_name AS student_name, p.nis,
               ap.name AS period_name
        FROM class_enrollments ce
        LEFT JOIN classes c ON c.id = ce.class_id
        LEFT JOIN profiles p ON p.user_id = ce.user_id
        LEFT JOIN academic_periods ap ON ap.id = ce.academic_period_id
        WHERE (${filter?.userId ?? null}::text IS NULL OR ce.user_id = ${filter?.userId ?? null})
          AND (${filter?.classId ?? null}::uuid IS NULL OR ce.class_id = ${filter?.classId ?? null}::uuid)
          AND (${filter?.academicPeriodId ?? null}::uuid IS NULL OR ce.academic_period_id = ${filter?.academicPeriodId ?? null}::uuid)
          AND (${filter?.status ?? null}::text IS NULL OR ce.status = ${filter?.status ?? null})
        ORDER BY ce.created_at DESC
      `
      return rows ?? []
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, filter }, 'Failed to list class enrollments')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getActiveClassEnrollment(
    userId: string,
    academicPeriodId?: string,
  ): Promise<ClassEnrollment | null> {
    try {
      let targetPeriodId = academicPeriodId
      if (!targetPeriodId) {
        const activePeriod = await this.getActiveAcademicPeriod()
        if (!activePeriod) return null
        targetPeriodId = activePeriod.id
      }

      const rows = await this.sql<ClassEnrollment[]>`
        SELECT ce.id, ce.user_id, ce.class_id, ce.academic_period_id, ce.status,
               ce.created_at::text, ce.updated_at::text,
               c.name AS class_name, p.full_name AS student_name, p.nis,
               ap.name AS period_name
        FROM class_enrollments ce
        LEFT JOIN classes c ON c.id = ce.class_id
        LEFT JOIN profiles p ON p.user_id = ce.user_id
        LEFT JOIN academic_periods ap ON ap.id = ce.academic_period_id
        WHERE ce.user_id = ${userId}
          AND ce.academic_period_id = ${targetPeriodId}::uuid
          AND ce.status = 'active'
        LIMIT 1
      `
      return rows[0] ?? null
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId, academicPeriodId }, 'Failed to get active class enrollment')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async enrollStudentInClass(params: EnrollStudentParams): Promise<ClassEnrollment> {
    try {
      const cls = await this.getClassById(params.classId)
      if (!cls) throw AppError.notFound('Class')
      const period = await this.getAcademicPeriod(params.academicPeriodId)
      if (!period) throw AppError.notFound('Academic period')

      const beginFn = this.sql.begin
        ? this.sql.begin.bind(this.sql)
        : async (cb: (sql: Sql) => Promise<ClassEnrollment>) => cb(this.sql)
      return await beginFn(async (sql) => {
        const existing = await sql<ClassEnrollment[]>`
          SELECT id FROM class_enrollments
          WHERE user_id = ${params.userId} AND academic_period_id = ${params.academicPeriodId}::uuid AND status = 'active'
          LIMIT 1
        `
        if (existing && existing.length > 0) {
          throw AppError.conflict(
            'Student already has an active class enrollment in this academic period.',
          )
        }

        const rows = await sql<ClassEnrollment[]>`
          INSERT INTO class_enrollments (user_id, class_id, academic_period_id, status)
          VALUES (${params.userId}, ${params.classId}::uuid, ${params.academicPeriodId}::uuid, 'active')
          RETURNING id, user_id, class_id, academic_period_id, status, created_at::text, updated_at::text
        `

        await sql`
          UPDATE profiles SET class_name = ${cls.name}, updated_at = NOW() WHERE user_id = ${params.userId}
        `

        return {
          ...rows[0],
          class_name: cls.name,
          period_name: period.name,
        }
      })
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to enroll student in class')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async transferStudentEnrollment(
    params: TransferStudentEnrollmentParams,
  ): Promise<{ previous: ClassEnrollment; current: ClassEnrollment }> {
    try {
      const targetClass = await this.getClassById(params.toClassId)
      if (!targetClass) throw AppError.notFound('Target class')

      const beginFn = this.sql.begin
        ? this.sql.begin.bind(this.sql)
        : async (
            cb: (sql: Sql) => Promise<{ previous: ClassEnrollment; current: ClassEnrollment }>,
          ) => cb(this.sql)
      return await beginFn(async (sql) => {
        const activeRows = await sql<ClassEnrollment[]>`
          SELECT id, user_id, class_id, academic_period_id, status, created_at::text, updated_at::text
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

        const updatedPrevRows = await sql<ClassEnrollment[]>`
          UPDATE class_enrollments
          SET status = 'transferred', updated_at = NOW()
          WHERE id = ${prev.id}
          RETURNING id, user_id, class_id, academic_period_id, status, created_at::text, updated_at::text
        `

        const newRows = await sql<ClassEnrollment[]>`
          INSERT INTO class_enrollments (user_id, class_id, academic_period_id, status)
          VALUES (${params.userId}, ${params.toClassId}::uuid, ${params.academicPeriodId}::uuid, 'active')
          RETURNING id, user_id, class_id, academic_period_id, status, created_at::text, updated_at::text
        `

        await sql`
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
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to transfer student enrollment')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async promoteStudentEnrollment(
    params: PromoteStudentEnrollmentParams,
  ): Promise<{ previous: ClassEnrollment; current: ClassEnrollment }> {
    try {
      const targetClass = await this.getClassById(params.toClassId)
      if (!targetClass) throw AppError.notFound('Target class')
      const targetPeriod = await this.getAcademicPeriod(params.toAcademicPeriodId)
      if (!targetPeriod) throw AppError.notFound('Target academic period')

      const beginFn = this.sql.begin
        ? this.sql.begin.bind(this.sql)
        : async (
            cb: (sql: Sql) => Promise<{ previous: ClassEnrollment; current: ClassEnrollment }>,
          ) => cb(this.sql)
      return await beginFn(async (sql) => {
        const sourceRows = await sql<ClassEnrollment[]>`
          SELECT id, user_id, class_id, academic_period_id, status, created_at::text, updated_at::text
          FROM class_enrollments
          WHERE user_id = ${params.userId} AND academic_period_id = ${params.fromAcademicPeriodId}::uuid AND status = 'active'
          LIMIT 1
        `
        if (!sourceRows || sourceRows.length === 0) {
          throw AppError.notFound('Active class enrollment in source academic period')
        }

        const existingTarget = await sql<ClassEnrollment[]>`
          SELECT id FROM class_enrollments
          WHERE user_id = ${params.userId} AND academic_period_id = ${params.toAcademicPeriodId}::uuid AND status = 'active'
          LIMIT 1
        `
        if (existingTarget && existingTarget.length > 0) {
          throw AppError.conflict(
            'Student already has an active class enrollment in target academic period.',
          )
        }

        const updatedSourceRows = await sql<ClassEnrollment[]>`
          UPDATE class_enrollments
          SET status = 'promoted', updated_at = NOW()
          WHERE id = ${sourceRows[0].id}
          RETURNING id, user_id, class_id, academic_period_id, status, created_at::text, updated_at::text
        `

        const newRows = await sql<ClassEnrollment[]>`
          INSERT INTO class_enrollments (user_id, class_id, academic_period_id, status)
          VALUES (${params.userId}, ${params.toClassId}::uuid, ${params.toAcademicPeriodId}::uuid, 'active')
          RETURNING id, user_id, class_id, academic_period_id, status, created_at::text, updated_at::text
        `

        await sql`
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
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to promote student enrollment')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async exitStudentEnrollment(params: ExitStudentEnrollmentParams): Promise<ClassEnrollment> {
    try {
      const status = params.status ?? 'archived'
      const rows = await this.sql<ClassEnrollment[]>`
        UPDATE class_enrollments
        SET status = ${status}, updated_at = NOW()
        WHERE user_id = ${params.userId} AND academic_period_id = ${params.academicPeriodId}::uuid AND status = 'active'
        RETURNING id, user_id, class_id, academic_period_id, status, created_at::text, updated_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.notFound('Active class enrollment')
      }
      return rows[0]
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to exit student enrollment')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getStudentEnrollmentHistory(userId: string): Promise<ClassEnrollment[]> {
    return this.listClassEnrollments({ userId })
  }

  async listSchedules(filter?: {
    classId?: string
    academicPeriodId?: string
    dayOfWeek?: string
    isActive?: boolean
  }): Promise<Schedule[]> {
    try {
      const rows = await this.sql<Schedule[]>`
        SELECT id, school_id, class_id, academic_period_id, location_id,
               day_of_week, day_of_week AS hari, start_time::text AS mulai_masuk, end_time::text AS selesai_masuk,
               start_checkout::text AS mulai_pulang, end_checkout::text AS selesai_pulang,
               grace_period_minutes AS kompensasi_waktu, is_active,
               created_at::text, updated_at::text
        FROM schedules
        WHERE (${filter?.classId ?? null}::uuid IS NULL OR class_id = ${filter?.classId ?? null}::uuid)
          AND (${filter?.academicPeriodId ?? null}::uuid IS NULL OR academic_period_id = ${filter?.academicPeriodId ?? null}::uuid)
          AND (${filter?.dayOfWeek?.toLowerCase() ?? null}::text IS NULL OR day_of_week = ${filter?.dayOfWeek?.toLowerCase() ?? null})
          AND (${filter?.isActive ?? null}::boolean IS NULL OR is_active = ${filter?.isActive ?? null})
        ORDER BY day_of_week ASC, start_time ASC
      `
      return rows ?? []
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, filter }, 'Failed to list schedules')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getScheduleById(id: string): Promise<Schedule | null> {
    try {
      const rows = await this.sql<Schedule[]>`
        SELECT id, school_id, class_id, academic_period_id, location_id,
               day_of_week, day_of_week AS hari, start_time::text AS mulai_masuk, end_time::text AS selesai_masuk,
               start_checkout::text AS mulai_pulang, end_checkout::text AS selesai_pulang,
               grace_period_minutes AS kompensasi_waktu, is_active,
               created_at::text, updated_at::text
        FROM schedules
        WHERE id = ${id}
        LIMIT 1
      `
      return rows[0] ?? null
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, id }, 'Failed to get schedule by id')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async createSchedule(params: CreateScheduleParams): Promise<Schedule> {
    try {
      let schoolId = params.schoolId
      if (!schoolId) {
        const school = await this.getSchool()
        schoolId = school?.id ?? null
      }
      const rows = await this.sql<Schedule[]>`
        INSERT INTO schedules (school_id, class_id, academic_period_id, location_id, day_of_week, start_time, end_time, start_checkout, end_checkout, grace_period_minutes, is_active)
        VALUES (${schoolId}, ${params.classId ?? null}, ${params.academicPeriodId ?? null}, ${params.locationId ?? null}, ${params.dayOfWeek.toLowerCase()}, ${params.startTime}::time, ${params.endTime}::time, ${params.startCheckout}::time, ${params.endCheckout}::time, ${params.gracePeriodMinutes ?? 0}, ${params.isActive ?? true})
        RETURNING id, school_id, class_id, academic_period_id, location_id, day_of_week, day_of_week AS hari, start_time::text AS mulai_masuk, end_time::text AS selesai_masuk, start_checkout::text AS mulai_pulang, end_checkout::text AS selesai_pulang, grace_period_minutes AS kompensasi_waktu, is_active, created_at::text, updated_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.internal('Failed to create schedule.')
      }
      return rows[0]
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to create schedule')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async updateSchedule(id: string, params: UpdateScheduleParams): Promise<Schedule> {
    try {
      const existing = await this.getScheduleById(id)
      if (!existing) throw AppError.notFound('Schedule')

      const rows = await this.sql<Schedule[]>`
        UPDATE schedules
        SET
          day_of_week = COALESCE(${params.dayOfWeek?.toLowerCase() ?? null}, day_of_week),
          start_time = COALESCE(${params.startTime ? `${params.startTime}::time` : null}, start_time),
          end_time = COALESCE(${params.endTime ? `${params.endTime}::time` : null}, end_time),
          start_checkout = COALESCE(${params.startCheckout ? `${params.startCheckout}::time` : null}, start_checkout),
          end_checkout = COALESCE(${params.endCheckout ? `${params.endCheckout}::time` : null}, end_checkout),
          grace_period_minutes = COALESCE(${params.gracePeriodMinutes ?? null}, grace_period_minutes),
          is_active = COALESCE(${params.isActive ?? null}, is_active),
          class_id = COALESCE(${params.classId ?? null}, class_id),
          academic_period_id = COALESCE(${params.academicPeriodId ?? null}, academic_period_id),
          location_id = COALESCE(${params.locationId ?? null}, location_id),
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING id, school_id, class_id, academic_period_id, location_id, day_of_week, day_of_week AS hari, start_time::text AS mulai_masuk, end_time::text AS selesai_masuk, start_checkout::text AS mulai_pulang, end_checkout::text AS selesai_pulang, grace_period_minutes AS kompensasi_waktu, is_active, created_at::text, updated_at::text
      `
      return rows[0]
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, id, params }, 'Failed to update schedule')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async deleteSchedule(id: string): Promise<void> {
    try {
      const result = await this.sql`DELETE FROM schedules WHERE id = ${id}`
      if (result.count === 0) throw AppError.notFound('Schedule')
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, id }, 'Failed to delete schedule')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async listLocations(filter?: { isActive?: boolean }): Promise<Location[]> {
    try {
      const rows = await this.sql<Location[]>`
        SELECT id, school_id, name, latitude, longitude, radius_meters, is_active, created_at::text, updated_at::text
        FROM locations
        WHERE (${filter?.isActive ?? null}::boolean IS NULL OR is_active = ${filter?.isActive ?? null})
        ORDER BY name ASC
      `
      return rows ?? []
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, filter }, 'Failed to list locations')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getLocationById(id: string): Promise<Location | null> {
    try {
      const rows = await this.sql<Location[]>`
        SELECT id, school_id, name, latitude, longitude, radius_meters, is_active, created_at::text, updated_at::text
        FROM locations
        WHERE id = ${id}
        LIMIT 1
      `
      return rows[0] ?? null
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, id }, 'Failed to get location by id')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async createLocation(params: CreateLocationParams): Promise<Location> {
    try {
      let schoolId = params.schoolId
      if (!schoolId) {
        const school = await this.getSchool()
        schoolId = school?.id ?? null
      }
      const rows = await this.sql<Location[]>`
        INSERT INTO locations (school_id, name, latitude, longitude, radius_meters, is_active)
        VALUES (${schoolId}, ${params.name}, ${params.latitude}, ${params.longitude}, ${params.radiusMeters ?? 100.0}, ${params.isActive ?? true})
        RETURNING id, school_id, name, latitude, longitude, radius_meters, is_active, created_at::text, updated_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.internal('Failed to create location.')
      }
      return rows[0]
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to create location')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async updateLocation(id: string, params: UpdateLocationParams): Promise<Location> {
    try {
      const existing = await this.getLocationById(id)
      if (!existing) throw AppError.notFound('Location')

      const rows = await this.sql<Location[]>`
        UPDATE locations
        SET
          name = COALESCE(${params.name ?? null}, name),
          latitude = COALESCE(${params.latitude ?? null}, latitude),
          longitude = COALESCE(${params.longitude ?? null}, longitude),
          radius_meters = COALESCE(${params.radiusMeters ?? null}, radius_meters),
          is_active = COALESCE(${params.isActive ?? null}, is_active),
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING id, school_id, name, latitude, longitude, radius_meters, is_active, created_at::text, updated_at::text
      `
      return rows[0]
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, id, params }, 'Failed to update location')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async deleteLocation(id: string): Promise<void> {
    try {
      const result = await this.sql`DELETE FROM locations WHERE id = ${id}`
      if (result.count === 0) throw AppError.notFound('Location')
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, id }, 'Failed to delete location')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async listCalendarExceptions(filter?: {
    academicPeriodId?: string
    startDate?: string
    endDate?: string
  }): Promise<CalendarException[]> {
    try {
      const rows = await this.sql<CalendarException[]>`
        SELECT id, school_id, academic_period_id, date::text, reason, is_holiday, created_at::text, updated_at::text
        FROM calendar_exceptions
        WHERE (${filter?.academicPeriodId ?? null}::uuid IS NULL OR academic_period_id = ${filter?.academicPeriodId ?? null}::uuid)
          AND (${filter?.startDate ?? null}::date IS NULL OR date >= ${filter?.startDate ?? null}::date)
          AND (${filter?.endDate ?? null}::date IS NULL OR date <= ${filter?.endDate ?? null}::date)
        ORDER BY date ASC
      `
      return rows ?? []
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, filter }, 'Failed to list calendar exceptions')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getCalendarExceptionById(id: string): Promise<CalendarException | null> {
    try {
      const rows = await this.sql<CalendarException[]>`
        SELECT id, school_id, academic_period_id, date::text, reason, is_holiday, created_at::text, updated_at::text
        FROM calendar_exceptions
        WHERE id = ${id}
        LIMIT 1
      `
      return rows[0] ?? null
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, id }, 'Failed to get calendar exception by id')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getCalendarExceptionByDate(
    date: string,
    academicPeriodId?: string,
  ): Promise<CalendarException | null> {
    try {
      const formattedDate = date.slice(0, 10)
      const rows = await this.sql<CalendarException[]>`
        SELECT id, school_id, academic_period_id, date::text, reason, is_holiday, created_at::text, updated_at::text
        FROM calendar_exceptions
        WHERE date = ${formattedDate}::date
          AND (${academicPeriodId ?? null}::uuid IS NULL OR academic_period_id IS NULL OR academic_period_id = ${academicPeriodId ?? null}::uuid)
        LIMIT 1
      `
      return rows[0] ?? null
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, date, academicPeriodId }, 'Failed to get calendar exception by date')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async createCalendarException(params: CreateCalendarExceptionParams): Promise<CalendarException> {
    try {
      let schoolId = params.schoolId
      if (!schoolId) {
        const school = await this.getSchool()
        schoolId = school?.id ?? null
      }
      const formattedDate = params.date.slice(0, 10)
      const rows = await this.sql<CalendarException[]>`
        INSERT INTO calendar_exceptions (school_id, academic_period_id, date, reason, is_holiday)
        VALUES (${schoolId}, ${params.academicPeriodId ?? null}, ${formattedDate}::date, ${params.reason}, ${params.isHoliday ?? true})
        RETURNING id, school_id, academic_period_id, date::text, reason, is_holiday, created_at::text, updated_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.internal('Failed to create calendar exception.')
      }
      return rows[0]
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to create calendar exception')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async updateCalendarException(
    id: string,
    params: UpdateCalendarExceptionParams,
  ): Promise<CalendarException> {
    try {
      const existing = await this.getCalendarExceptionById(id)
      if (!existing) throw AppError.notFound('Calendar exception')

      const formattedDate = params.date ? params.date.slice(0, 10) : null
      const rows = await this.sql<CalendarException[]>`
        UPDATE calendar_exceptions
        SET
          date = COALESCE(${formattedDate ? `${formattedDate}::date` : null}, date),
          reason = COALESCE(${params.reason ?? null}, reason),
          is_holiday = COALESCE(${params.isHoliday ?? null}, is_holiday),
          academic_period_id = COALESCE(${params.academicPeriodId ?? null}, academic_period_id),
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING id, school_id, academic_period_id, date::text, reason, is_holiday, created_at::text, updated_at::text
      `
      return rows[0]
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, id, params }, 'Failed to update calendar exception')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async deleteCalendarException(id: string): Promise<void> {
    try {
      const result = await this.sql`DELETE FROM calendar_exceptions WHERE id = ${id}`
      if (result.count === 0) throw AppError.notFound('Calendar exception')
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, id }, 'Failed to delete calendar exception')
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

  async getRoles(activeOnly = false): Promise<Role[]> {
    try {
      if (activeOnly) {
        const rows = await this.sql<Role[]>`
          SELECT r.id, r.name, r.description, r.is_active, r.created_at::text, r.updated_at::text,
                 COALESCE(ARRAY_AGG(p.name) FILTER (WHERE p.name IS NOT NULL), '{}') as permissions
          FROM roles r
          LEFT JOIN role_permissions rp ON r.id = rp.role_id
          LEFT JOIN permissions p ON rp.permission_id = p.id
          WHERE r.is_active = true
          GROUP BY r.id, r.name, r.description, r.is_active, r.created_at, r.updated_at
          ORDER BY r.name ASC
        `
        return rows ?? []
      }
      const rows = await this.sql<Role[]>`
        SELECT r.id, r.name, r.description, r.is_active, r.created_at::text, r.updated_at::text,
               COALESCE(ARRAY_AGG(p.name) FILTER (WHERE p.name IS NOT NULL), '{}') as permissions
        FROM roles r
        LEFT JOIN role_permissions rp ON r.id = rp.role_id
        LEFT JOIN permissions p ON rp.permission_id = p.id
        GROUP BY r.id, r.name, r.description, r.is_active, r.created_at, r.updated_at
        ORDER BY r.name ASC
      `
      return rows ?? []
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, activeOnly }, 'Failed to query roles')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getRoleById(id: string): Promise<Role | null> {
    try {
      const rows = await this.sql<Role[]>`
        SELECT r.id, r.name, r.description, r.is_active, r.created_at::text, r.updated_at::text,
               COALESCE(ARRAY_AGG(p.name) FILTER (WHERE p.name IS NOT NULL), '{}') as permissions
        FROM roles r
        LEFT JOIN role_permissions rp ON r.id = rp.role_id
        LEFT JOIN permissions p ON rp.permission_id = p.id
        WHERE r.id = ${id}
        GROUP BY r.id, r.name, r.description, r.is_active, r.created_at, r.updated_at
        LIMIT 1
      `
      return rows[0] ?? null
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, id }, 'Failed to query role by ID')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getRoleByName(name: string): Promise<Role | null> {
    try {
      const rows = await this.sql<Role[]>`
        SELECT r.id, r.name, r.description, r.is_active, r.created_at::text, r.updated_at::text,
               COALESCE(ARRAY_AGG(p.name) FILTER (WHERE p.name IS NOT NULL), '{}') as permissions
        FROM roles r
        LEFT JOIN role_permissions rp ON r.id = rp.role_id
        LEFT JOIN permissions p ON rp.permission_id = p.id
        WHERE LOWER(r.name) = LOWER(${name})
        GROUP BY r.id, r.name, r.description, r.is_active, r.created_at, r.updated_at
        LIMIT 1
      `
      return rows[0] ?? null
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, name }, 'Failed to query role by name')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async createRole(params: CreateRoleParams): Promise<Role> {
    try {
      const nameLower = params.name.toLowerCase()
      const existing = await this.getRoleByName(nameLower)
      if (existing) {
        throw AppError.conflict(`Role with name "${params.name}" already exists.`)
      }

      let createdRoleId: string | null = null
      await this.sql.begin(async (sql) => {
        const rows = await sql<{ id: string }[]>`
          INSERT INTO roles (name, description, is_active)
          VALUES (${nameLower}, ${params.description ?? null}, true)
          RETURNING id
        `
        if (!rows || rows.length === 0) {
          throw AppError.internal('Failed to insert role.')
        }
        createdRoleId = rows[0].id

        if (params.permissions && params.permissions.length > 0) {
          for (const permName of params.permissions) {
            const permRows = await sql<{ id: string }[]>`
              SELECT id FROM permissions WHERE LOWER(name) = LOWER(${permName}) LIMIT 1
            `
            if (permRows.length > 0) {
              await sql`
                INSERT INTO role_permissions (role_id, permission_id)
                VALUES (${createdRoleId}, ${permRows[0].id})
                ON CONFLICT DO NOTHING
              `
            }
          }
        }
      })

      if (!createdRoleId) {
        throw AppError.internal('Failed to create role.')
      }

      const roleWithPerms = await this.getRoleById(createdRoleId)
      if (!roleWithPerms) {
        throw AppError.internal('Failed to load created role.')
      }
      return roleWithPerms
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to create role')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async updateRole(id: string, params: UpdateRoleParams): Promise<Role> {
    try {
      const existing = await this.getRoleById(id)
      if (!existing) {
        throw AppError.notFound('Role')
      }

      if (params.name && params.name.toLowerCase() !== existing.name.toLowerCase()) {
        const nameExisting = await this.getRoleByName(params.name.toLowerCase())
        if (nameExisting && nameExisting.id !== id) {
          throw AppError.conflict(`Role with name "${params.name}" already exists.`)
        }
      }

      await this.sql.begin(async (sql) => {
        const nameLower = params.name ? params.name.toLowerCase() : existing.name
        const description =
          (params.description !== undefined ? params.description : existing.description) ?? null
        const isActive =
          params.isActive !== undefined ? params.isActive : (existing.is_active ?? true)

        await sql`
          UPDATE roles
          SET name = ${nameLower}, description = ${description}, is_active = ${isActive}, updated_at = NOW()
          WHERE id = ${id}
        `

        if (params.permissions !== undefined) {
          await sql`DELETE FROM role_permissions WHERE role_id = ${id}`
          for (const permName of params.permissions) {
            const permRows = await sql<{ id: string }[]>`
              SELECT id FROM permissions WHERE LOWER(name) = LOWER(${permName}) LIMIT 1
            `
            if (permRows.length > 0) {
              await sql`
                INSERT INTO role_permissions (role_id, permission_id)
                VALUES (${id}, ${permRows[0].id})
                ON CONFLICT DO NOTHING
              `
            }
          }
        }
      })

      const updated = await this.getRoleById(id)
      if (!updated) {
        throw AppError.internal('Failed to load updated role.')
      }
      return updated
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, id, params }, 'Failed to update role')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getPermissions(): Promise<Permission[]> {
    try {
      const rows = await this.sql<Permission[]>`
        SELECT id, name, description, created_at::text, updated_at::text
        FROM permissions
        ORDER BY name ASC
      `
      return rows ?? []
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err }, 'Failed to query permissions')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async createPermission(params: CreatePermissionParams): Promise<Permission> {
    try {
      const nameLower = params.name.toLowerCase()
      const rows = await this.sql<Permission[]>`
        INSERT INTO permissions (name, description)
        VALUES (${nameLower}, ${params.description ?? null})
        RETURNING id, name, description, created_at::text, updated_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.internal('Failed to create permission.')
      }
      return rows[0]
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to create permission')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getUserRoles(userId: string): Promise<string[]> {
    try {
      const rows = await this.sql<{ name: string }[]>`
        SELECT DISTINCT r.name
        FROM roles r
        JOIN user_roles ur ON r.id = ur.role_id
        WHERE ur.user_id = ${userId}
        UNION
        SELECT role as name
        FROM profiles
        WHERE user_id = ${userId} AND role IS NOT NULL
      `
      return rows.map((r) => r.name)
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId }, 'Failed to query user roles')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async assignUserRoles(userId: string, roleNames: string[]): Promise<void> {
    try {
      await this.sql.begin(async (sql) => {
        await sql`DELETE FROM user_roles WHERE user_id = ${userId}`
        for (const roleName of roleNames) {
          const roleRows = await sql<{ id: string }[]>`
            SELECT id FROM roles WHERE LOWER(name) = LOWER(${roleName}) LIMIT 1
          `
          if (roleRows.length > 0) {
            await sql`
              INSERT INTO user_roles (user_id, role_id)
              VALUES (${userId}, ${roleRows[0].id})
              ON CONFLICT DO NOTHING
            `
          }
        }
      })
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId, roleNames }, 'Failed to assign user roles')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getUserEffectivePermissions(userId: string): Promise<string[]> {
    try {
      const rows = await this.sql<{ name: string }[]>`
        SELECT DISTINCT p.name
        FROM permissions p
        JOIN role_permissions rp ON p.id = rp.permission_id
        JOIN roles r ON rp.role_id = r.id
        WHERE r.is_active = true
          AND (
            r.id IN (SELECT role_id FROM user_roles WHERE user_id = ${userId})
            OR LOWER(r.name) IN (SELECT LOWER(role) FROM profiles WHERE user_id = ${userId})
          )
        ORDER BY p.name ASC
      `
      return rows.map((r) => r.name)
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId }, 'Failed to query effective permissions')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async createStaffProfile(params: CreateStaffParams): Promise<UserProfile> {
    try {
      const emailLower = params.email.toLowerCase()
      const existingEmail = await this.sql<{ user_id: string }[]>`
        SELECT user_id FROM profiles WHERE LOWER(email) = ${emailLower} LIMIT 1
      `
      if (existingEmail.length > 0) {
        throw AppError.conflict(`Email "${params.email}" is already registered.`)
      }

      const userId = params.userId ?? `staff-${Date.now()}`
      let profile: UserProfile | null = null

      await this.sql.begin(async (sql) => {
        const rows = await sql<UserProfile[]>`
          INSERT INTO profiles (user_id, full_name, email, role, lifecycle_status, gender)
          VALUES (${userId}, ${params.fullName}, ${params.email}, ${params.role}, 'approved', ${params.gender ?? null})
          RETURNING user_id, full_name, email, nis, class_name, absence_number, avatar_url, role, lifecycle_status, gender
        `
        if (!rows || rows.length === 0) {
          throw AppError.internal('Failed to create staff profile.')
        }
        profile = rows[0]

        const allRoles = new Set<string>([params.role])
        if (params.roles) {
          for (const r of params.roles) allRoles.add(r)
        }
        for (const roleName of allRoles) {
          const roleRows = await sql<{ id: string }[]>`
            SELECT id FROM roles WHERE LOWER(name) = LOWER(${roleName}) LIMIT 1
          `
          if (roleRows.length > 0) {
            await sql`
              INSERT INTO user_roles (user_id, role_id)
              VALUES (${userId}, ${roleRows[0].id})
              ON CONFLICT DO NOTHING
            `
          }
        }
      })

      if (!profile) {
        throw AppError.internal('Failed to create staff profile.')
      }
      return profile
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to create staff profile')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getStaffProfiles(): Promise<UserProfile[]> {
    try {
      const rows = await this.sql<UserProfile[]>`
        SELECT user_id, full_name, email, nis, class_name, absence_number, avatar_url, role, lifecycle_status, gender
        FROM profiles
        WHERE role != 'student'
        ORDER BY created_at DESC
      `
      return rows ?? []
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err }, 'Failed to query staff profiles')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getStaffProfile(userId: string): Promise<UserProfile | null> {
    try {
      const rows = await this.sql<UserProfile[]>`
        SELECT user_id, full_name, email, nis, class_name, absence_number, avatar_url, role, lifecycle_status, gender
        FROM profiles
        WHERE user_id = ${userId} AND role != 'student'
        LIMIT 1
      `
      return rows[0] ?? null
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId }, 'Failed to query staff profile')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async updateStaffProfile(userId: string, updates: UpdateStaffParams): Promise<UserProfile> {
    try {
      const existing = await this.getUserProfile(userId)
      if (!existing) {
        throw AppError.notFound('Staff profile')
      }

      await this.sql.begin(async (sql) => {
        const fullName =
          (updates.fullName !== undefined ? updates.fullName : existing.full_name) ?? null
        const gender = (updates.gender !== undefined ? updates.gender : existing.gender) ?? null
        const role = (updates.role !== undefined ? updates.role : existing.role) ?? 'student'
        const lifecycleStatus =
          (updates.lifecycleStatus !== undefined
            ? updates.lifecycleStatus
            : existing.lifecycle_status) ?? 'approved'

        await sql`
          UPDATE profiles
          SET full_name = ${fullName}, gender = ${gender}, role = ${role}, lifecycle_status = ${lifecycleStatus}, updated_at = NOW()
          WHERE user_id = ${userId}
        `

        if (updates.roles !== undefined || updates.role !== undefined) {
          const allRoles = new Set<string>()
          if (updates.role) allRoles.add(updates.role)
          if (updates.roles) {
            for (const r of updates.roles) allRoles.add(r)
          }
          await sql`DELETE FROM user_roles WHERE user_id = ${userId}`
          for (const roleName of allRoles) {
            const roleRows = await sql<{ id: string }[]>`
              SELECT id FROM roles WHERE LOWER(name) = LOWER(${roleName}) LIMIT 1
            `
            if (roleRows.length > 0) {
              await sql`
                INSERT INTO user_roles (user_id, role_id)
                VALUES (${userId}, ${roleRows[0].id})
                ON CONFLICT DO NOTHING
              `
            }
          }
        }

        if (
          updates.lifecycleStatus === 'disabled' ||
          updates.lifecycleStatus === 'rejected' ||
          (updates.role && updates.role !== existing.role)
        ) {
          await sql`
            INSERT INTO revoked_sessions (user_id)
            VALUES (${userId})
          `
        }
      })

      return this.getUserProfile(userId)
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId, updates }, 'Failed to update staff profile')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async revokeUserSessions(userId: string): Promise<void> {
    try {
      await this.sql`
        INSERT INTO revoked_sessions (user_id)
        VALUES (${userId})
      `
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId }, 'Failed to revoke user sessions')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async isSessionRevoked(userId: string): Promise<boolean> {
    try {
      const rows = await this.sql<{ count: string }[]>`
        SELECT COUNT(*) as count FROM revoked_sessions WHERE user_id = ${userId}
      `
      return Number(rows[0]?.count ?? 0) > 0
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId }, 'Failed to check session revocation')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getRosterStudentByNis(nis: string): Promise<RosterStudent | null> {
    try {
      const reports = await this.sql<RosterReport[]>`
        SELECT rows FROM roster_reports WHERE status = 'accepted' ORDER BY accepted_at DESC
      `
      for (const report of reports) {
        const rows = Array.isArray(report.rows) ? report.rows : []
        const row = rows.find((candidate) => candidate.nis === nis)
        if (row) {
          return {
            nis: row.nis,
            full_name: row.full_name,
            class_name: row.class_name,
            grade: row.grade,
          }
        }
      }

      const profileRows = await this.sql<UserProfile[]>`
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
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, nis }, 'Failed to query roster student by NIS')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async listStudentProfiles(filter?: {
    lifecycle_status?: ProfileLifecycleStatus
  }): Promise<UserProfile[]> {
    try {
      const rows = filter?.lifecycle_status
        ? await this.sql<UserProfile[]>`
            SELECT user_id, full_name, email, nis, class_name, absence_number, avatar_url, role, lifecycle_status, gender
            FROM profiles
            WHERE role = 'student' AND lifecycle_status = ${filter.lifecycle_status}
            ORDER BY created_at DESC
          `
        : await this.sql<UserProfile[]>`
            SELECT user_id, full_name, email, nis, class_name, absence_number, avatar_url, role, lifecycle_status, gender
            FROM profiles
            WHERE role = 'student'
            ORDER BY created_at DESC
          `
      return rows ?? []
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, filter }, 'Failed to list student profiles')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async createPendingStudentProfile(params: {
    userId: string
    nis: string
    email: string
    fullName: string
    className: string
  }): Promise<UserProfile> {
    try {
      const rows = await this.sql<UserProfile[]>`
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
      logger.error({ err, params }, 'Failed to create pending student profile')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async updateProfileLifecycle(
    userId: string,
    status: ProfileLifecycleStatus,
  ): Promise<UserProfile> {
    try {
      const rows = await this.sql<UserProfile[]>`
        UPDATE profiles
        SET lifecycle_status = ${status}, updated_at = NOW()
        WHERE user_id = ${userId}
        RETURNING user_id, full_name, email, nis, class_name, absence_number, avatar_url, role, lifecycle_status, gender
      `
      if (!rows || rows.length === 0) {
        throw AppError.notFound('User profile')
      }
      return rows[0]
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId, status }, 'Failed to update profile lifecycle status')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async updateProfileEmail(userId: string, email: string): Promise<UserProfile> {
    try {
      const rows = await this.sql<UserProfile[]>`
        UPDATE profiles
        SET email = ${email}, updated_at = NOW()
        WHERE user_id = ${userId}
        RETURNING user_id, full_name, email, nis, class_name, absence_number, avatar_url, role, lifecycle_status, gender
      `
      if (!rows || rows.length === 0) {
        throw AppError.notFound('User profile')
      }
      return rows[0]
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId, email }, 'Failed to update profile email')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async createPasswordResetCode(params: CreatePasswordResetCodeParams): Promise<PasswordResetCode> {
    try {
      const rows = await this.sql<PasswordResetCode[]>`
        INSERT INTO password_reset_codes (user_id, code, expires_at, created_by)
        VALUES (${params.userId}, ${params.code}, ${params.expiresAt}, ${params.createdBy ?? null})
        RETURNING id, user_id, code, expires_at::text, used, used_at::text, created_by, created_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.internal('Failed to create password reset code.')
      }
      return rows[0]
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to create password reset code')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getActivePasswordResetCode(
    userId: string,
    code: string,
  ): Promise<PasswordResetCode | null> {
    try {
      const rows = await this.sql<PasswordResetCode[]>`
        SELECT id, user_id, code, expires_at::text, used, used_at::text, created_by, created_at::text
        FROM password_reset_codes
        WHERE user_id = ${userId} AND code = ${code} AND used = false AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
      `
      return rows[0] ?? null
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId, code }, 'Failed to query active reset code')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async markPasswordResetCodeUsed(codeId: string): Promise<void> {
    try {
      await this.sql`
        UPDATE password_reset_codes
        SET used = true, used_at = NOW()
        WHERE id = ${codeId}
      `
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, codeId }, 'Failed to mark password reset code as used')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  // ---------------------------------------------------------------------------
  // File records & metadata
  // ---------------------------------------------------------------------------

  async createFileRecord(params: CreateFileRecordParams): Promise<FileRecord> {
    try {
      const rows = await this.sql<FileRecord[]>`
        INSERT INTO files (user_id, purpose, object_path, content_type, size_bytes, lifecycle)
        VALUES (
          ${params.userId},
          ${params.purpose},
          ${params.objectPath},
          ${params.contentType},
          ${params.sizeBytes ?? null},
          ${params.lifecycle ?? 'available'}
        )
        RETURNING id, user_id, purpose, object_path, content_type, size_bytes, lifecycle, created_at::text, updated_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.internal('Failed to create file record.')
      }
      return rows[0]
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to create file record')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getFileRecord(id: string): Promise<FileRecord | null> {
    try {
      const rows = await this.sql<FileRecord[]>`
        SELECT id, user_id, purpose, object_path, content_type, size_bytes, lifecycle, created_at::text, updated_at::text
        FROM files
        WHERE id = ${id}
        LIMIT 1
      `
      return rows[0] ?? null
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, id }, 'Failed to get file record')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async listFiles(filter?: {
    userId?: string
    purpose?: FilePurpose
    lifecycle?: FileLifecycle
  }): Promise<FileRecord[]> {
    try {
      const rows = await this.sql<FileRecord[]>`
        SELECT id, user_id, purpose, object_path, content_type, size_bytes, lifecycle, created_at::text, updated_at::text
        FROM files
        WHERE (${filter?.userId ?? null}::text IS NULL OR user_id = ${filter?.userId ?? null})
          AND (${filter?.purpose ?? null}::text IS NULL OR purpose = ${filter?.purpose ?? null})
          AND (${filter?.lifecycle ?? null}::text IS NULL OR lifecycle = ${filter?.lifecycle ?? null})
        ORDER BY created_at DESC
      `
      return rows
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, filter }, 'Failed to list file records')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async updateFileLifecycle(id: string, lifecycle: FileLifecycle): Promise<FileRecord> {
    try {
      const rows = await this.sql<FileRecord[]>`
        UPDATE files
        SET lifecycle = ${lifecycle}, updated_at = NOW()
        WHERE id = ${id}
        RETURNING id, user_id, purpose, object_path, content_type, size_bytes, lifecycle, created_at::text, updated_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.notFound('File record')
      }
      return rows[0]
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, id, lifecycle }, 'Failed to update file lifecycle')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async deleteFileRecord(id: string): Promise<void> {
    try {
      await this.sql`
        UPDATE files
        SET lifecycle = 'deleted', updated_at = NOW()
        WHERE id = ${id}
      `
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, id }, 'Failed to delete file record')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async deleteFaceEnrollmentFiles(userId: string): Promise<number> {
    try {
      const result = await this.sql`
        UPDATE files
        SET lifecycle = 'deleted', updated_at = NOW()
        WHERE user_id = ${userId} AND purpose = 'face_enrollment' AND lifecycle != 'deleted'
      `
      return result.count ?? 0
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId }, 'Failed to delete face enrollment files')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  // ---------------------------------------------------------------------------
  // Face enrollment lifecycle
  // ---------------------------------------------------------------------------

  async getFaceEnrollment(userId: string): Promise<FaceEnrollmentRecord | null> {
    try {
      const rows = await this.sql<FaceEnrollmentRecord[]>`
        SELECT id, user_id, status, sample_count, created_at::text, updated_at::text
        FROM face_enrollments
        WHERE user_id = ${userId}
        LIMIT 1
      `
      return rows[0] ?? null
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId }, 'Failed to get face enrollment')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async saveFaceEnrollment(params: SaveFaceEnrollmentParams): Promise<FaceEnrollmentRecord> {
    try {
      const rows = await this.sql<FaceEnrollmentRecord[]>`
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
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to save face enrollment')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async deleteFaceEnrollment(userId: string): Promise<void> {
    try {
      await this.sql`
        UPDATE face_enrollments
        SET status = 'not_enrolled', sample_count = 0, updated_at = NOW()
        WHERE user_id = ${userId}
      `
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId }, 'Failed to delete face enrollment')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  // ---------------------------------------------------------------------------
  // Notification Outbox domain methods
  // ---------------------------------------------------------------------------

  async enqueueNotification(params: EnqueueNotificationParams): Promise<NotificationRecord> {
    try {
      const payloadJson = JSON.stringify(params.payload ?? {})
      const nextRetryAtVal = params.nextRetryAt ? new Date(params.nextRetryAt).toISOString() : null
      const rows = await this.sql`
        INSERT INTO notification_outbox (
          user_id,
          channel,
          payload,
          status,
          retry_count,
          next_retry_at
        )
        VALUES (
          ${params.userId},
          ${params.channel},
          ${payloadJson}::jsonb,
          ${params.status ?? 'pending'},
          0,
          ${nextRetryAtVal ? this.sql`${nextRetryAtVal}::timestamptz` : null}
        )
        RETURNING
          id,
          user_id,
          channel,
          payload,
          status,
          retry_count,
          next_retry_at::text,
          error_message,
          created_at::text,
          updated_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.internal('Failed to enqueue notification.')
      }
      return this.mapNotificationRow(rows[0])
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to enqueue notification')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async getNotificationById(id: string): Promise<NotificationRecord | null> {
    try {
      const rows = await this.sql`
        SELECT
          id,
          user_id,
          channel,
          payload,
          status,
          retry_count,
          next_retry_at::text,
          error_message,
          created_at::text,
          updated_at::text
        FROM notification_outbox
        WHERE id = ${id}
        LIMIT 1
      `
      if (!rows || rows.length === 0) return null
      return this.mapNotificationRow(rows[0])
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, id }, 'Failed to get notification by id')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async listNotifications(filter?: ListNotificationsFilter): Promise<NotificationRecord[]> {
    try {
      const conditions: any[] = []
      if (filter?.userId) {
        conditions.push(this.sql`user_id = ${filter.userId}`)
      }
      if (filter?.channel) {
        conditions.push(this.sql`channel = ${filter.channel}`)
      }
      if (filter?.status) {
        conditions.push(this.sql`status = ${filter.status}`)
      }

      const whereClause =
        conditions.length > 0
          ? this.sql`WHERE ${conditions.reduce((acc, curr) => this.sql`${acc} AND ${curr}`)}`
          : this.sql``

      const limit = filter?.limit ?? 50
      const offset = filter?.offset ?? 0

      const rows = await this.sql`
        SELECT
          id,
          user_id,
          channel,
          payload,
          status,
          retry_count,
          next_retry_at::text,
          error_message,
          created_at::text,
          updated_at::text
        FROM notification_outbox
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `
      return rows.map((r) => this.mapNotificationRow(r))
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, filter }, 'Failed to list notifications')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async claimPendingNotifications(
    params?: ClaimPendingNotificationsParams,
  ): Promise<NotificationRecord[]> {
    const limit = params?.limit ?? 10
    const maxRetries = params?.maxRetries ?? 3
    const nowIso = params?.now ? new Date(params.now).toISOString() : new Date().toISOString()

    try {
      const rows = await this.sql`
        WITH claimable AS (
          SELECT id
          FROM notification_outbox
          WHERE status = 'pending'
            AND (next_retry_at IS NULL OR next_retry_at <= ${nowIso}::timestamptz)
            AND retry_count < ${maxRetries}
          ORDER BY created_at ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE notification_outbox
        SET status = 'processing', updated_at = NOW()
        FROM claimable
        WHERE notification_outbox.id = claimable.id
        RETURNING
          notification_outbox.id,
          notification_outbox.user_id,
          notification_outbox.channel,
          notification_outbox.payload,
          notification_outbox.status,
          notification_outbox.retry_count,
          notification_outbox.next_retry_at::text,
          notification_outbox.error_message,
          notification_outbox.created_at::text,
          notification_outbox.updated_at::text
      `
      return rows.map((r) => this.mapNotificationRow(r))
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to claim pending notifications')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async updateNotificationStatus(
    params: UpdateNotificationStatusParams,
  ): Promise<NotificationRecord> {
    try {
      const nextRetryAtVal = params.nextRetryAt ? new Date(params.nextRetryAt).toISOString() : null
      const rows = await this.sql`
        UPDATE notification_outbox
        SET
          status = ${params.status},
          error_message = ${params.errorMessage !== undefined ? params.errorMessage : null},
          retry_count = ${params.retryCount !== undefined ? params.retryCount : this.sql`retry_count`},
          next_retry_at = ${params.nextRetryAt !== undefined ? (nextRetryAtVal ? this.sql`${nextRetryAtVal}::timestamptz` : null) : this.sql`next_retry_at`},
          updated_at = NOW()
        WHERE id = ${params.id}
        RETURNING
          id,
          user_id,
          channel,
          payload,
          status,
          retry_count,
          next_retry_at::text,
          error_message,
          created_at::text,
          updated_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.notFound('Notification')
      }
      return this.mapNotificationRow(rows[0])
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, params }, 'Failed to update notification status')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  async deleteNotification(id: string): Promise<void> {
    try {
      await this.sql`DELETE FROM notification_outbox WHERE id = ${id}`
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, id }, 'Failed to delete notification')
      throw AppError.internal('An unexpected database error occurred.')
    }
  }

  private mapNotificationRow(row: any): NotificationRecord {
    // SAFETY: payload is stored as JSONB and returned as object
    const payload = (row.payload ?? {}) as NotificationPayload
    return {
      id: row.id,
      user_id: row.user_id,
      // SAFETY: channel is validated by table check constraint
      channel: row.channel as NotificationChannel,
      payload,
      // SAFETY: status is validated by table check constraint
      status: row.status as NotificationStatus,
      retry_count: Number(row.retry_count ?? 0),
      next_retry_at: row.next_retry_at ? new Date(row.next_retry_at).toISOString() : null,
      error_message: row.error_message ?? null,
      created_at: row.created_at
        ? new Date(row.created_at).toISOString()
        : new Date().toISOString(),
      updated_at: row.updated_at
        ? new Date(row.updated_at).toISOString()
        : new Date().toISOString(),
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
