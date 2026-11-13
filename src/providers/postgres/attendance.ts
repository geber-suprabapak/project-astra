import type { Sql } from 'postgres'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
import {
  canRecordAttendanceAction,
  type AttendanceActionRpcResponse,
  type AttendanceActionType,
  type AttendanceRecord,
  type AttendanceStatus,
  type CreateManualAttendanceParams,
  type RecordAttendanceAttemptParams,
  type SaveAttendanceRecordRpcResponse,
} from '../types.js'
import { insertNotificationOutboxRow } from './notifications-outbox.js'
import { getActiveSchedule } from './schedules-locations-calendar.js'
import {
  calculateDistanceMeters,
  findBlockingApprovedLeave,
  getDayKeyWIB,
  getTodayWIB,
  insertAuditLogRow,
  withPgError,
} from './shared.js'

export interface ValidateAttendanceActionParams {
  userId: string
  latitude: number
  longitude: number
}

export interface SaveAttendanceRecordParams {
  userId: string
  actionType: 'check_in' | 'check_out'
  latitude: number
  longitude: number
  successAttempt?: Omit<RecordAttendanceAttemptParams, 'userId' | 'actionType' | 'status'>
}

async function resolveCheckInStatus(
  sql: Sql,
  now: Date,
  todayWIB: string,
  dayKey: string,
): Promise<'Hadir' | 'Terlambat'> {
  const schedule = await getActiveSchedule(sql, dayKey)
  if (schedule?.selesai_masuk) {
    const [h = 0, m = 0, s = 0] = schedule.selesai_masuk.split(':').map(Number)
    const [year = 1970, month = 1, day = 1] = todayWIB.split('-').map(Number)
    const endUtc = new Date(Date.UTC(year, month - 1, day, h - 7, m, s, 0))
    if (now > endUtc) {
      return 'Terlambat'
    }
  }
  return 'Hadir'
}

export async function validateAttendanceAction(
  sql: Sql,
  params: ValidateAttendanceActionParams,
): Promise<AttendanceActionRpcResponse> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to validate attendance action'),
    async () => {
      // 1. Check geofence location
      const locations = await sql<
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

      const matchedLocation =
        locations.find(
          (loc) =>
            calculateDistanceMeters(
              params.latitude,
              params.longitude,
              loc.latitude,
              loc.longitude,
            ) <= loc.radius_meters,
        ) ?? null

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

      const attendances = await sql<{ status: string; action_type: string | null }[]>`
        SELECT status, action_type
        FROM attendances
        WHERE user_id = ${params.userId} AND date = ${todayWIB}
        ORDER BY created_at ASC
      `

      const hasCheckedIn = attendances.some(
        (r) =>
          r.status === 'Hadir' ||
          r.status === 'Terlambat' ||
          r.status === 'Datang' ||
          r.action_type === 'check_in',
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
      const statusLabel: 'Hadir' | 'Terlambat' =
        actionType === 'check_in' ? await resolveCheckInStatus(sql, now, todayWIB, dayKey) : 'Hadir'

      return {
        actionable: true,
        action_type: actionType,
        message: 'Validation successful.',
        details: {
          location_name: locationName,
          status: statusLabel,
        },
      }
    },
  )
}

