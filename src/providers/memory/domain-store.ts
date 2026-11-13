import type {
  Absence,
  ActivePermitSummary,
  AttendanceActionRpcResponse,
  AttendanceActionType,
  AttendanceAttempt,
  AttendanceAttemptStatus,
  AttendanceRecord,
  BootstrapStatus,
  CreateFileRecordParams,
  CreateLeaveRequestData,
  CreateManualAttendanceParams,
  CreatePermissionParams,
  CreateRoleParams,
  CreateSchoolParams,
  CreateStaffParams,
  DomainStore,
  FaceEnrollmentRecord,
  FileLifecycle,
  FilePurpose,
  FileRecord,
  ForceFinishLeaveRequestParams,
  InsertAttendanceData,
  InsertPermitData,
  LeaveRequest,
  ListLeaveRequestsFilter,
  Permission,
  Permit,
  RecordAttendanceAttemptParams,
  Role,
  RosterReport,
  SaveAttendanceRecordRpcResponse,
  SaveFaceEnrollmentParams,
  School,
  StageRosterParams,
  UpdateLeaveRequestStatusParams,
  UpdateRoleParams,
  UpdateStaffParams,
  UserProfile,
} from '../types.js'
import {
  createMemoryManualAttendance,
  deleteMemoryAttendances,
  getMemoryAttendance,
  listMemoryAttendances,
} from './attendance-admin.js'
import {
  getMemoryAttendanceAttempt,
  getMemoryTodayAbsences,
  insertMemoryAttendance,
  listMemoryAttendanceAttempts,
  recordMemoryAttendanceAttempt,
  saveMemoryAttendanceRecord,
  validateMemoryAttendanceAction,
} from './attendance.js'
import { MemoryDomainStoreOperations } from './domain-store-operations.js'
import {
  createMemoryFileRecord,
  deleteMemoryFaceEnrollment,
  deleteMemoryFaceEnrollmentFiles,
  deleteMemoryFileRecord,
  getMemoryFaceEnrollment,
  getMemoryFileRecord,
  listMemoryFiles,
  saveMemoryFaceEnrollment,
  updateMemoryFileLifecycle,
} from './files-notifications.js'
import { forceFinishMemoryLeaveRequest, updateMemoryLeaveRequestStatus } from './leave-decisions.js'
import {
  createMemoryLeaveRequest,
  deleteMemoryLeaveRequest,
  getMemoryActivePermitsToday,
  getMemoryLeaveRequestById,
  getMemoryPermitHistory,
  insertMemoryPermit,
  listMemoryLeaveRequests,
} from './leave-requests.js'
import {
  assignMemoryUserRoles,
  createMemoryPermission,
  createMemoryRole,
  createMemoryStaffProfile,
  getMemoryPermissions,
  getMemoryRoleById,
  getMemoryRoleByName,
  getMemoryRoles,
  getMemoryStaffProfile,
  getMemoryStaffProfiles,
  getMemoryUserEffectivePermissions,
  getMemoryUserRoles,
  updateMemoryRole,
  updateMemoryStaffProfile,
} from './rbac-staff.js'
import {
  acceptMemoryRosterReport,
  createMemoryInitialSchoolAdmin,
  createMemorySchool,
  getMemoryBootstrapStatus,
  getMemoryRosterReport,
  getMemorySchool,
  getMemorySchoolBySlug,
  isMemorySignupOpen,
  openMemorySignup,
  stageMemoryRosterReport,
} from './school-bootstrap.js'

