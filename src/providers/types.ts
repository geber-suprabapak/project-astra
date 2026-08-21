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

export interface DomainStore {
  getUserProfile(userId: string): Promise<UserProfile>
  updateUserProfile(userId: string, updates: Partial<UserProfile>): Promise<void>
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
