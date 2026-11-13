import type {
  CmsAccountInsert,
  CmsAccountList,
  CmsAccountMutation,
} from '../../modules/cms/accounts.js'
import type {
  CmsContentImport,
  CmsContentList,
  CmsContentMutation,
  CmsContentRow,
} from '../../modules/cms/content.js'
import type { CmsProfile } from '../../modules/cms/schema.js'
import type { PklAssessment } from '../../modules/pkl/assessment-command.js'
import type { PklCheckIn, PklCheckOut } from '../../modules/pkl/attendance.js'
import type { CertificateVerification } from '../../modules/pkl/certificates.js'
import type {
  PklImport,
  PklList,
  PklMutation,
  PklRow,
  PklSupervisorAssignment,
  PklTransition,
} from '../../modules/pkl/resources.js'
import type {
  Absence,
  AcademicPeriod,
  AdiwiyataAdminReport,
  AdiwiyataEligibility,
  AdiwiyataReport,
  AdiwiyataReportVerificationParams,
  AdiwiyataReportVerificationResult,
  AdiwiyataSite,
  AttendanceAttempt,
  AttendanceRecord,
  AuditLog,
  AuditLogEntry,
  CalendarException,
  ClaimPendingNotificationsParams,
  ClassEnrollment,
  ClassEnrollmentStatus,
  ClassRoom,
  CreateAdiwiyataSiteParams,
  CreateStudentParams,
  EnqueueNotificationParams,
  FaceEnrollmentRecord,
  FileRecord,
  ListNotificationsFilter,
  Location,
  NotificationRecord,
  PasswordResetCode,
  Permission,
  Permit,
  Role,
  RosterReport,
  RosterStudent,
  Schedule,
  School,
  Student,
  StudentBinding,
  SubmitAdiwiyataReportParams,
  UpdateAdiwiyataSiteParams,
  UpdateNotificationStatusParams,
  UserProfile,
} from '../types.js'
import { listMemoryClassEnrollments } from './academic-enrollment.js'
import {
  updateMemoryAdiwiyataReportVerification,
  submitMemoryAdiwiyataReport,
} from './adiwiyata-reports.js'
import {
  createMemoryAdiwiyataSite,
  getMemoryAdiwiyataEligibility,
  listMemoryAdiwiyataAdminReports,
  listMemoryAdiwiyataEligibility,
  listMemoryAdiwiyataReports,
  listMemoryAdiwiyataSites,
  setMemoryAdiwiyataEligibilityActive,
  updateMemoryAdiwiyataSite,
  upsertMemoryAdiwiyataEligibility,
} from './adiwiyata.js'
import {
  insertMemoryCmsAccount,
  listMemoryCmsAccounts,
  mutateMemoryCmsAccount,
} from './cms-accounts.js'
import { listMemoryCmsContent, mutateMemoryCmsContent, type MemoryCmsState } from './cms-content.js'
import { importMemoryCmsContent } from './cms-imports.js'
import {
  DEFAULT_ACADEMIC_PERIODS,
  DEFAULT_CLASSES,
  DEFAULT_LOCATIONS,
  DEFAULT_PERMISSIONS,
  DEFAULT_ROLES,
  DEFAULT_SCHEDULES,
} from './defaults.js'
import type { MemoryDomainState } from './domain-state.js'
import {
  claimMemoryPendingNotifications,
  deleteMemoryNotification,
  enqueueMemoryNotification,
  getMemoryNotificationById,
  listMemoryNotifications,
  updateMemoryNotificationStatus,
} from './files-notifications.js'
import {
  assignMemoryPklIndustrySupervisor,
  checkInMemoryPkl,
  checkOutMemoryPkl,
  importMemoryPklRecords,
  listMemoryPklRecords,
  mutateMemoryPklRecord,
  saveMemoryPklAssessment,
  transitionMemoryPklRegistration,
  verifyMemoryPklCertificate,
  type MemoryPklState,
} from './pkl.js'
import {
  getMemoryAuditLogs,
  insertMemoryAuditLog,
  isMemorySessionRevoked,
  revokeMemoryUserSessions,
} from './rbac-staff.js'
import {
  createMemoryStudent,
  getMemoryRosterStudentByNis,
  getMemoryStudentByNis,
} from './students-profiles.js'

