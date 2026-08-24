import { z } from 'zod'
import type { RobinClient } from '../clients/robin/client.js'

export const profileLifecycleStatusSchema = z.enum(['pending', 'approved', 'rejected', 'disabled'])
export type ProfileLifecycleStatus = z.infer<typeof profileLifecycleStatusSchema>

export const identityRoleSchema = z.enum([
  'platform_admin',
  'school_admin',
  'teacher',
  'student',
  'staff',
])
export type IdentityRole = z.infer<typeof identityRoleSchema>

export interface UserProfile {
  user_id: string
  full_name: string | null
  email?: string | null
  nis?: string | null
  class_name?: string | null
  absence_number?: string | null
  avatar_url?: string | null
  notification_token?: string | null
  role?: IdentityRole | null
  lifecycle_status: ProfileLifecycleStatus
  gender?: string | null
}

export interface IdentityUser {
  userId: string
  authSource?: 'logto' | 'legacy_supabase'
  legacyUserId?: string
  email?: string | null
  roles?: readonly IdentityRole[]
  scopes?: readonly string[]
  mfaVerified?: boolean
  mustChangePassword?: boolean
}

export interface CreateStudentIdentityParams {
  username: string
  email: string
  password?: string
  name?: string
  suspended?: boolean
  roles?: readonly IdentityRole[]
}

export interface IdentityProvider {
  verifyToken(token: string): Promise<IdentityUser>
  verifyLegacyToken?(token: string): Promise<IdentityUser>
  verifyPassword(email: string, password: string): Promise<void>
  updatePassword(userId: string, newPassword: string): Promise<void>
  updateUserMetadata(userId: string, metadata: UserMetadata): Promise<void>
  createStudentIdentity?(params: CreateStudentIdentityParams): Promise<{ userId: string }>
  setUserSuspended?(userId: string, suspended: boolean): Promise<void>
  assignUserRole?(userId: string, role: IdentityRole): Promise<void>
  revokeUserRole?(userId: string, role: IdentityRole): Promise<void>
  revokeUserSessions?(userId: string): Promise<void>
  updateUserEmail?(userId: string, email: string): Promise<void>
  checkHealth(): Promise<boolean>
  createStaffIdentity?(params: {
    email: string
    fullName: string
    role: string
    password?: string
  }): Promise<{ userId: string; email: string }>
  requestPasswordResetEmail?(email: string): Promise<void>
  assignRoles?(userId: string, roles: string[]): Promise<void>
}

export interface AppProviders {
  domainStore: DomainStore
  objectStorage: ObjectStorage
  identityProvider: IdentityProvider
  robinClient: RobinClient
}

