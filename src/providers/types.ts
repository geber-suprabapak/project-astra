import { z } from 'zod'
import type { RobinClient } from '../clients/robin/client.js'

export const profileLifecycleStatusSchema = z.enum(['pending', 'approved', 'rejected', 'disabled'])
export type ProfileLifecycleStatus = z.infer<typeof profileLifecycleStatusSchema>

export const identityRoleSchema = z.enum(['platform_admin', 'school_admin', 'teacher', 'student', 'staff'])
export type IdentityRole = z.infer<typeof identityRoleSchema>

export interface UserProfile {
  user_id: string
  full_name: string | null
  email?: string | null
  nis?: string | null
  class_name?: string | null
  absence_number?: string | null
  avatar_url?: string | null
  role?: IdentityRole | null
  lifecycle_status: ProfileLifecycleStatus
  gender?: string | null
}

export interface IdentityUser {
  userId: string
  email?: string | null
  roles?: readonly IdentityRole[]
  scopes?: readonly string[]
  mfaVerified?: boolean
  mustChangePassword?: boolean
}

export interface IdentityProvider {
  verifyToken(token: string): Promise<IdentityUser>
  verifyPassword(email: string, password: string): Promise<void>
  updatePassword(userId: string, newPassword: string): Promise<void>
  updateUserMetadata(userId: string, metadata: UserMetadata): Promise<void>
  checkHealth(): Promise<boolean>
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
  hari: string
  mulai_masuk: string | null
  selesai_masuk: string | null
  mulai_pulang: string | null
  selesai_pulang: string | null
  kompensasi_waktu: number | null
  is_active: boolean
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
  rejection_reason?: string | null
  rejected_at?: string | null
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

export interface InsertAttendanceData {
  user_id: string
  date: string
  status: 'Hadir' | 'Terlambat' | 'Pulang'
  created_at?: string
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
  schoolId: string
  name: string
  startDate: string
  endDate: string
  isActive: boolean
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
  schoolId: string
  academicPeriodId?: string | null
  name: string
  grade?: number | null
}

export interface ClassEnrollment {
  id: string
  user_id: string
  class_id: string
  academic_period_id: string
  status: 'active' | 'transferred' | 'promoted' | 'graduated' | 'archived'
  created_at?: string
  updated_at?: string
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

export interface DomainStore {
  getUserProfile(userId: string): Promise<UserProfile>
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

  // Bootstrap & Roster domain methods
  getSchool(): Promise<School | null>
  getSchoolBySlug(slug: string): Promise<School | null>
  createSchool(params: CreateSchoolParams): Promise<School>
  createInitialSchoolAdmin(params: {
    userId: string
    fullName?: string | null
    email?: string | null
  }): Promise<UserProfile>
  getActiveAcademicPeriod(): Promise<AcademicPeriod | null>
  createAcademicPeriod(params: CreateAcademicPeriodParams): Promise<AcademicPeriod>
  getClasses(schoolId?: string): Promise<ClassRoom[]>
  createClass(params: CreateClassParams): Promise<ClassRoom>
  stageRosterReport(params: StageRosterParams): Promise<RosterReport>
  getRosterReport(id: string): Promise<RosterReport | null>
  acceptRosterReport(id: string, acceptedBy: string): Promise<RosterReport>
  openSignup(): Promise<void>
  isSignupOpen(): Promise<boolean>
  getBootstrapStatus(): Promise<BootstrapStatus>
  insertAuditLog(entry: AuditLogEntry): Promise<void>
  getAuditLogs(entityType?: string, entityId?: string): Promise<AuditLog[]>

  checkHealth(): Promise<boolean>
  close?(): Promise<void>
}

export interface ObjectStorage {
  uploadAvatar(userId: string, file: Buffer, contentType: string): Promise<string>
  deleteAvatar(userId: string): Promise<void>
  getSignedAvatarUrl(path: string): Promise<string | null>
  uploadPermitAttachment(userId: string, file: Buffer, contentType: string): Promise<string>
  getSignedPermitUrl(path: string): Promise<string | null>
  checkHealth(): Promise<boolean>
}

export type UserMetadataValue = string | number | boolean | null | undefined
export type UserMetadata = Record<string, UserMetadataValue>
