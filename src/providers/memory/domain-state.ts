import { AppError } from '../../lib/errors/app-error.js'
import type { CmsContentRow } from '../../modules/cms/content.js'
import type { CmsProfile } from '../../modules/cms/schema.js'
import {
  toWibDate,
  type Absence,
  type AcademicPeriod,
  type AdiwiyataEligibility,
  type AdiwiyataReport,
  type AdiwiyataSite,
  type AttendanceAttempt,
  type AttendanceRecord,
  type AuditLog,
  type AuditLogEntry,
  type CalendarException,
  type ClassEnrollment,
  type ClassEnrollmentStatus,
  type ClassRoom,
  type CreateStudentParams,
  type EnqueueNotificationParams,
  type FaceEnrollmentRecord,
  type FileRecord,
  type Location,
  type NotificationRecord,
  type PasswordResetCode,
  type Permission,
  type Permit,
  type Role,
  type RosterReport,
  type RosterStudent,
  type Schedule,
  type School,
  type Student,
  type StudentBinding,
  type UserProfile,
} from '../types.js'
import type { MemoryCmsState } from './cms-content.js'
import type { MemoryPklState } from './pkl-state.js'

export interface MemoryDomainState {
  cmsContent: Map<string, Map<string, CmsContentRow>>
  cmsContentAudit: MemoryCmsState['cmsContentAudit']
  pklRecords: MemoryPklState['pklRecords']
  pklAudit: MemoryPklState['pklAudit']
  cmsProfiles: Map<string, CmsProfile>
  profiles: Map<string, UserProfile>
  students: Map<string, Student>
  studentBindings: Map<string, StudentBinding>
  absences: Absence[]
  schedules: Map<string, Schedule>
  locations: Map<string, Location>
  calendarExceptions: Map<string, CalendarException>
  permits: Permit[]
  schools: School[]
  academicPeriods: AcademicPeriod[]
  classes: ClassRoom[]
  classEnrollments: ClassEnrollment[]
  adiwiyataEligibility: Map<string, AdiwiyataEligibility>
  adiwiyataSites: Map<string, AdiwiyataSite>
  adiwiyataReports: Map<string, AdiwiyataReport>
  rosterReports: Map<string, RosterReport>
  auditLogs: AuditLog[]
  roles: Map<string, Role>
  permissions: Map<string, Permission>
  userRoles: Map<string, Set<string>>
  revokedSessions: Map<string, number>
  resetCodes: PasswordResetCode[]
  files: Map<string, FileRecord>
  faceEnrollments: Map<string, FaceEnrollmentRecord>
  notifications: Map<string, NotificationRecord>
  attendanceAttempts: AttendanceAttempt[]
  attendancesList: AttendanceRecord[]
  signupOpen: boolean
  isHealthy: boolean

  insertAuditLog(entry: AuditLogEntry): Promise<AuditLog>
  enqueueNotification(params: EnqueueNotificationParams): Promise<NotificationRecord>
  createStudent(params: CreateStudentParams): Promise<Student>
  getStudentByNis(nis: string): Promise<Student | null>
  getRosterStudentByNis(nis: string): Promise<RosterStudent | null>
  revokeUserSessions(userId: string): Promise<void>
  listClassEnrollments(filter?: {
    userId?: string
    classId?: string
    academicPeriodId?: string
    status?: ClassEnrollmentStatus
  }): Promise<ClassEnrollment[]>
}

export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
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

export function addCalendarDays(date: string, days: number): string {
  return new Date(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

export function isPhysicalAttendance(status: string, actionType?: string | null): boolean {
  return (
    actionType === 'check_in' ||
    actionType === 'check_out' ||
    status === 'Hadir' ||
    status === 'Terlambat' ||
    status === 'Pulang' ||
    status === 'Datang'
  )
}

export function effectiveLeavePeriod(permit: Permit) {
  const start = toWibDate(permit.tanggal)
  return {
    start,
    end: toWibDate(permit.effective_end_date ?? permit.original_end_date ?? start),
  }
}

export function assertAttendanceAllowed(permits: Permit[], userId: string, date: string): void {
  const dateOnly = date.slice(0, 10)
  const blocking = permits.find((permit) => {
    if (permit.user_id !== userId || permit.approval_status !== 'approved') return false
    const period = effectiveLeavePeriod(permit)
    return dateOnly >= period.start && dateOnly <= period.end
  })
  if (!blocking) return
  const period = effectiveLeavePeriod(blocking)
  throw AppError.attendanceBlocked('Attendance is blocked by an approved Leave Period.', {
    leave_request_id: blocking.id,
    date: dateOnly,
    effective_start_date: period.start,
    effective_end_date: period.end,
  })
}

export function rollBackAuditLogs(
  auditLogs: AuditLog[],
  existingAuditIds: Set<string>,
  actorId: string,
  entityType: string,
  entityId: string,
  action?: string,
): void {
  for (let i = auditLogs.length - 1; i >= 0; i--) {
    const item = auditLogs[i]
    if (
      item &&
      !existingAuditIds.has(item.id) &&
      item.actor_id === actorId &&
      item.entity_type === entityType &&
      item.entity_id === entityId &&
      (action === undefined || item.action === action)
    ) {
      auditLogs.splice(i, 1)
    }
  }
}

export function rollBackNotifications(
  notifications: Map<string, NotificationRecord>,
  existingNotifIds: Set<string>,
): void {
  for (const id of notifications.keys()) {
    if (!existingNotifIds.has(id)) {
      notifications.delete(id)
    }
  }
}