export class MemoryDomainStoreBase implements MemoryDomainState {
  public cmsContent = new Map<string, Map<string, CmsContentRow>>()
  public cmsContentAudit: MemoryCmsState['cmsContentAudit'] = []
  public pklRecords: MemoryPklState['pklRecords'] = new Map()
  public pklAudit: MemoryPklState['pklAudit'] = []
  public cmsProfiles = new Map<string, CmsProfile>()
  public profiles = new Map<string, UserProfile>()
  public students = new Map<string, Student>()
  public studentBindings = new Map<string, StudentBinding>()
  public absences: Absence[] = []
  public schedules = new Map<string, Schedule>()
  public locations = new Map<string, Location>()
  public calendarExceptions = new Map<string, CalendarException>()
  public permits: Permit[] = []
  public schools: School[] = []
  public academicPeriods: AcademicPeriod[] = []
  public classes: ClassRoom[] = []
  public classEnrollments: ClassEnrollment[] = []
  public adiwiyataEligibility = new Map<string, AdiwiyataEligibility>()
  public adiwiyataSites = new Map<string, AdiwiyataSite>()
  public adiwiyataReports = new Map<string, AdiwiyataReport>()
  private readonly adiwiyataLocks = new Map<string, Promise<void>>()
  public rosterReports = new Map<string, RosterReport>()
  public auditLogs: AuditLog[] = []
  public roles = new Map<string, Role>()
  public permissions = new Map<string, Permission>()
  public userRoles = new Map<string, Set<string>>()
  public revokedSessions = new Map<string, number>()
  public resetCodes: PasswordResetCode[] = []
  public files = new Map<string, FileRecord>()
  public faceEnrollments = new Map<string, FaceEnrollmentRecord>()
  public notifications = new Map<string, NotificationRecord>()
  public attendanceAttempts: AttendanceAttempt[] = []
  public attendancesList: AttendanceRecord[] = []
  public signupOpen = false
  public isHealthy = true

  constructor() {
    for (const perm of DEFAULT_PERMISSIONS) {
      this.permissions.set(perm.name, { ...perm })
    }
    for (const role of DEFAULT_ROLES) {
      this.roles.set(role.name, { ...role, permissions: [...(role.permissions ?? [])] })
    }
    for (const loc of DEFAULT_LOCATIONS) {
      this.locations.set(loc.id, { ...loc })
    }
    for (const sched of DEFAULT_SCHEDULES) {
      this.schedules.set(sched.id ?? sched.hari, { ...sched })
    }
    for (const p of DEFAULT_ACADEMIC_PERIODS) {
      this.academicPeriods.push({ ...p })
    }
    for (const c of DEFAULT_CLASSES) {
      this.classes.push({ ...c })
    }
  }

  async checkInPkl(params: PklCheckIn): Promise<PklRow> {
    return checkInMemoryPkl(this, params)
  }
  async checkOutPkl(params: PklCheckOut): Promise<PklRow> {
    return checkOutMemoryPkl(this, params)
  }
  async importPklRecords(params: PklImport): Promise<PklRow[]> {
    return importMemoryPklRecords(this, params)
  }
  async listPklRecords(params: PklList): Promise<PklRow[]> {
    return listMemoryPklRecords(this, params)
  }
  async countPklRecords(params: PklList): Promise<number> {
    return listMemoryPklRecords(this, {
      ...params,
      query: { ...params.query, limit: Number.MAX_SAFE_INTEGER, offset: 0 },
    }).length
  }
  async mutatePklRecord(params: PklMutation): Promise<PklRow> {
    return mutateMemoryPklRecord(this, params)
  }
  async verifyPklCertificate(code: string): Promise<CertificateVerification | null> {
    return verifyMemoryPklCertificate(this, code)
  }
  async assignPklIndustrySupervisor(params: PklSupervisorAssignment): Promise<PklRow> {
    return assignMemoryPklIndustrySupervisor(this, params)
  }
  async savePklAssessment(params: PklAssessment): Promise<PklRow> {
    return saveMemoryPklAssessment(this, params)
  }
  async transitionPklRegistration(params: PklTransition): Promise<PklRow> {
    return transitionMemoryPklRegistration(this, params)
  }

  async listCmsContent(params: CmsContentList): Promise<CmsContentRow[]> {
    return listMemoryCmsContent(this, params)
  }
  async countCmsContent(params: CmsContentList): Promise<number> {
    return listMemoryCmsContent(this, {
      ...params,
      query: { ...params.query, limit: Number.MAX_SAFE_INTEGER, offset: 0 },
    }).length
  }
  async importCmsContent(params: CmsContentImport): Promise<CmsContentRow[]> {
    return importMemoryCmsContent(this, params)
  }
  async mutateCmsContent(params: CmsContentMutation): Promise<CmsContentRow> {
    return mutateMemoryCmsContent(this, params)
  }
  async listCmsAccounts(params: CmsAccountList): Promise<CmsProfile[]> {
    return listMemoryCmsAccounts(this, params)
  }
  async insertCmsAccount(params: CmsAccountInsert): Promise<CmsProfile> {
    return insertMemoryCmsAccount(this, params)
  }
  async mutateCmsAccount(params: CmsAccountMutation): Promise<CmsProfile> {
    return mutateMemoryCmsAccount(this, params)
  }
  async getCmsProfileBySubject(subject: string): Promise<CmsProfile | null> {
    const profile = this.cmsProfiles.get(subject)
    return profile ? { ...profile } : null
  }

