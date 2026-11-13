import type { FileRecord } from './files-notifications.js'

export type AdiwiyataSiteCategory = 'tanaman' | 'lele'

export interface AdiwiyataSite {
  id: string
  school_id: string
  name: string
  category: AdiwiyataSiteCategory
  class_id: string | null
  is_active: boolean
  sort_order: number
  created_by: string | null
  created_at?: string
  updated_at?: string
}

export interface CreateAdiwiyataSiteParams {
  schoolId: string
  name: string
  category: AdiwiyataSiteCategory
  classId?: string | null
  sortOrder?: number
  createdBy: string
}

export interface UpdateAdiwiyataSiteParams {
  name?: string
  category?: AdiwiyataSiteCategory
  classId?: string | null
  sortOrder?: number
  isActive?: boolean
}

export interface AdiwiyataEligibility {
  id: string
  user_id: string
  added_by: string | null
  is_active: boolean
  created_at?: string
  updated_at?: string
}

export interface AdiwiyataReport {
  id: string
  site_id: string
  class_id: string
  reported_by: string
  file_id: string
  report_date: string
  created_at: string
  verified_at: string | null
  verified_by: string | null
}

export interface AdiwiyataAdminReport extends AdiwiyataReport {
  site_name: string
  category: AdiwiyataSiteCategory
  class_name: string
  uploader_name: string | null
  photo_file: FileRecord | null
}

export interface AdiwiyataReportVerificationParams {
  reportId: string
  schoolId: string
  actorId: string
  verified: boolean
  at: string
}

export interface AdiwiyataReportVerificationResult {
  report: AdiwiyataReport
  coverage_status: 'reported' | 'verified'
  changed: boolean
}

export interface SubmitAdiwiyataReportParams {
  reportId: string
  userId: string
  siteId: string
  classId: string
  profileName: string
  className: string
  reportDate: string
  createdAt: string
  fileId: string
  fileSizeBytes: number
}