export async function saveAttendanceRecord(
  sql: Sql,
  params: SaveAttendanceRecordParams,
): Promise<SaveAttendanceRecordRpcResponse> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to save attendance record'),
    async () => {
      const now = new Date()
      const todayWIB = getTodayWIB(now)
      const dayKey = getDayKeyWIB(now)

      const status: 'Hadir' | 'Terlambat' | 'Pulang' =
        params.actionType === 'check_in'
          ? await resolveCheckInStatus(sql, now, todayWIB, dayKey)
          : 'Pulang'

      return await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${params.userId}, 0))`
        const blocking = await findBlockingApprovedLeave(tx, params.userId, todayWIB)
        if (blocking) {
          throw AppError.attendanceBlocked('Attendance is blocked by an approved Leave Period.', {
            leave_request_id: blocking.id,
            date: todayWIB,
            effective_start_date: blocking.start_date,
            effective_end_date: blocking.effective_end_date,
          })
        }
        const current = await tx<
          Array<{ status: string; action_type: AttendanceActionType | null }>
        >`
          SELECT status, action_type
          FROM attendances
          WHERE user_id = ${params.userId} AND date = ${todayWIB}
          ORDER BY created_at ASC, id ASC
        `
        if (!canRecordAttendanceAction(current, params.actionType)) {
          return {
            success: false,
            conflict: true,
            message: 'Attendance action is already recorded or is not the next action.',
          }
        }
        await tx`
          INSERT INTO attendances (user_id, date, status, action_type, latitude, longitude, created_at)
          VALUES (${params.userId}, ${todayWIB}, ${status}, ${params.actionType}, ${params.latitude}, ${params.longitude}, ${now.toISOString()})
        `
        if (params.successAttempt) {
          const attempts = await tx<{ id: string }[]>`
            INSERT INTO attendance_attempts (
              user_id, action_type, status, reason, quality_score, confidence,
              latitude, longitude, process_time_ms
            )
            VALUES (
              ${params.userId}, ${params.actionType}, 'success', ${params.successAttempt.reason ?? null},
              ${params.successAttempt.qualityScore ?? null}, ${params.successAttempt.confidence ?? null},
              ${params.successAttempt.latitude ?? null}, ${params.successAttempt.longitude ?? null},
              ${params.successAttempt.processTimeMs ?? null}
            )
            RETURNING id
          `
          if (!attempts[0]) throw AppError.internal('Failed to record attendance attempt.')
        }
        return { success: true }
      })
    },
  )
}

export async function createManualAttendance(
  sql: Sql,
  params: CreateManualAttendanceParams,
): Promise<AttendanceRecord> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to create manual attendance record'),
    async () => {
      const now = new Date()
      const todayWIB = params.date ?? getTodayWIB(now)
      const dayKey = getDayKeyWIB(now)

      let status: AttendanceStatus =
        params.status ?? (params.actionType === 'check_in' ? 'Hadir' : 'Pulang')

      if (!params.status && params.actionType === 'check_in') {
        status = await resolveCheckInStatus(sql, now, todayWIB, dayKey)
      }

      return await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${params.userId}, 0))`
        const blocking = await findBlockingApprovedLeave(tx, params.userId, todayWIB)
        if (blocking) {
          throw AppError.attendanceBlocked('Attendance is blocked by an approved Leave Period.', {
            leave_request_id: blocking.id,
            date: todayWIB,
            effective_start_date: blocking.start_date,
            effective_end_date: blocking.effective_end_date,
          })
        }
        const current = await tx<
          Array<{ status: string; action_type: AttendanceActionType | null }>
        >`
          SELECT status, action_type
          FROM attendances
          WHERE user_id = ${params.userId} AND date = ${todayWIB}
          ORDER BY created_at ASC, id ASC
        `
        if (!canRecordAttendanceAction(current, params.actionType)) {
          throw AppError.conflict(
            'Attendance action is already recorded or is not the next action.',
          )
        }
        const rows = await tx<AttendanceRecord[]>`
          INSERT INTO attendances (user_id, date, status, action_type, latitude, longitude, created_at)
          VALUES (${params.userId}, ${todayWIB}, ${status}, ${params.actionType}, ${params.latitude ?? null}, ${params.longitude ?? null}, ${now.toISOString()})
          RETURNING id, user_id, date, status, action_type, latitude, longitude, created_at::text
        `
        const attendance = rows[0]
        if (!attendance) {
          throw AppError.internal('Failed to create manual attendance record.')
        }

        await insertAuditLogRow(
          tx,
          {
            actor_id: params.actorId,
            action: 'create_manual_attendance',
            entity_type: 'attendance',
            entity_id: attendance.id,
            details: {
              ...params.auditDetails,
              student_user_id: params.userId,
              action_type: params.actionType,
              status: attendance.status,
              date: attendance.date,
              reason: params.reason,
              attempt_id: params.attemptId ?? null,
            },
          },
          'Failed to record manual attendance audit.',
        )
        if (params.notification) {
          await insertNotificationOutboxRow(tx, {
            ...params.notification,
            payload: {
              ...params.notification.payload,
              status: attendance.status,
              date: attendance.date,
              body: params.notification.payload.body
                ? String(params.notification.payload.body)
                : `Presensi manual (${params.actionType}) berhasil dicatat. Status: ${attendance.status}.`,
            },
          })
        }
        return attendance
      })
    },
  )
}