  async getAdiwiyataEligibility(userId: string): Promise<AdiwiyataEligibility | null> {
    return getMemoryAdiwiyataEligibility(this, userId)
  }
  async listAdiwiyataEligibility(): Promise<AdiwiyataEligibility[]> {
    return listMemoryAdiwiyataEligibility(this)
  }
  async upsertAdiwiyataEligibility(userId: string, addedBy: string): Promise<AdiwiyataEligibility> {
    return upsertMemoryAdiwiyataEligibility(this, userId, addedBy)
  }
  async setAdiwiyataEligibilityActive(
    id: string,
    isActive: boolean,
  ): Promise<AdiwiyataEligibility | null> {
    return setMemoryAdiwiyataEligibilityActive(this, id, isActive)
  }
  async listAdiwiyataSites(filter?: {
    schoolId?: string
    isActive?: boolean
  }): Promise<AdiwiyataSite[]> {
    return listMemoryAdiwiyataSites(this, filter)
  }
  async createAdiwiyataSite(params: CreateAdiwiyataSiteParams): Promise<AdiwiyataSite> {
    return createMemoryAdiwiyataSite(this, params)
  }
  async updateAdiwiyataSite(
    id: string,
    schoolId: string,
    params: UpdateAdiwiyataSiteParams,
  ): Promise<AdiwiyataSite | null> {
    return updateMemoryAdiwiyataSite(this, id, schoolId, params)
  }
  async listAdiwiyataReports(filter?: {
    classId?: string
    siteId?: string
    reportedBy?: string
    reportDate?: string
    siteIds?: string[]
  }): Promise<AdiwiyataReport[]> {
    return listMemoryAdiwiyataReports(this, filter)
  }
  async listAdiwiyataAdminReports(filter: {
    schoolId: string
    reportDate: string
    classId?: string
    siteId?: string
  }): Promise<AdiwiyataAdminReport[]> {
    return listMemoryAdiwiyataAdminReports(this, filter)
  }
  async updateAdiwiyataReportVerification(
    params: AdiwiyataReportVerificationParams,
  ): Promise<AdiwiyataReportVerificationResult | null> {
    return updateMemoryAdiwiyataReportVerification(this, this.adiwiyataLocks, params)
  }
  async submitAdiwiyataReport(params: SubmitAdiwiyataReportParams): Promise<AdiwiyataReport> {
    return submitMemoryAdiwiyataReport(this, this.adiwiyataLocks, params)
  }

  async insertAuditLog(entry: AuditLogEntry): Promise<AuditLog> {
    return insertMemoryAuditLog(this, entry)
  }
  async getAuditLogs(entityType?: string, entityId?: string): Promise<AuditLog[]> {
    return getMemoryAuditLogs(this, entityType, entityId)
  }
  async enqueueNotification(params: EnqueueNotificationParams): Promise<NotificationRecord> {
    return enqueueMemoryNotification(this, params)
  }
  async getNotificationById(id: string): Promise<NotificationRecord | null> {
    return getMemoryNotificationById(this, id)
  }
  async listNotifications(filter?: ListNotificationsFilter): Promise<NotificationRecord[]> {
    return listMemoryNotifications(this, filter)
  }
  async claimPendingNotifications(
    params?: ClaimPendingNotificationsParams,
  ): Promise<NotificationRecord[]> {
    return claimMemoryPendingNotifications(this, params)
  }
  async updateNotificationStatus(
    params: UpdateNotificationStatusParams,
  ): Promise<NotificationRecord> {
    return updateMemoryNotificationStatus(this, params)
  }
  async deleteNotification(id: string): Promise<void> {
    deleteMemoryNotification(this, id)
  }
  async revokeUserSessions(userId: string): Promise<void> {
    revokeMemoryUserSessions(this, userId)
  }
  async isSessionRevoked(userId: string, issuedAt?: number): Promise<boolean> {
    return isMemorySessionRevoked(this, userId, issuedAt)
  }
  async getStudentByNis(nis: string): Promise<Student | null> {
    return getMemoryStudentByNis(this, nis)
  }
  async createStudent(params: CreateStudentParams): Promise<Student> {
    return createMemoryStudent(this, params)
  }
  async getRosterStudentByNis(nis: string): Promise<RosterStudent | null> {
    return getMemoryRosterStudentByNis(this, nis)
  }
  async listClassEnrollments(filter?: {
    userId?: string
    classId?: string
    academicPeriodId?: string
    status?: ClassEnrollmentStatus
  }): Promise<ClassEnrollment[]> {
    return listMemoryClassEnrollments(this, filter)
  }
  async checkHealth(): Promise<boolean> {
    return this.isHealthy
  }
}
