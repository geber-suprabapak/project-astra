import { z } from 'zod'

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
  student_id?: string | null
  user_id: string | null
  class_id: string
  academic_period_id: string
  absence_number?: string | null
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

export interface CreateStudentParams {
  nis: string
  fullName: string
  gender: 'L' | 'P'
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

export interface RosterRowInput {
  nis: string
  full_name: string
  class_name: string
  gender?: string | null
  absence_number?: string | number | null
  class_id?: string | null
  academic_period_id?: string | null
  grade?: number | null
}

export interface RejectedRosterRow {
  row_index: number
  nis?: string | null
  full_name?: string | null
  class_name?: string | null
  class_id?: string | null
  academic_period_id?: string | null
  gender?: string | null
  absence_number?: string | number | null
  grade?: number | null
  reason: string
}

export type RosterReportStatus = 'staged' | 'accepted' | 'rejected'
export type RosterReviewState = 'pending' | 'accepted' | 'rejected'

export interface RosterReport {
  id: string
  school_id?: string | null
  academic_period_id?: string | null
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
  academicPeriodId?: string | null
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
