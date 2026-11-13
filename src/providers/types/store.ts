import type { PklSupervisorAssignment } from '../../modules/pkl/resources.js'
import type {
  CmsAccountInsert,
  CmsAccountList,
  CmsAccountMutation,
} from '../../modules/cms/accounts.js'
import type { CertificateVerification } from '../../modules/pkl/certificates.js'
import type { PklAssessment } from '../../modules/pkl/assessment-command.js'
import type { PklCheckIn, PklCheckOut } from '../../modules/pkl/attendance.js'
import type {
  PklImport,
  PklList,
  PklMutation,
  PklRow,
  PklTransition,
} from '../../modules/pkl/resources.js'
import type {
  CmsContentImport,
  CmsContentList,
  CmsContentMutation,
  CmsContentRow,
} from '../../modules/cms/content.js'
import type { CmsProfile } from '../../modules/cms/schema.js'
import type { AuditLog, AuditLogEntry, ProfileLifecycleStatus } from './common.js'
import type {
  AcademicPeriod,
  BootstrapStatus,
  ClassEnrollment,
  ClassEnrollmentStatus,
  ClassRoom,
  CreateAcademicPeriodParams,
  CreateClassParams,
  CreateSchoolParams,
  CreateStudentParams,
  EnrollStudentParams,
  ExitStudentEnrollmentParams,
  PromoteStudentEnrollmentParams,
  RosterReport,
  School,
  StageRosterParams,
  TransferStudentEnrollmentParams,
  UpdateAcademicPeriodParams,
  UpdateClassParams,
} from './academic.js'
import type {
  AdiwiyataAdminReport,
  AdiwiyataEligibility,
  AdiwiyataReport,
  AdiwiyataReportVerificationParams,
  AdiwiyataReportVerificationResult,
  AdiwiyataSite,
  CreateAdiwiyataSiteParams,
  SubmitAdiwiyataReportParams,
  UpdateAdiwiyataSiteParams,
} from './adiwiyata.js'
import type {
  Absence,
  AttendanceActionRpcResponse,
  AttendanceActionType,
  AttendanceAttempt,
  AttendanceAttemptStatus,
  AttendanceRecord,
  CalendarException,
  CreateCalendarExceptionParams,
  CreateLocationParams,
  CreateManualAttendanceParams,
  CreateScheduleParams,
  InsertAttendanceData,
  Location,
  RecordAttendanceAttemptParams,
  SaveAttendanceRecordRpcResponse,
  Schedule,
  UpdateCalendarExceptionParams,
  UpdateLocationParams,
  UpdateScheduleParams,
} from './attendance.js'
import type {
  ClaimPendingNotificationsParams,
  CreateFileRecordParams,
  EnqueueNotificationParams,
  FaceEnrollmentRecord,
  FileLifecycle,
  FilePurpose,
  FileRecord,
  ListNotificationsFilter,
  NotificationRecord,
  SaveFaceEnrollmentParams,
  UpdateNotificationStatusParams,
} from './files-notifications.js'
import type {
  ActivePermitSummary,
  CreateLeaveRequestData,
  ForceFinishLeaveRequestParams,
  InsertPermitData,
  LeaveRequest,
  ListLeaveRequestsFilter,
  Permit,
  UpdateLeaveRequestStatusParams,
} from './leave.js'
import type {
  CreatePasswordResetCodeParams,
  CreatePermissionParams,
  CreateRoleParams,
  CreateStaffParams,
  PasswordResetCode,
  Permission,
  Role,
  RosterStudent,
  Student,
  StudentBinding,
  StudentRosterRow,
  UpdateRoleParams,
  UpdateStaffParams,
  UserProfile,
} from './rbac-users.js'

