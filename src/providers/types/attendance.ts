import { z } from 'zod'
import type { AuditLogDetails } from './common.js'
import type { EnqueueNotificationParams } from './files-notifications.js'

export interface Absence {
  status: 'Hadir' | 'Terlambat' | 'Pulang' | 'Alpha' | 'Datang'
  created_at: string
  date?: string
  user_id?: string
  action_type?: string | null
}

export interface Schedule {
  id?: string
  school_id?: string | null
  class_id?: string | null
  academic_period_id?: string | null
  location_id?: string | null
  day_of_week?: string
  hari: string
  mulai_masuk: string | null
  selesai_masuk: string | null
  mulai_pulang: string | null
  selesai_pulang: string | null
  kompensasi_waktu: number | null
  is_active: boolean
  created_at?: string
  updated_at?: string
}

export interface Location {
  id: string
  school_id?: string | null
  name: string
  latitude: number
  longitude: number
  radius_meters: number
  is_active: boolean
  created_at?: string
  updated_at?: string
}

export interface CreateLocationParams {
  name: string
  latitude: number
  longitude: number
  radiusMeters?: number
  isActive?: boolean
  schoolId?: string | null
}

export interface UpdateLocationParams {
  name?: string
  latitude?: number
  longitude?: number
  radiusMeters?: number
  isActive?: boolean
}

export interface CreateScheduleParams {
  dayOfWeek: string
  startTime: string
  endTime: string
  startCheckout: string
  endCheckout: string
  gracePeriodMinutes?: number
  isActive?: boolean
  schoolId?: string | null
  classId?: string | null
  academicPeriodId?: string | null
  locationId?: string | null
}

export interface UpdateScheduleParams {
  dayOfWeek?: string
  startTime?: string
  endTime?: string
  startCheckout?: string
  endCheckout?: string
  gracePeriodMinutes?: number
  isActive?: boolean
  classId?: string | null
  academicPeriodId?: string | null
  locationId?: string | null
}

export interface CalendarException {
  id: string
  school_id?: string | null
  academic_period_id?: string | null
  date: string
  reason: string
  is_holiday: boolean
  created_at?: string
  updated_at?: string
}

export interface CreateCalendarExceptionParams {
  date: string
  reason: string
  isHoliday?: boolean
  academicPeriodId?: string | null
  schoolId?: string | null
}

export interface UpdateCalendarExceptionParams {
  date?: string
  reason?: string
  isHoliday?: boolean
  academicPeriodId?: string | null
}

export const attendanceStatusSchema = z.enum(['Hadir', 'Terlambat', 'Pulang', 'Alpha'])
export type AttendanceStatus = z.infer<typeof attendanceStatusSchema>

export const attendanceActionTypeSchema = z.enum(['check_in', 'check_out'])
export type AttendanceActionType = z.infer<typeof attendanceActionTypeSchema>

export const attendanceAttemptStatusSchema = z.enum(['success', 'failed', 'error'])
export type AttendanceAttemptStatus = z.infer<typeof attendanceAttemptStatusSchema>

export interface AttendanceRecord {
  id: string
  user_id: string
  date: string
  status: AttendanceStatus
  action_type: AttendanceActionType | null
  latitude?: number | null
  longitude?: number | null
  created_at: string
}

export function canRecordAttendanceAction(
  records: Array<{ status: string; action_type: AttendanceActionType | null }>,
  actionType: AttendanceActionType,
): boolean {
  const hasCheckedIn = records.some(
    (record) =>
      record.action_type === 'check_in' ||
      record.status === 'Hadir' ||
      record.status === 'Terlambat' ||
      record.status === 'Datang',
  )
  const hasCheckedOut = records.some(
    (record) => record.action_type === 'check_out' || record.status === 'Pulang',
  )

  return actionType === 'check_in' ? !hasCheckedIn : hasCheckedIn && !hasCheckedOut
}

/**
 * ADR-002: Deterministically maps historical attendance records with status 'Datang'
 * to canonical status 'Hadir' and action_type 'check_in'.
 */
export function normalizeAttendanceRecord<
  T extends { status: string; action_type?: AttendanceActionType | null },
>(record: T): T & { status: AttendanceStatus; action_type: AttendanceActionType | null } {
  const isDatang = record.status === 'Datang'
  // SAFETY: ADR-002 normalizes Datang to Hadir; all other valid status strings conform to AttendanceStatus
  return {
    ...record,
    status: (isDatang ? 'Hadir' : record.status) as AttendanceStatus,
    action_type: isDatang ? (record.action_type ?? 'check_in') : (record.action_type ?? null),
  }
}

export interface AttendanceAttempt {
  id: string
  user_id: string
  action_type: AttendanceActionType
  status: AttendanceAttemptStatus
  reason?: string | null
  quality_score?: number | null
  confidence?: number | null
  latitude?: number | null
  longitude?: number | null
  process_time_ms?: number | null
  created_at: string
}

export interface RecordAttendanceAttemptParams {
  userId: string
  actionType: AttendanceActionType
  status: AttendanceAttemptStatus
  reason?: string | null
  qualityScore?: number | null
  confidence?: number | null
  latitude?: number | null
  longitude?: number | null
  processTimeMs?: number | null
}

export interface CreateManualAttendanceParams {
  userId: string
  actionType: AttendanceActionType
  status?: AttendanceStatus
  reason: string
  date?: string
  latitude?: number | null
  longitude?: number | null
  attemptId?: string | null
  actorId: string
  auditDetails?: AuditLogDetails
  notification?: EnqueueNotificationParams
}

export interface AttendanceActionValidationResult {
  actionable: boolean
  action_type: 'check_in' | 'check_out' | 'none'
  message: string
  details?: {
    location_name?: string
    status?: 'Hadir' | 'Terlambat'
  } | null
}

/** @deprecated Alias for backwards compatibility */
export type AttendanceActionRpcResponse = AttendanceActionValidationResult

export interface SaveAttendanceRecordResult {
  success: boolean
  message?: string
  conflict?: boolean
}

/** @deprecated Alias for backwards compatibility */
export type SaveAttendanceRecordRpcResponse = SaveAttendanceRecordResult

export interface InsertAttendanceData {
  user_id: string
  date: string
  status: AttendanceStatus
  action_type?: AttendanceActionType | null
  latitude?: number | null
  longitude?: number | null
  created_at?: string
}
