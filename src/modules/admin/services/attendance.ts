import { AppError } from '../../../lib/errors/app-error.js'
import type {
  AppProviders,
  AttendanceActionType,
  AttendanceAttempt,
  AttendanceRecord,
  AttendanceStatus,
  IdentityRole,
  UserProfile,
} from '../../../providers/types.js'
import { toWibDate } from '../../../providers/types.js'
import { assertAdminAccess, assertChronosStaffAccess } from './shared.js'

export async function createManualAttendance(params: {
  userId: string
  actionType: AttendanceActionType
  status?: AttendanceStatus
  reason: string
  date?: string
  attemptId?: string | null
  latitude?: number | null
  longitude?: number | null
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<AttendanceRecord> {
  assertAdminAccess(params.actorRole)

  let student: UserProfile | null = null
  try {
    student = await params.providers.domainStore.getUserProfile(params.userId)
  } catch (err) {
    if (err instanceof AppError && err.code === 'RESOURCE_NOT_FOUND') {
      throw AppError.notFound('Student profile')
    }
    throw err
  }

  if (!student) {
    throw AppError.notFound('Student profile')
  }

  if (student.lifecycle_status !== 'approved') {
    throw AppError.conflict('Cannot record manual attendance for student who is not approved.')
  }

  if (!params.attemptId) {
    throw AppError.validationError('Attendance attempt is required for manual attendance.')
  }

  const relatedAttempt = await params.providers.domainStore.getAttendanceAttempt(params.attemptId)
  if (!relatedAttempt) {
    throw AppError.notFound('Referenced attendance attempt')
  }
  if (relatedAttempt.user_id !== params.userId) {
    throw AppError.validationError('Referenced attendance attempt does not belong to this student.')
  }
  if (relatedAttempt.action_type !== params.actionType) {
    throw AppError.validationError(
      'Referenced attendance attempt does not match the attendance action.',
    )
  }
  if (relatedAttempt.status !== 'failed' && relatedAttempt.status !== 'error') {
    throw AppError.validationError(
      'Only failed or errored attendance attempts can be used for manual attendance.',
    )
  }

  const attendanceDate = params.date ?? toWibDate(new Date().toISOString())
  const attemptTimestamp = Date.parse(relatedAttempt.created_at)
  if (
    !Number.isFinite(attemptTimestamp) ||
    toWibDate(relatedAttempt.created_at) !== attendanceDate
  ) {
    throw AppError.validationError(
      'Referenced attendance attempt must be from the same WIB date as the manual attendance.',
    )
  }

  return params.providers.domainStore.createManualAttendance({
    userId: params.userId,
    actionType: params.actionType,
    status: params.status,
    reason: params.reason,
    date: attendanceDate,
    latitude: params.latitude,
    longitude: params.longitude,
    attemptId: params.attemptId,
    actorId: params.actorId,
    auditDetails: {
      student_nis: student.nis ?? null,
      student_name: student.full_name ?? null,
      attempt_status: relatedAttempt.status,
      attempt_reason: relatedAttempt.reason ?? null,
      attempt_created_at: relatedAttempt.created_at,
    },
    notification: {
      userId: student.user_id,
      channel: 'push',
      eventKey: `manual_attendance:${student.user_id}:${attendanceDate}:${params.actionType}:${params.attemptId}`,
      payload: {
        title: 'Presensi Manual Dicatat',
        body: '',
        action_type: params.actionType,
        status: params.status ?? (params.actionType === 'check_in' ? 'Hadir' : 'Pulang'),
        date: attendanceDate,
        type: 'manual_attendance',
      },
    },
  })
}

export async function listAttendanceAttempts(params: {
  filter?: {
    userId?: string
    status?: 'success' | 'failed' | 'error'
    actionType?: 'check_in' | 'check_out'
    limit?: number
  }
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<AttendanceAttempt[]> {
  assertChronosStaffAccess(params.actorRole)
  return params.providers.domainStore.listAttendanceAttempts(params.filter)
}

export async function getAttendanceAttempt(params: {
  id: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<AttendanceAttempt> {
  assertChronosStaffAccess(params.actorRole)
  const attempt = await params.providers.domainStore.getAttendanceAttempt(params.id)
  if (!attempt) {
    throw AppError.notFound('Attendance attempt')
  }
  return attempt
}

export async function getAttendance(params: {
  id: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<AttendanceRecord> {
  assertChronosStaffAccess(params.actorRole)
  const attendance = await params.providers.domainStore.getAttendance(params.id)
  if (!attendance) {
    throw AppError.notFound('Attendance')
  }
  return attendance
}

export async function listAttendances(params: {
  filter?: {
    userId?: string
    date?: string
    startDate?: string
    endDate?: string
    status?: string
    actionType?: string
    limit?: number
    offset?: number
  }
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<AttendanceRecord[]> {
  assertChronosStaffAccess(params.actorRole)
  return params.providers.domainStore.listAttendances(params.filter)
}

export async function deleteAdminAttendances(params: {
  ids: string[]
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<{ deletedCount: number; deletedIds: string[] }> {
  assertAdminAccess(params.actorRole)

  const deleted = await params.providers.domainStore.deleteAttendances(params.ids)
  for (const attendance of deleted) {
    await params.providers.domainStore.insertAuditLog({
      actor_id: params.actorId,
      action: 'delete_attendance',
      entity_type: 'attendance',
      entity_id: attendance.id,
      details: {
        user_id: attendance.user_id,
        date: attendance.date,
        status: attendance.status,
        action_type: attendance.action_type,
        created_at: attendance.created_at,
      },
    })
  }

  return {
    deletedCount: deleted.length,
    deletedIds: deleted.map((attendance) => attendance.id),
  }
}