export interface Absence {
  status: 'Hadir' | 'Terlambat' | 'Pulang' | 'Alpha'
  created_at: string
  date?: string
  user_id?: string
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

export interface Permit {
  id: string
  user_id: string
  kategori_izin: string
  deskripsi: string
  status: boolean
  link_foto: string | null
  tanggal: string
  approval_status: 'pending' | 'approved' | 'rejected'
  created_at?: string
  updated_at?: string
  rejection_reason?: string | null
  rejected_at?: string | null
}

export const leaveRequestCategorySchema = z.enum(['sakit', 'pergi', 'dispensasi', 'lainnya'])
export type LeaveRequestCategory = z.infer<typeof leaveRequestCategorySchema>

export const leaveRequestApprovalStatusSchema = z.enum(['pending', 'approved', 'rejected'])
export type LeaveRequestApprovalStatus = z.infer<typeof leaveRequestApprovalStatusSchema>

export interface LeaveRequest {
  id: string
  user_id: string
  category: LeaveRequestCategory | string
  description: string
  status: boolean
  attachment_url: string | null
  date: string
  approval_status: LeaveRequestApprovalStatus
  rejection_reason?: string | null
  rejected_at?: string | null
  created_at?: string
  updated_at?: string
  student_name?: string | null
  student_nis?: string | null
  student_class?: string | null
  absence_number?: string | null
}

export interface ListLeaveRequestsFilter {
  userId?: string
  approvalStatus?: LeaveRequestApprovalStatus
  category?: string
  startDate?: string
  endDate?: string
  limit?: number
  offset?: number
}

export interface UpdateLeaveRequestStatusParams {
  id: string
  approvalStatus: LeaveRequestApprovalStatus
  status?: boolean
  rejectionReason?: string | null
  rejectedAt?: string | null
}

export interface ActivePermitSummary {
  id: string
  approval_status: 'pending' | 'approved' | 'rejected'
  kategori_izin: string
}

export interface InsertPermitData {
  user_id: string
  kategori_izin: string
  deskripsi: string
  status: boolean
  link_foto: string | null
  tanggal: string
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
}

/** @deprecated Alias for backwards compatibility */
export type SaveAttendanceRecordRpcResponse = SaveAttendanceRecordResult

export interface School {
  id: string
  name: string
  slug: string
  timezone: string
  signup_open: boolean
  created_at?: string
  updated_at?: string
}

export interface CreateSchoolParams {
  name: string
  slug: string
  timezone?: string
}

export interface AcademicPeriod {
  id: string
  school_id: string
  name: string
  start_date: string
  end_date: string
  is_active: boolean
  created_at?: string
  updated_at?: string
}

export interface CreateAcademicPeriodParams {
  schoolId?: string
  name: string
  startDate: string
  endDate: string
  isActive?: boolean
}

export interface UpdateAcademicPeriodParams {
  name?: string
  startDate?: string
  endDate?: string
  isActive?: boolean
}

export interface ClassRoom {
  id: string
  school_id: string
  academic_period_id?: string | null
  name: string
  grade?: number | null
  created_at?: string
  updated_at?: string
}

export interface CreateClassParams {
  schoolId?: string
  academicPeriodId?: string | null
  name: string
  grade?: number | null
}

export interface UpdateClassParams {
  name?: string
  grade?: number | null
  academicPeriodId?: string | null
}

export const classEnrollmentStatusSchema = z.enum([
  'active',
  'transferred',
  'promoted',
  'graduated',
  'archived',
])
export type ClassEnrollmentStatus = z.infer<typeof classEnrollmentStatusSchema>

export interface ClassEnrollment {
  id: string
  user_id: string
  class_id: string
  academic_period_id: string
  status: ClassEnrollmentStatus
  created_at?: string
  updated_at?: string
  class_name?: string | null
  student_name?: string | null
  nis?: string | null
  period_name?: string | null
}

export interface EnrollStudentParams {
  userId: string
  classId: string
  academicPeriodId: string
}

export interface TransferStudentEnrollmentParams {
  userId: string
  fromClassId?: string
  toClassId: string
  academicPeriodId: string
  reason?: string
}

export interface PromoteStudentEnrollmentParams {
  userId: string
  fromAcademicPeriodId: string
  toAcademicPeriodId: string
  toClassId: string
  reason?: string
}

export interface ExitStudentEnrollmentParams {
  userId: string
  academicPeriodId: string
  status?: 'graduated' | 'archived'
  reason?: string
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

export interface RosterRowInput {
  nis: string
  full_name: string
  class_name: string
  grade?: number | null
}

export interface RejectedRosterRow {
  row_index: number
  nis?: string | null
  full_name?: string | null
  class_name?: string | null
  grade?: number | null
  reason: string
}

export type RosterReportStatus = 'staged' | 'accepted' | 'rejected'
export type RosterReviewState = 'pending' | 'accepted' | 'rejected'

export interface RosterReport {
  id: string
  school_id?: string | null
  total_rows: number
  valid_rows: number
  rejected_rows: number
  status: RosterReportStatus
  review_state: RosterReviewState
  rows: RosterRowInput[]
  rejected_items: RejectedRosterRow[]
  accepted_at?: string | null
  accepted_by?: string | null
  created_at?: string
  updated_at?: string
}

export interface StageRosterParams {
  schoolId?: string | null
  totalRows: number
  validRows: number
  rejectedRows: number
  status: RosterReportStatus
  reviewState: RosterReviewState
  rows: RosterRowInput[]
  rejectedItems: RejectedRosterRow[]
}

export interface BootstrapStatus {
  school_configured: boolean
  school: School | null
  school_admin_created: boolean
  active_academic_period: boolean
  latest_roster_report: RosterReport | null
  roster_accepted: boolean
  signup_open: boolean
}

export type AuditLogDetailValue = string | number | boolean | null | undefined | readonly string[]
export type AuditLogDetails = Record<string, AuditLogDetailValue>

export interface AuditLogEntry {
  actor_id?: string | null
  action: string
  entity_type: string
  entity_id?: string | null
  details?: AuditLogDetails | null
}

export interface AuditLog {
  id: string
  actor_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  details: AuditLogDetails | null
  created_at: string
}

export interface Role {
  id: string
  name: string
  description?: string | null
  is_active: boolean
  permissions?: string[]
  created_at?: string
  updated_at?: string
}

export interface Permission {
  id: string
  name: string
  description?: string | null
  created_at?: string
  updated_at?: string
}

export interface CreateRoleParams {
  name: string
  description?: string | null
  permissions?: string[]
}

export interface UpdateRoleParams {
  name?: string
  description?: string | null
  permissions?: string[]
  isActive?: boolean
}

export interface CreatePermissionParams {
  name: string
  description?: string | null
}

export interface CreateStaffParams {
  userId?: string
  fullName: string
  email: string
  role: string
  roles?: string[]
  gender?: string | null
}

export interface UpdateStaffParams {
  fullName?: string | null
  role?: string
  roles?: string[]
  lifecycleStatus?: ProfileLifecycleStatus
  gender?: string | null
}

export interface UserEffectivePermissions {
  userId: string
  roles: string[]
  permissions: string[]
}

export interface InsertAttendanceData {
  user_id: string
  date: string
  status: AttendanceStatus
  action_type?: AttendanceActionType | null
  latitude?: number | null
  longitude?: number | null
  created_at?: string
}

export interface DomainStore {
  getUserProfile(userId: string): Promise<UserProfile>
  resolveLegacyUserId?(legacyUserId: string): Promise<string | null>
  updateUserProfile(userId: string, updates: Partial<UserProfile>): Promise<void>
  getProfileByNis(nis: string): Promise<UserProfile | null>
  getTodayAbsences(userId: string, dateWIB: string): Promise<Absence[]>
  insertAttendance(data: InsertAttendanceData): Promise<Absence>
  getActiveSchedule(dayKey: string): Promise<Schedule | null>
  getActivePermitsToday(
    userId: string,
    startISO: string,
    endISO: string,
  ): Promise<ActivePermitSummary[]>
  getPermitHistory(userId: string): Promise<Permit[]>
  insertPermit(data: InsertPermitData): Promise<Permit>