export class MemoryDomainStore extends MemoryDomainStoreOperations implements DomainStore {
  async getActivePermitsToday(
    userId: string,
    startISO: string,
    endISO: string,
  ): Promise<ActivePermitSummary[]> {
    return getMemoryActivePermitsToday(this, userId, startISO, endISO)
  }
  async getPermitHistory(userId: string): Promise<Permit[]> {
    return getMemoryPermitHistory(this, userId)
  }
  async insertPermit(data: InsertPermitData): Promise<Permit> {
    return insertMemoryPermit(this, data)
  }
  async createLeaveRequest(data: CreateLeaveRequestData): Promise<LeaveRequest> {
    return createMemoryLeaveRequest(this, data)
  }
  async getLeaveRequestById(id: string): Promise<LeaveRequest | null> {
    return getMemoryLeaveRequestById(this, id)
  }
  async listLeaveRequests(filter?: ListLeaveRequestsFilter): Promise<LeaveRequest[]> {
    return listMemoryLeaveRequests(this, filter)
  }
  async updateLeaveRequestStatus(params: UpdateLeaveRequestStatusParams): Promise<LeaveRequest> {
    return updateMemoryLeaveRequestStatus(this, params)
  }
  async forceFinishLeaveRequest(params: ForceFinishLeaveRequestParams): Promise<LeaveRequest> {
    return forceFinishMemoryLeaveRequest(this, params)
  }
  async deleteLeaveRequest(id: string): Promise<void> {
    deleteMemoryLeaveRequest(this, id)
  }

  async getTodayAbsences(userId: string, dateWIB: string): Promise<Absence[]> {
    return getMemoryTodayAbsences(this, userId, dateWIB)
  }
  async insertAttendance(data: InsertAttendanceData): Promise<Absence> {
    return insertMemoryAttendance(this, data)
  }
  async validateAttendanceAction(params: {
    userId: string
    latitude: number
    longitude: number
  }): Promise<AttendanceActionRpcResponse> {
    return validateMemoryAttendanceAction(this, params)
  }
  async saveAttendanceRecord(params: {
    userId: string
    actionType: 'check_in' | 'check_out'
    latitude: number
    longitude: number
    successAttempt?: Omit<RecordAttendanceAttemptParams, 'userId' | 'actionType' | 'status'>
  }): Promise<SaveAttendanceRecordRpcResponse> {
    return saveMemoryAttendanceRecord(this, params)
  }
  async recordAttendanceAttempt(params: RecordAttendanceAttemptParams): Promise<AttendanceAttempt> {
    return recordMemoryAttendanceAttempt(this, params)
  }
  async listAttendanceAttempts(filter?: {
    userId?: string
    status?: AttendanceAttemptStatus
    actionType?: AttendanceActionType
    limit?: number
  }): Promise<AttendanceAttempt[]> {
    return listMemoryAttendanceAttempts(this, filter)
  }
  async getAttendanceAttempt(id: string): Promise<AttendanceAttempt | null> {
    return getMemoryAttendanceAttempt(this, id)
  }
  async createManualAttendance(params: CreateManualAttendanceParams): Promise<AttendanceRecord> {
    return createMemoryManualAttendance(this, params)
  }
  async deleteAttendances(ids: string[]): Promise<AttendanceRecord[]> {
    return deleteMemoryAttendances(this, ids)
  }
  async listAttendances(filter?: {
    userId?: string
    date?: string
    startDate?: string
    endDate?: string
    status?: string
    actionType?: string
    limit?: number
    offset?: number
  }): Promise<AttendanceRecord[]> {
    return listMemoryAttendances(this, filter)
  }
  async getAttendance(id: string): Promise<AttendanceRecord | null> {
    return getMemoryAttendance(this, id)
  }

