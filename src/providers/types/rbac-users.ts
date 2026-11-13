import type { IdentityRole, ProfileLifecycleStatus } from './common.js'

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

export interface Student {
  id: string
  nis: string
  full_name: string
  gender: 'L' | 'P'
  created_at?: string
  updated_at?: string
}

export interface StudentBinding {
  student_id: string
  user_id: string
  created_at?: string
  updated_at?: string
}

export interface IdentityUser {
  userId: string
  issuedAt?: number
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

export interface RosterStudent {
  student_id?: string | null
  nis: string
  full_name: string
  class_name: string
  grade?: number | null
  gender?: string | null
  user_id?: string | null
  academic_period_id?: string | null
  absence_number?: string | null
}

export interface StudentRosterRow {
  student_id: string | null
  user_id: string | null
  full_name: string | null
  email?: string | null
  nis?: string | null
  role?: IdentityRole | null
  lifecycle_status: ProfileLifecycleStatus | null
  gender?: string | null
  avatar_url?: string | null
  notification_token?: string | null
  class_name?: string | null
  class_id?: string | null
  academic_period_id?: string | null
  period_name?: string | null
  absence_number?: string | null
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
