import postgres, { type Sql } from 'postgres'
import { env } from '../../config/env.js'
import type {
  CmsAccountInsert,
  CmsAccountList,
  CmsAccountMutation,
} from '../../modules/cms/accounts.js'
import type {
  CmsContentImport,
  CmsContentList,
  CmsContentMutation,
} from '../../modules/cms/content.js'
import type { PklAssessment } from '../../modules/pkl/assessment-command.js'
import type { PklCheckIn, PklCheckOut } from '../../modules/pkl/attendance.js'
import type {
  PklImport,
  PklList,
  PklMutation,
  PklSupervisorAssignment,
  PklTransition,
} from '../../modules/pkl/resources.js'
import type { DomainStore, ProfileLifecycleStatus } from '../types.js'
import * as academic from './academic-periods.js'
import * as adiwiyataReports from './adiwiyata-reports.js'
import * as adiwiyata from './adiwiyata.js'
import * as attendanceQueries from './attendance-queries.js'
import * as attendance from './attendance.js'
import * as auditSessions from './audit-sessions.js'
import * as classesEnrollment from './classes-enrollment.js'
import * as cmsAccounts from './cms-accounts.js'
import * as cmsContent from './cms-content.js'
import * as filesFaceReset from './files-face-reset.js'
import * as leaveLifecycle from './leave-lifecycle.js'
import * as leaveRequests from './leave-requests.js'
import * as notifications from './notifications-outbox.js'
import * as pkl from './pkl.js'
import * as rbacStaff from './rbac-staff.js'
import * as schedulesCalendar from './schedules-locations-calendar.js'
import * as schoolBootstrap from './school-bootstrap.js'
import * as studentsRoster from './students-roster.js'

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

  checkInPkl = (p: PklCheckIn) => pkl.checkInPkl(this.sql, p)
  checkOutPkl = (p: PklCheckOut) => pkl.checkOutPkl(this.sql, p)
  importPklRecords = (p: PklImport) => pkl.importPklRecords(this.sql, p)
  listPklRecords = (p: PklList) => pkl.listPklRecords(this.sql, p)
  countPklRecords = (p: PklList) => pkl.countPklRecords(this.sql, p)
  mutatePklRecord = (p: PklMutation) => pkl.mutatePklRecord(this.sql, p)
  verifyPklCertificate = (code: string) => pkl.verifyPklCertificate(this.sql, code)
  assignPklIndustrySupervisor = (p: PklSupervisorAssignment) =>
    pkl.assignPklIndustrySupervisor(this.sql, p)
  savePklAssessment = (p: PklAssessment) => pkl.savePklAssessment(this.sql, p)
  transitionPklRegistration = (p: PklTransition) => pkl.transitionPklRegistration(this.sql, p)

  listCmsContent = (p: CmsContentList) => cmsContent.listCmsContent(this.sql, p)
  countCmsContent = (p: CmsContentList) => cmsContent.countCmsContent(this.sql, p)
  importCmsContent = (p: CmsContentImport) => cmsContent.importCmsContent(this.sql, p)
  mutateCmsContent = (p: CmsContentMutation) => cmsContent.mutateCmsContent(this.sql, p)
  listCmsAccounts = (p: CmsAccountList) => cmsAccounts.listCmsAccounts(this.sql, p)
  insertCmsAccount = (p: CmsAccountInsert) => cmsAccounts.insertCmsAccount(this.sql, p)
  mutateCmsAccount = (p: CmsAccountMutation) => cmsAccounts.mutateCmsAccount(this.sql, p)
  getCmsProfileBySubject = (sub: string) => auditSessions.getCmsProfileBySubject(this.sql, sub)

  getUserProfile = (id: string) => studentsRoster.getUserProfile(this.sql, id)
  resolveLegacyUserId = (id: string) => studentsRoster.resolveLegacyUserId(this.sql, id)
  updateUserProfile: DomainStore['updateUserProfile'] = (id, u) =>
    studentsRoster.updateUserProfile(this.sql, id, u)
  getProfileByNis = (nis: string) => studentsRoster.getProfileByNis(this.sql, nis)
  getStudentByNis = (nis: string) => studentsRoster.getStudentByNis(this.sql, nis)
  createStudent: DomainStore['createStudent'] = (p) => studentsRoster.createStudent(this.sql, p)
  bindStudentToUser: DomainStore['bindStudentToUser'] = (p) =>
    studentsRoster.bindStudentToUser(this.sql, p)
  unbindStudentByNis = (nis: string) => studentsRoster.unbindStudentByNis(this.sql, nis)
  getRosterStudentByNis = (nis: string) => studentsRoster.getRosterStudentByNis(this.sql, nis)
  listStudentProfiles: DomainStore['listStudentProfiles'] = (f) =>
    studentsRoster.listStudentProfiles(this.sql, f)
  createPendingStudentProfile: DomainStore['createPendingStudentProfile'] = (p) =>
    studentsRoster.createPendingStudentProfile(this.sql, p)
  updateProfileLifecycle = (id: string, s: ProfileLifecycleStatus) =>
    studentsRoster.updateProfileLifecycle(this.sql, id, s)
  updateProfileEmail = (id: string, email: string) =>
    studentsRoster.updateProfileEmail(this.sql, id, email)

  getAdiwiyataEligibility = (id: string) => adiwiyata.getAdiwiyataEligibility(this.sql, id)
  listAdiwiyataEligibility = () => adiwiyata.listAdiwiyataEligibility(this.sql)
  upsertAdiwiyataEligibility = (id: string, by: string) =>
    adiwiyata.upsertAdiwiyataEligibility(this.sql, id, by)
  setAdiwiyataEligibilityActive = (id: string, on: boolean) =>
    adiwiyata.setAdiwiyataEligibilityActive(this.sql, id, on)
  listAdiwiyataSites: DomainStore['listAdiwiyataSites'] = (f) =>
    adiwiyata.listAdiwiyataSites(this.sql, f)
  createAdiwiyataSite: DomainStore['createAdiwiyataSite'] = (p) =>
    adiwiyata.createAdiwiyataSite(this.sql, p)
  updateAdiwiyataSite: DomainStore['updateAdiwiyataSite'] = (id, sid, p) =>
    adiwiyata.updateAdiwiyataSite(this.sql, id, sid, p)
  listAdiwiyataReports: DomainStore['listAdiwiyataReports'] = (f) =>
    adiwiyataReports.listAdiwiyataReports(this.sql, f)
  listAdiwiyataAdminReports: DomainStore['listAdiwiyataAdminReports'] = (f) =>
    adiwiyataReports.listAdiwiyataAdminReports(this.sql, f)
  updateAdiwiyataReportVerification: DomainStore['updateAdiwiyataReportVerification'] = (p) =>
    adiwiyataReports.updateAdiwiyataReportVerification(this.sql, p)
  submitAdiwiyataReport: DomainStore['submitAdiwiyataReport'] = (p) =>
    adiwiyataReports.submitAdiwiyataReport(this.sql, p)

  getTodayAbsences = (id: string, d: string) => attendanceQueries.getTodayAbsences(this.sql, id, d)
  insertAttendance: DomainStore['insertAttendance'] = (d) =>
    attendanceQueries.insertAttendance(this.sql, d)
  validateAttendanceAction: DomainStore['validateAttendanceAction'] = (p) =>
    attendance.validateAttendanceAction(this.sql, p)
  saveAttendanceRecord: DomainStore['saveAttendanceRecord'] = (p) =>
    attendance.saveAttendanceRecord(this.sql, p)
  recordAttendanceAttempt: DomainStore['recordAttendanceAttempt'] = (p) =>
    attendanceQueries.recordAttendanceAttempt(this.sql, p)
  listAttendanceAttempts: DomainStore['listAttendanceAttempts'] = (f) =>
    attendanceQueries.listAttendanceAttempts(this.sql, f)
  getAttendanceAttempt = (id: string) => attendanceQueries.getAttendanceAttempt(this.sql, id)
  createManualAttendance: DomainStore['createManualAttendance'] = (p) =>
    attendance.createManualAttendance(this.sql, p)
  deleteAttendances = (ids: string[]) => attendanceQueries.deleteAttendances(this.sql, ids)
  listAttendances: DomainStore['listAttendances'] = (f) =>
    attendanceQueries.listAttendances(this.sql, f)
  getAttendance = (id: string) => attendanceQueries.getAttendance(this.sql, id)

  getActiveSchedule = (d: string, p?: schedulesCalendar.ActiveScheduleScope) =>
    schedulesCalendar.getActiveSchedule(this.sql, d, p)
  listSchedules: DomainStore['listSchedules'] = (f) => schedulesCalendar.listSchedules(this.sql, f)
  getScheduleById = (id: string) => schedulesCalendar.getScheduleById(this.sql, id)
  createSchedule: DomainStore['createSchedule'] = (p) =>
    schedulesCalendar.createSchedule(this.sql, p)
  updateSchedule: DomainStore['updateSchedule'] = (id, p) =>
    schedulesCalendar.updateSchedule(this.sql, id, p)
  deleteSchedule = (id: string) => schedulesCalendar.deleteSchedule(this.sql, id)
  listLocations: DomainStore['listLocations'] = (f) => schedulesCalendar.listLocations(this.sql, f)
  getLocationById = (id: string) => schedulesCalendar.getLocationById(this.sql, id)
  createLocation: DomainStore['createLocation'] = (p) =>
    schedulesCalendar.createLocation(this.sql, p)
  updateLocation: DomainStore['updateLocation'] = (id, p) =>
    schedulesCalendar.updateLocation(this.sql, id, p)
  deleteLocation = (id: string) => schedulesCalendar.deleteLocation(this.sql, id)
  listCalendarExceptions: DomainStore['listCalendarExceptions'] = (f) =>
    schedulesCalendar.listCalendarExceptions(this.sql, f)
  getCalendarExceptionById = (id: string) =>
    schedulesCalendar.getCalendarExceptionById(this.sql, id)
  getCalendarExceptionByDate = (d: string, pid?: string) =>
    schedulesCalendar.getCalendarExceptionByDate(this.sql, d, pid)
  createCalendarException: DomainStore['createCalendarException'] = (p) =>
    schedulesCalendar.createCalendarException(this.sql, p)
  updateCalendarException: DomainStore['updateCalendarException'] = (id, p) =>
    schedulesCalendar.updateCalendarException(this.sql, id, p)
  deleteCalendarException = (id: string) => schedulesCalendar.deleteCalendarException(this.sql, id)

  getActivePermitsToday = (id: string, s: string, e: string) =>
    leaveRequests.getActivePermitsToday(this.sql, id, s, e)
  getPermitHistory = (id: string) => leaveRequests.getPermitHistory(this.sql, id)
  insertPermit: DomainStore['insertPermit'] = (d) => leaveRequests.insertPermit(this.sql, d)
  createLeaveRequest: DomainStore['createLeaveRequest'] = (d) =>
    leaveRequests.createLeaveRequest(this.sql, d)
  getLeaveRequestById = (id: string) => leaveRequests.getLeaveRequestById(this.sql, id)
  listLeaveRequests: DomainStore['listLeaveRequests'] = (f) =>
    leaveRequests.listLeaveRequests(this.sql, f)
  updateLeaveRequestStatus: DomainStore['updateLeaveRequestStatus'] = (p) =>
    leaveLifecycle.updateLeaveRequestStatus(this.sql, p)
  forceFinishLeaveRequest: DomainStore['forceFinishLeaveRequest'] = (p) =>
    leaveLifecycle.forceFinishLeaveRequest(this.sql, p)
  deleteLeaveRequest = (id: string) => leaveRequests.deleteLeaveRequest(this.sql, id)

  getSchool = () => schoolBootstrap.getSchool(this.sql)
  getSchoolBySlug = (slug: string) => schoolBootstrap.getSchoolBySlug(this.sql, slug)
  createSchool: DomainStore['createSchool'] = (p) => schoolBootstrap.createSchool(this.sql, p)
  createInitialSchoolAdmin: DomainStore['createInitialSchoolAdmin'] = (p) =>
    schoolBootstrap.createInitialSchoolAdmin(this.sql, p)
  stageRosterReport: DomainStore['stageRosterReport'] = (p) =>
    schoolBootstrap.stageRosterReport(this.sql, p)
  getRosterReport = (id: string) => schoolBootstrap.getRosterReport(this.sql, id)
  acceptRosterReport = (id: string, by: string) =>
    schoolBootstrap.acceptRosterReport(this.sql, id, by)
  openSignup = () => schoolBootstrap.openSignup(this.sql)
  isSignupOpen = () => schoolBootstrap.isSignupOpen(this.sql)
  getBootstrapStatus = () => schoolBootstrap.getBootstrapStatus(this.sql)

  listAcademicPeriods: DomainStore['listAcademicPeriods'] = (f) =>
    academic.listAcademicPeriods(this.sql, f)
  getAcademicPeriod = (id: string) => academic.getAcademicPeriod(this.sql, id)
  getActiveAcademicPeriod = () => academic.getActiveAcademicPeriod(this.sql)
  createAcademicPeriod: DomainStore['createAcademicPeriod'] = (p) =>
    academic.createAcademicPeriod(this.sql, p)
  updateAcademicPeriod: DomainStore['updateAcademicPeriod'] = (id, p) =>
    academic.updateAcademicPeriod(this.sql, id, p)
  setActiveAcademicPeriod = (id: string) => academic.setActiveAcademicPeriod(this.sql, id)
  getClasses = (sid?: string, pid?: string) => classesEnrollment.getClasses(this.sql, sid, pid)
  getClassById = (id: string) => classesEnrollment.getClassById(this.sql, id)
  createClass: DomainStore['createClass'] = (p) => classesEnrollment.createClass(this.sql, p)
  updateClass: DomainStore['updateClass'] = (id, p) =>
    classesEnrollment.updateClass(this.sql, id, p)
  listClassEnrollments: DomainStore['listClassEnrollments'] = (f) =>
    classesEnrollment.listClassEnrollments(this.sql, f)
  getActiveClassEnrollment = (id: string, pid?: string) =>
    classesEnrollment.getActiveClassEnrollment(this.sql, id, pid)
  enrollStudentInClass: DomainStore['enrollStudentInClass'] = (p) =>
    classesEnrollment.enrollStudentInClass(this.sql, p)
  transferStudentEnrollment: DomainStore['transferStudentEnrollment'] = (p) =>
    classesEnrollment.transferStudentEnrollment(this.sql, p)
  promoteStudentEnrollment: DomainStore['promoteStudentEnrollment'] = (p) =>
    classesEnrollment.promoteStudentEnrollment(this.sql, p)
  exitStudentEnrollment: DomainStore['exitStudentEnrollment'] = (p) =>
    classesEnrollment.exitStudentEnrollment(this.sql, p)
  getStudentEnrollmentHistory = (id: string) =>
    classesEnrollment.listClassEnrollments(this.sql, { userId: id })

  insertAuditLog: DomainStore['insertAuditLog'] = (e) => auditSessions.insertAuditLog(this.sql, e)
  getAuditLogs = (t?: string, id?: string) => auditSessions.getAuditLogs(this.sql, t, id)
  revokeUserSessions = (id: string) => auditSessions.revokeUserSessions(this.sql, id)
  isSessionRevoked = (id: string, iat?: number) => auditSessions.isSessionRevoked(this.sql, id, iat)

  getRoles = (activeOnly = false) => rbacStaff.getRoles(this.sql, activeOnly)
  getRoleById = (id: string) => rbacStaff.getRoleById(this.sql, id)
  getRoleByName = (name: string) => rbacStaff.getRoleByName(this.sql, name)
  createRole: DomainStore['createRole'] = (p) => rbacStaff.createRole(this.sql, p)
  updateRole: DomainStore['updateRole'] = (id, p) => rbacStaff.updateRole(this.sql, id, p)
  getPermissions = () => rbacStaff.getPermissions(this.sql)
  createPermission: DomainStore['createPermission'] = (p) => rbacStaff.createPermission(this.sql, p)
  getUserRoles = (id: string) => rbacStaff.getUserRoles(this.sql, id)
  assignUserRoles = (id: string, r: string[]) => rbacStaff.assignUserRoles(this.sql, id, r)
  getUserEffectivePermissions = (id: string) => rbacStaff.getUserEffectivePermissions(this.sql, id)
  createStaffProfile: DomainStore['createStaffProfile'] = (p) =>
    rbacStaff.createStaffProfile(this.sql, p)
  getStaffProfiles = () => rbacStaff.getStaffProfiles(this.sql)
  getStaffProfile = (id: string) => rbacStaff.getStaffProfile(this.sql, id)
  updateStaffProfile: DomainStore['updateStaffProfile'] = (id, u) =>
    rbacStaff.updateStaffProfile(this.sql, id, u)

  createPasswordResetCode: DomainStore['createPasswordResetCode'] = (p) =>
    filesFaceReset.createPasswordResetCode(this.sql, p)
  getActivePasswordResetCode = (id: string, code: string) =>
    filesFaceReset.getActivePasswordResetCode(this.sql, id, code)
  markPasswordResetCodeUsed = (id: string) => filesFaceReset.markPasswordResetCodeUsed(this.sql, id)
  createFileRecord: DomainStore['createFileRecord'] = (p) =>
    filesFaceReset.createFileRecord(this.sql, p)
  getFileRecord = (id: string) => filesFaceReset.getFileRecord(this.sql, id)
  listFiles: DomainStore['listFiles'] = (f) => filesFaceReset.listFiles(this.sql, f)
  updateFileLifecycle: DomainStore['updateFileLifecycle'] = (id, l) =>
    filesFaceReset.updateFileLifecycle(this.sql, id, l)
  deleteFileRecord = (id: string) => filesFaceReset.deleteFileRecord(this.sql, id)
  deleteFaceEnrollmentFiles = (id: string) => filesFaceReset.deleteFaceEnrollmentFiles(this.sql, id)
  getFaceEnrollment = (id: string) => filesFaceReset.getFaceEnrollment(this.sql, id)
  saveFaceEnrollment: DomainStore['saveFaceEnrollment'] = (p) =>
    filesFaceReset.saveFaceEnrollment(this.sql, p)
  deleteFaceEnrollment = (id: string) => filesFaceReset.deleteFaceEnrollment(this.sql, id)

  enqueueNotification: DomainStore['enqueueNotification'] = (p) =>
    notifications.enqueueNotification(this.sql, p)
  getNotificationById = (id: string) => notifications.getNotificationById(this.sql, id)
  listNotifications: DomainStore['listNotifications'] = (f) =>
    notifications.listNotifications(this.sql, f)
  claimPendingNotifications: DomainStore['claimPendingNotifications'] = (p) =>
    notifications.claimPendingNotifications(this.sql, p)
  updateNotificationStatus: DomainStore['updateNotificationStatus'] = (p) =>
    notifications.updateNotificationStatus(this.sql, p)
  deleteNotification = (id: string) => notifications.deleteNotification(this.sql, id)

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