  // Leave Requests domain methods
  getLeaveRequestById(id: string): Promise<LeaveRequest | null>
  listLeaveRequests(filter?: ListLeaveRequestsFilter): Promise<LeaveRequest[]>
  updateLeaveRequestStatus(params: UpdateLeaveRequestStatusParams): Promise<LeaveRequest>
  deleteLeaveRequest(id: string): Promise<void>
  validateAttendanceAction(params: {
    userId: string
    latitude: number
    longitude: number
  }): Promise<AttendanceActionRpcResponse>
  saveAttendanceRecord(params: {
    userId: string
    actionType: 'check_in' | 'check_out'
    latitude: number
    longitude: number
  }): Promise<SaveAttendanceRecordRpcResponse>

  // Attendance & Attempts domain methods
  recordAttendanceAttempt(params: RecordAttendanceAttemptParams): Promise<AttendanceAttempt>
  listAttendanceAttempts(filter?: {
    userId?: string
    status?: AttendanceAttemptStatus
    actionType?: AttendanceActionType
    limit?: number
  }): Promise<AttendanceAttempt[]>
  getAttendanceAttempt(id: string): Promise<AttendanceAttempt | null>
  createManualAttendance(params: CreateManualAttendanceParams): Promise<AttendanceRecord>
  listAttendances(filter?: {
    userId?: string
    date?: string
    status?: string
    actionType?: string
    limit?: number
  }): Promise<AttendanceRecord[]>

