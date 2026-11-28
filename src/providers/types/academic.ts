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
  is_locked?: boolean
  locked_at?: string | null
  locked_by?: string | null
  lock_reason?: string | null
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
  overrideLocked?: boolean
  reason?: string
}

export interface LockAcademicPeriodParams {
  id: string
  reason: string
  lockedBy: string
}

export interface UnlockAcademicPeriodParams {
  id: string
  reason: string
  unlockedBy: string
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
  effective_start_date?: string | null
  effective_end_date?: string | null
  created_at?: string
  updated_at?: string
  class_name?: string | null
  student_name?: string | null
  nis?: string | null
  period_name?: string | null
}

export interface EnrollStudentParams {
  studentId?: string
  userId?: string
  classId: string
  academicPeriodId: string
  absenceNumber?: string | null
  effectiveDate?: string
  overrideLocked?: boolean
  reason?: string
}

export interface CreateStudentParams {
  nis: string
  fullName: string
  gender: 'L' | 'P'
}

export interface TransferStudentEnrollmentParams {
  studentId?: string
  userId?: string
  fromClassId?: string
  toClassId: string
  academicPeriodId: string
  absenceNumber?: string | null
  effectiveDate?: string
  overrideLocked?: boolean
  reason?: string
}

export interface PromoteStudentEnrollmentParams {
  studentId?: string
  userId?: string
  fromAcademicPeriodId: string
  toAcademicPeriodId: string
  toClassId: string
  absenceNumber?: string | null
  effectiveDate?: string
  overrideLocked?: boolean
  reason?: string
}

export interface ExitStudentEnrollmentParams {
  studentId?: string
  userId?: string
  academicPeriodId: string
  status?: 'graduated' | 'archived'
  effectiveDate?: string
  overrideLocked?: boolean
  reason?: string
}

export type BatchTransitionMode = 'promote_to_next_year' | 'continue_semester'

export interface BatchClassMappingInput {
  from_class_id: string
  to_class_id: string | null
  action: 'promote' | 'continue' | 'graduate'
}

export interface BatchStudentOverrideInput {
  student_id: string
  action: 'retain' | 'transfer' | 'exit'
  to_class_id?: string | null
  exit_status?: 'graduated' | 'archived'
  absence_number?: string | null
  reason?: string
}

export interface BatchTransitionPreviewParams {
  fromAcademicPeriodId: string
  toAcademicPeriodId: string
  mode: BatchTransitionMode
  classMappings?: BatchClassMappingInput[]
  overrides?: BatchStudentOverrideInput[]
  clearConflictingAbsenceNumbers?: boolean
  effectiveDate?: string
}

export interface BatchTransitionCommitParams extends BatchTransitionPreviewParams {
  sourceHash: string
  overrideLocked?: boolean
  reason?: string
}

export interface BatchTransitionClassMappingItem {
  from_class_id: string
  from_class_name: string
  from_grade: number | null
  to_class_id: string | null
  to_class_name: string | null
  action: 'promote' | 'continue' | 'graduate'
  student_count: number
}

export interface BatchTransitionUnmappedClass {
  class_id: string
  name: string
  grade: number | null
  student_count: number
}

export interface BatchTransitionConflict {
  student_id: string
  nis: string | null
  full_name: string | null
  type: string
  message: string
}

export interface BatchTransitionPreviewItem {
  student_id: string
  user_id: string | null
  nis: string | null
  full_name: string | null
  from_class_id: string
  from_class_name: string
  to_class_id: string | null
  to_class_name: string | null
  action: 'promote' | 'continue' | 'retain' | 'transfer' | 'graduate' | 'exit'
  resolved_absence_number: string | null
  absence_number_cleared: boolean
  conflict: { type: string; message: string } | null
}

export interface BatchTransitionSummary {
  total: number
  promoted: number
  continued: number
  retained: number
  transferred: number
  graduated: number
  exited: number
  conflicts: number
  cleared_absence_numbers: number
}

export interface BatchTransitionPreview {
  source_hash: string
  from_period: AcademicPeriod
  to_period: AcademicPeriod
  requires_lock_override: boolean
  summary: BatchTransitionSummary
  class_mappings: BatchTransitionClassMappingItem[]
  unmapped_classes: BatchTransitionUnmappedClass[]
  items: BatchTransitionPreviewItem[]
  conflicts: BatchTransitionConflict[]
}

export interface BatchTransitionCommitResult {
  from_academic_period_id: string
  to_academic_period_id: string
  mode: BatchTransitionMode
  source_hash: string
  summary: BatchTransitionSummary
  created_count: number
  closed_count: number
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