export interface DomainStore {
  checkInPkl(params: PklCheckIn): Promise<PklRow>
  checkOutPkl(params: PklCheckOut): Promise<PklRow>
  importPklRecords(params: PklImport): Promise<PklRow[]>
  listPklRecords(params: PklList): Promise<PklRow[]>
  countPklRecords(params: PklList): Promise<number>
  mutatePklRecord(params: PklMutation): Promise<PklRow>
  verifyPklCertificate(code: string): Promise<CertificateVerification | null>
  assignPklIndustrySupervisor(params: PklSupervisorAssignment): Promise<PklRow>
  savePklAssessment(params: PklAssessment): Promise<PklRow>
  transitionPklRegistration(params: PklTransition): Promise<PklRow>
  listCmsContent(params: CmsContentList): Promise<CmsContentRow[]>
  countCmsContent(params: CmsContentList): Promise<number>
  mutateCmsContent(params: CmsContentMutation): Promise<CmsContentRow>
  importCmsContent(params: CmsContentImport): Promise<CmsContentRow[]>
  listCmsAccounts(params: CmsAccountList): Promise<CmsProfile[]>
  insertCmsAccount(params: CmsAccountInsert): Promise<CmsProfile>
  mutateCmsAccount(params: CmsAccountMutation): Promise<CmsProfile>
  getCmsProfileBySubject(subject: string): Promise<CmsProfile | null>
  getUserProfile(userId: string): Promise<UserProfile>
  getAdiwiyataEligibility(userId: string): Promise<AdiwiyataEligibility | null>
  listAdiwiyataEligibility(): Promise<AdiwiyataEligibility[]>
  upsertAdiwiyataEligibility(userId: string, addedBy: string): Promise<AdiwiyataEligibility>
  setAdiwiyataEligibilityActive(id: string, isActive: boolean): Promise<AdiwiyataEligibility | null>
  listAdiwiyataSites(filter?: { schoolId?: string; isActive?: boolean }): Promise<AdiwiyataSite[]>
  createAdiwiyataSite(params: CreateAdiwiyataSiteParams): Promise<AdiwiyataSite>
  updateAdiwiyataSite(
    id: string,
    schoolId: string,
    params: UpdateAdiwiyataSiteParams,
  ): Promise<AdiwiyataSite | null>
  listAdiwiyataReports(filter?: {
    classId?: string
    siteId?: string
    reportedBy?: string
    reportDate?: string
    siteIds?: string[]
  }): Promise<AdiwiyataReport[]>
  listAdiwiyataAdminReports(filter: {
    schoolId: string
    reportDate: string
    classId?: string
    siteId?: string
  }): Promise<AdiwiyataAdminReport[]>
  updateAdiwiyataReportVerification(
    params: AdiwiyataReportVerificationParams,
  ): Promise<AdiwiyataReportVerificationResult | null>
  submitAdiwiyataReport(params: SubmitAdiwiyataReportParams): Promise<AdiwiyataReport>
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
  createLeaveRequest(data: CreateLeaveRequestData): Promise<LeaveRequest>
  getLeaveRequestById(id: string): Promise<LeaveRequest | null>
  listLeaveRequests(filter?: ListLeaveRequestsFilter): Promise<LeaveRequest[]>
  updateLeaveRequestStatus(params: UpdateLeaveRequestStatusParams): Promise<LeaveRequest>
  forceFinishLeaveRequest(params: ForceFinishLeaveRequestParams): Promise<LeaveRequest>
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
    successAttempt?: Omit<RecordAttendanceAttemptParams, 'userId' | 'actionType' | 'status'>
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
  getAttendance(id: string): Promise<AttendanceRecord | null>
  createManualAttendance(params: CreateManualAttendanceParams): Promise<AttendanceRecord>
  deleteAttendances(ids: string[]): Promise<AttendanceRecord[]>
  listAttendances(filter?: {
    userId?: string
    date?: string
    startDate?: string
    endDate?: string
    status?: string
    actionType?: string
    limit?: number
    offset?: number
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
  getStudentByNis(nis: string): Promise<Student | null>
  createStudent(params: CreateStudentParams): Promise<Student>
  bindStudentToUser(params: { studentId: string; userId: string }): Promise<StudentBinding>
  unbindStudentByNis?(nis: string): Promise<void>
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
  insertAuditLog(entry: AuditLogEntry): Promise<AuditLog>
  /**
   * Returns audit logs matching the given entity criteria, ordered newest-first (descending by created_at).
   */
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
  isSessionRevoked(userId: string, issuedAt?: number): Promise<boolean>

  // Student Onboarding & Account Recovery methods
  getRosterStudentByNis(nis: string): Promise<RosterStudent | null>
  listStudentProfiles(filter?: {
    lifecycle_status?: ProfileLifecycleStatus
  }): Promise<StudentRosterRow[]>
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