  // Academic Periods domain methods
  listAcademicPeriods(filter?: { isActive?: boolean }): Promise<AcademicPeriod[]>
  getAcademicPeriod(id: string): Promise<AcademicPeriod | null>
  getActiveAcademicPeriod(): Promise<AcademicPeriod | null>
  createAcademicPeriod(params: CreateAcademicPeriodParams): Promise<AcademicPeriod>
  updateAcademicPeriod(id: string, params: UpdateAcademicPeriodParams): Promise<AcademicPeriod>
  setActiveAcademicPeriod(id: string): Promise<AcademicPeriod>

  // Classes domain methods
  getClasses(schoolId?: string, academicPeriodId?: string): Promise<ClassRoom[]>
  getClassById(id: string): Promise<ClassRoom | null>
  createClass(params: CreateClassParams): Promise<ClassRoom>
  updateClass(id: string, params: UpdateClassParams): Promise<ClassRoom>

  // Class Enrollment domain methods
  listClassEnrollments(filter?: {
    userId?: string
    classId?: string
    academicPeriodId?: string
    status?: ClassEnrollmentStatus
  }): Promise<ClassEnrollment[]>
  getActiveClassEnrollment(
    userId: string,
    academicPeriodId?: string,
  ): Promise<ClassEnrollment | null>
  enrollStudentInClass(params: EnrollStudentParams): Promise<ClassEnrollment>
  transferStudentEnrollment(
    params: TransferStudentEnrollmentParams,
  ): Promise<{ previous: ClassEnrollment; current: ClassEnrollment }>
  promoteStudentEnrollment(
    params: PromoteStudentEnrollmentParams,
  ): Promise<{ previous: ClassEnrollment; current: ClassEnrollment }>
  exitStudentEnrollment(params: ExitStudentEnrollmentParams): Promise<ClassEnrollment>
  getStudentEnrollmentHistory(userId: string): Promise<ClassEnrollment[]>

  // Schedules domain methods
  listSchedules(filter?: {
    classId?: string
    academicPeriodId?: string
    dayOfWeek?: string
    isActive?: boolean
  }): Promise<Schedule[]>
  getScheduleById(id: string): Promise<Schedule | null>
  getActiveSchedule(
    dayKey: string,
    params?: { classId?: string; academicPeriodId?: string },
  ): Promise<Schedule | null>
  createSchedule(params: CreateScheduleParams): Promise<Schedule>
  updateSchedule(id: string, params: UpdateScheduleParams): Promise<Schedule>
  deleteSchedule(id: string): Promise<void>

  // Calendar Exceptions domain methods
  listCalendarExceptions(filter?: {
    academicPeriodId?: string
    startDate?: string
    endDate?: string
  }): Promise<CalendarException[]>
  getCalendarExceptionById(id: string): Promise<CalendarException | null>
  getCalendarExceptionByDate(
    date: string,
    academicPeriodId?: string,
  ): Promise<CalendarException | null>
  createCalendarException(params: CreateCalendarExceptionParams): Promise<CalendarException>
  updateCalendarException(
    id: string,
    params: UpdateCalendarExceptionParams,
  ): Promise<CalendarException>
  deleteCalendarException(id: string): Promise<void>

  // Location / Geofence domain methods
  listLocations(filter?: { isActive?: boolean }): Promise<Location[]>
  getLocationById(id: string): Promise<Location | null>
  createLocation(params: CreateLocationParams): Promise<Location>
  updateLocation(id: string, params: UpdateLocationParams): Promise<Location>
  deleteLocation(id: string): Promise<void>

  // Bootstrap & Roster domain methods
  getSchool(): Promise<School | null>
  getSchoolBySlug(slug: string): Promise<School | null>
  createSchool(params: CreateSchoolParams): Promise<School>
  createInitialSchoolAdmin(params: {
    userId: string
    fullName?: string | null
    email?: string | null
  }): Promise<UserProfile>
  stageRosterReport(params: StageRosterParams): Promise<RosterReport>
  getRosterReport(id: string): Promise<RosterReport | null>
  acceptRosterReport(id: string, acceptedBy: string): Promise<RosterReport>
  openSignup(): Promise<void>
  isSignupOpen(): Promise<boolean>
  getBootstrapStatus(): Promise<BootstrapStatus>
  insertAuditLog(entry: AuditLogEntry): Promise<void>
  getAuditLogs(entityType?: string, entityId?: string): Promise<AuditLog[]>