  async getSchool(): Promise<School | null> {
    return getMemorySchool(this)
  }
  async getSchoolBySlug(slug: string): Promise<School | null> {
    return getMemorySchoolBySlug(this, slug)
  }
  async createSchool(params: CreateSchoolParams): Promise<School> {
    return createMemorySchool(this, params)
  }
  async createInitialSchoolAdmin(params: {
    userId: string
    fullName?: string | null
    email?: string | null
  }): Promise<UserProfile> {
    return createMemoryInitialSchoolAdmin(this, params)
  }
  async stageRosterReport(params: StageRosterParams): Promise<RosterReport> {
    return stageMemoryRosterReport(this, params)
  }
  async getRosterReport(id: string): Promise<RosterReport | null> {
    return getMemoryRosterReport(this, id)
  }
  async acceptRosterReport(id: string, acceptedBy: string): Promise<RosterReport> {
    return acceptMemoryRosterReport(this, id, acceptedBy)
  }
  async openSignup(): Promise<void> {
    openMemorySignup(this)
  }
  async isSignupOpen(): Promise<boolean> {
    return isMemorySignupOpen(this)
  }
  async getBootstrapStatus(): Promise<BootstrapStatus> {
    return getMemoryBootstrapStatus(this)
  }

  async getRoles(activeOnly = false): Promise<Role[]> {
    return getMemoryRoles(this, activeOnly)
  }
  async getRoleById(id: string): Promise<Role | null> {
    return getMemoryRoleById(this, id)
  }
  async getRoleByName(name: string): Promise<Role | null> {
    return getMemoryRoleByName(this, name)
  }
  async createRole(params: CreateRoleParams): Promise<Role> {
    return createMemoryRole(this, params)
  }
  async updateRole(id: string, params: UpdateRoleParams): Promise<Role> {
    return updateMemoryRole(this, id, params)
  }
  async getPermissions(): Promise<Permission[]> {
    return getMemoryPermissions(this)
  }
  async createPermission(params: CreatePermissionParams): Promise<Permission> {
    return createMemoryPermission(this, params)
  }
  async getUserRoles(userId: string): Promise<string[]> {
    return getMemoryUserRoles(this, userId)
  }
  async assignUserRoles(userId: string, roleNames: string[]): Promise<void> {
    assignMemoryUserRoles(this, userId, roleNames)
  }
  async getUserEffectivePermissions(userId: string): Promise<string[]> {
    return getMemoryUserEffectivePermissions(this, userId)
  }
  async createStaffProfile(params: CreateStaffParams): Promise<UserProfile> {
    return createMemoryStaffProfile(this, params)
  }
  async getStaffProfiles(): Promise<UserProfile[]> {
    return getMemoryStaffProfiles(this)
  }
  async getStaffProfile(userId: string): Promise<UserProfile | null> {
    return getMemoryStaffProfile(this, userId)
  }
  async updateStaffProfile(userId: string, updates: UpdateStaffParams): Promise<UserProfile> {
    return updateMemoryStaffProfile(this, userId, updates)
  }

  async createFileRecord(params: CreateFileRecordParams): Promise<FileRecord> {
    return createMemoryFileRecord(this, params)
  }
  async getFileRecord(id: string): Promise<FileRecord | null> {
    return getMemoryFileRecord(this, id)
  }
  async listFiles(filter?: {
    userId?: string
    purpose?: FilePurpose
    lifecycle?: FileLifecycle
  }): Promise<FileRecord[]> {
    return listMemoryFiles(this, filter)
  }
  async updateFileLifecycle(id: string, lifecycle: FileLifecycle): Promise<FileRecord> {
    return updateMemoryFileLifecycle(this, id, lifecycle)
  }
  async deleteFileRecord(id: string): Promise<void> {
    deleteMemoryFileRecord(this, id)
  }
  async deleteFaceEnrollmentFiles(userId: string): Promise<number> {
    return deleteMemoryFaceEnrollmentFiles(this, userId)
  }
  async getFaceEnrollment(userId: string): Promise<FaceEnrollmentRecord | null> {
    return getMemoryFaceEnrollment(this, userId)
  }
  async saveFaceEnrollment(params: SaveFaceEnrollmentParams): Promise<FaceEnrollmentRecord> {
    return saveMemoryFaceEnrollment(this, params)
  }
  async deleteFaceEnrollment(userId: string): Promise<void> {
    deleteMemoryFaceEnrollment(this, userId)
  }
}
