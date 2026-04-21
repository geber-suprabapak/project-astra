import { createClient } from '@supabase/supabase-js'
import { env } from '../../config/env.js'
import { AppError } from '../../lib/errors/app-error.js'

// Service-role client — used for all server-side data access
export const supabaseAdmin = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

// ---------------------------------------------------------------------------
// Type definitions (aligned to actual mobile schema)
// ---------------------------------------------------------------------------
export interface UserProfile {
  user_id: string
  full_name: string | null
  email?: string | null
  nis?: string | null
  class_name?: string | null
  absence_number?: string | null
  avatar_url?: string | null
  role?: string | null
  gender?: string | null
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

export interface AttendanceActionRpcResponse {
  actionable: boolean
  action_type: 'check_in' | 'check_out' | 'none'
  message: string
  details?: {
    location_name?: string
    status?: 'Hadir' | 'Terlambat'
  } | null
}

export interface SaveAttendanceRecordRpcResponse {
  success: boolean
  message?: string
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export async function getUserProfile(userId: string): Promise<UserProfile> {
  const response = await supabaseAdmin
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (response.error || !response.data) {
    throw AppError.notFound('User profile')
  }
  return response.data as UserProfile
}

export async function getTodayAbsences(userId: string, dateWIB: string): Promise<Absence[]> {
  const response = await supabaseAdmin
    .from('absences')
    .select('status, created_at')
    .eq('user_id', userId)
    .eq('date', dateWIB)
    .order('created_at', { ascending: true })

  if (response.error) throw AppError.internal(`Failed to query absences: ${response.error.message}`)
  return response.data ?? []
}

export async function getActiveSchedule(dayKey: string): Promise<Schedule | null> {
  const response = await supabaseAdmin
    .from('jadwal_absensi')
    .select('hari, mulai_masuk, selesai_masuk, mulai_pulang, selesai_pulang, kompensasi_waktu, is_active')
    .eq('hari', dayKey)
    .eq('is_active', true)
    .maybeSingle()

  if (response.error) throw AppError.internal(`Failed to query schedule: ${response.error.message}`)
  return response.data
}

export async function getActivePermitsToday(
  userId: string,
  startISO: string,
  endISO: string,
): Promise<ActivePermitSummary[]> {
  const response = await supabaseAdmin
    .from('perizinan')
    .select('id, approval_status, kategori_izin')
    .eq('user_id', userId)
    .in('approval_status', ['pending', 'approved'])
    .gte('tanggal', startISO)
    .lt('tanggal', endISO)

  if (response.error) throw AppError.internal(`Failed to query permits: ${response.error.message}`)
  return response.data ?? []
}

export async function getPermitHistory(userId: string): Promise<Permit[]> {
  const response = await supabaseAdmin
    .from('perizinan')
    .select('id, user_id, kategori_izin, deskripsi, status, link_foto, tanggal, approval_status, created_at, rejection_reason, rejected_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (response.error) throw AppError.internal(`Failed to query permit history: ${response.error.message}`)
  return response.data ?? []
}

export async function insertPermit(permitData: InsertPermitData): Promise<Permit> {
  const response = await supabaseAdmin
    .from('perizinan')
    .insert(permitData)
    .select()
    .single()

  if (response.error || !response.data) {
    throw AppError.internal(`Failed to insert permit: ${response.error?.message}`)
  }
  return response.data as Permit
}

export async function insertAttendance(attendanceData: InsertAttendanceData): Promise<Absence> {
  const response = await supabaseAdmin
    .from('absences')
    .insert({
      ...attendanceData,
      created_at: attendanceData.created_at ?? new Date().toISOString(),
    })
    .select()
    .single()

  if (response.error || !response.data) {
    throw AppError.internal(`Failed to insert attendance: ${response.error?.message}`)
  }
  return response.data as Absence
}

export async function validateAttendanceAction(params: {
  userId: string
  latitude: number
  longitude: number
}): Promise<AttendanceActionRpcResponse> {
  const response = await supabaseAdmin.rpc('get_and_validate_attendance_action', {
    p_user_id: params.userId,
    p_user_lat: params.latitude,
    p_user_lon: params.longitude,
  })

  if (response.error || !response.data) {
    throw AppError.internal(
      `Failed to validate attendance action: ${response.error?.message ?? 'No response returned.'}`,
    )
  }

  return response.data as AttendanceActionRpcResponse
}

export async function saveAttendanceRecord(params: {
  userId: string
  actionType: 'check_in' | 'check_out'
  latitude: number
  longitude: number
}): Promise<SaveAttendanceRecordRpcResponse> {
  const response = await supabaseAdmin.rpc('save_attendance_record', {
    p_user_id: params.userId,
    p_action_type: params.actionType,
    p_photo_path: null,
    p_latitude: params.latitude,
    p_longitude: params.longitude,
  })

  if (response.error || !response.data) {
    throw AppError.internal(
      `Failed to save attendance record: ${response.error?.message ?? 'No response returned.'}`,
    )
  }

  return response.data as SaveAttendanceRecordRpcResponse
}

export async function updateUserProfile(
  userId: string,
  updates: Partial<UserProfile>,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('user_profiles')
    .update(updates)
    .eq('user_id', userId)

  if (error) throw AppError.internal(`Failed to update profile: ${error.message}`)
}