  // Roles & Permissions RBAC domain methods
  getRoles(activeOnly?: boolean): Promise<Role[]>
  getRoleById(id: string): Promise<Role | null>
  getRoleByName(name: string): Promise<Role | null>
  createRole(params: CreateRoleParams): Promise<Role>
  updateRole(id: string, params: UpdateRoleParams): Promise<Role>
  getPermissions(): Promise<Permission[]>
  createPermission(params: CreatePermissionParams): Promise<Permission>
  getUserRoles(userId: string): Promise<string[]>
  assignUserRoles(userId: string, roleNames: string[]): Promise<void>
  getUserEffectivePermissions(userId: string): Promise<string[]>

  // Staff domain methods
  createStaffProfile(params: CreateStaffParams): Promise<UserProfile>
  getStaffProfiles(): Promise<UserProfile[]>
  getStaffProfile(userId: string): Promise<UserProfile | null>
  updateStaffProfile(userId: string, updates: UpdateStaffParams): Promise<UserProfile>

  // Session revocation
  revokeUserSessions(userId: string): Promise<void>
  isSessionRevoked(userId: string): Promise<boolean>

  // Student Onboarding & Account Recovery methods
  getRosterStudentByNis(nis: string): Promise<RosterStudent | null>
  listStudentProfiles(filter?: {
    lifecycle_status?: ProfileLifecycleStatus
  }): Promise<UserProfile[]>
  createPendingStudentProfile(params: {
    userId: string
    nis: string
    email: string
    fullName: string
    className: string
  }): Promise<UserProfile>
  updateProfileLifecycle(userId: string, status: ProfileLifecycleStatus): Promise<UserProfile>
  updateProfileEmail(userId: string, email: string): Promise<UserProfile>
  createPasswordResetCode(params: CreatePasswordResetCodeParams): Promise<PasswordResetCode>
  getActivePasswordResetCode(userId: string, code: string): Promise<PasswordResetCode | null>
  markPasswordResetCodeUsed(codeId: string): Promise<void>

  // File metadata and lifecycle methods
  createFileRecord(params: CreateFileRecordParams): Promise<FileRecord>
  getFileRecord(id: string): Promise<FileRecord | null>
  listFiles(filter?: {
    userId?: string
    purpose?: FilePurpose
    lifecycle?: FileLifecycle
  }): Promise<FileRecord[]>
  updateFileLifecycle(id: string, lifecycle: FileLifecycle): Promise<FileRecord>
  deleteFileRecord(id: string): Promise<void>
  deleteFaceEnrollmentFiles(userId: string): Promise<number>

  // Face enrollment lifecycle methods
  getFaceEnrollment(userId: string): Promise<FaceEnrollmentRecord | null>
  saveFaceEnrollment(params: SaveFaceEnrollmentParams): Promise<FaceEnrollmentRecord>
  deleteFaceEnrollment(userId: string): Promise<void>

  // Notification Outbox domain methods
  enqueueNotification(params: EnqueueNotificationParams): Promise<NotificationRecord>
  getNotificationById(id: string): Promise<NotificationRecord | null>
  listNotifications(filter?: ListNotificationsFilter): Promise<NotificationRecord[]>
  claimPendingNotifications(params?: ClaimPendingNotificationsParams): Promise<NotificationRecord[]>
  updateNotificationStatus(params: UpdateNotificationStatusParams): Promise<NotificationRecord>
  deleteNotification(id: string): Promise<void>

  checkHealth(): Promise<boolean>
  close?(): Promise<void>
}

export const filePurposeSchema = z.enum(['avatar', 'permit_attachment', 'face_enrollment'])
export type FilePurpose = z.infer<typeof filePurposeSchema>

export const fileLifecycleSchema = z.enum(['pending_upload', 'available', 'rejected', 'deleted'])
export type FileLifecycle = z.infer<typeof fileLifecycleSchema>

export interface FileRecord {
  id: string
  user_id: string
  purpose: FilePurpose
  object_path: string
  content_type: string
  size_bytes?: number | null
  lifecycle: FileLifecycle
  created_at?: string
  updated_at?: string
}

export interface CreateFileRecordParams {
  userId: string
  purpose: FilePurpose
  objectPath: string
  contentType: string
  sizeBytes?: number | null
  lifecycle?: FileLifecycle
}

export const faceEnrollmentStatusSchema = z.enum(['not_enrolled', 'pending', 'enrolled', 'failed'])
export type FaceEnrollmentStatus = z.infer<typeof faceEnrollmentStatusSchema>

export interface FaceEnrollmentRecord {
  id: string
  user_id: string
  status: FaceEnrollmentStatus
  sample_count: number
  created_at?: string
  updated_at?: string
}

export interface SaveFaceEnrollmentParams {
  userId: string
  status: FaceEnrollmentStatus
  sampleCount?: number
}

export interface RosterStudent {
  nis: string
  full_name: string
  class_name: string
  grade?: number | null
}

export interface PasswordResetCode {
  id: string
  user_id: string
  code: string
  expires_at: string
  used: boolean
  used_at?: string | null
  created_by?: string | null
  created_at?: string
}

export interface CreatePasswordResetCodeParams {
  userId: string
  code: string
  expiresAt: string
  createdBy?: string | null
}

export interface ObjectStorage {
  uploadAvatar(userId: string, file: Buffer, contentType: string): Promise<string>
  deleteAvatar(userId: string): Promise<void>
  getSignedAvatarUrl(path: string): Promise<string | null>
  uploadPermitAttachment(userId: string, file: Buffer, contentType: string): Promise<string>
  getSignedPermitUrl(path: string): Promise<string | null>
  deletePermitAttachment?(path: string): Promise<void>
  uploadFaceEnrollmentImage(
    userId: string,
    imageIndex: number,
    file: Buffer,
    contentType: string,
  ): Promise<string>
  deleteFaceEnrollmentImages(userId: string): Promise<void>
  getSignedFaceEnrollmentUrl(path: string): Promise<string | null>
  getPresignedUploadUrl?(params: {
    bucket?: string
    key: string
    contentType: string
    expiresInSeconds?: number
  }): Promise<string>
  checkHealth(): Promise<boolean>
}

export type UserMetadataValue = string | number | boolean | null | undefined
export type UserMetadata = Record<string, UserMetadataValue>

export const notificationChannelSchema = z.enum(['push', 'email'])
export type NotificationChannel = z.infer<typeof notificationChannelSchema>

export const notificationStatusSchema = z.enum(['pending', 'processing', 'delivered', 'failed'])
export type NotificationStatus = z.infer<typeof notificationStatusSchema>

export const notificationPayloadValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.undefined(),
  z.array(z.string()),
  z.record(z.union([z.string(), z.number(), z.boolean(), z.null(), z.undefined()])),
])
export type NotificationPayloadValue = z.infer<typeof notificationPayloadValueSchema>

export const notificationPayloadSchema = z.record(notificationPayloadValueSchema)
export type NotificationPayload = z.infer<typeof notificationPayloadSchema>

export interface NotificationRecord {
  id: string
  user_id: string
  channel: NotificationChannel
  payload: NotificationPayload
  status: NotificationStatus
  retry_count: number
  next_retry_at?: string | null
  error_message?: string | null
  created_at?: string
  updated_at?: string
}

export interface EnqueueNotificationParams {
  userId: string
  channel: NotificationChannel
  payload: NotificationPayload
  nextRetryAt?: string | null
  status?: NotificationStatus
}

export interface ListNotificationsFilter {
  userId?: string
  channel?: NotificationChannel
  status?: NotificationStatus
  limit?: number
  offset?: number
}

export interface UpdateNotificationStatusParams {
  id: string
  status: NotificationStatus
  errorMessage?: string | null
  retryCount?: number
  nextRetryAt?: string | null
}

export interface ClaimPendingNotificationsParams {
  limit?: number
  maxRetries?: number
  now?: Date | string
}
