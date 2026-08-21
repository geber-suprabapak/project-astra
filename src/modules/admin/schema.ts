import { z } from 'zod'
import {
  identityRoleSchema,
  notificationPayloadSchema,
  profileLifecycleStatusSchema,
} from '../../providers/types.js'

export const privilegedSessionSchema = z.object({
  user_id: z.string().min(1),
  role: identityRoleSchema.nullable(),
  profile_status: profileLifecycleStatusSchema,
  mfa_verified: z.boolean(),
  must_change_password: z.boolean(),
})

export type PrivilegedSession = z.infer<typeof privilegedSessionSchema>

export const bootstrapSchoolSchema = z.object({
  name: z.string().min(1, 'School name is required.'),
  slug: z
    .string()
    .min(1, 'School slug is required.')
    .regex(/^[a-z0-9-_]+$/, 'School slug must contain only lowercase letters, numbers, hyphens, and underscores.'),
  timezone: z.string().min(1).default('Asia/Jakarta').optional(),
})

export type BootstrapSchoolInput = z.infer<typeof bootstrapSchoolSchema>

export const createSchoolAdminSchema = z
  .object({
    user_id: z.string().min(1, 'User ID is required.').optional(),
    userId: z.string().min(1, 'User ID is required.').optional(),
    full_name: z.string().nullable().optional(),
    fullName: z.string().nullable().optional(),
    email: z.string().email().nullable().optional(),
  })
  .refine((data) => Boolean(data.user_id || data.userId), {
    message: 'User ID is required.',
    path: ['user_id'],
  })

export type CreateSchoolAdminInput = z.infer<typeof createSchoolAdminSchema>

export const rosterRowSchema = z.object({
  nis: z.string(),
  full_name: z.string(),
  class_name: z.string(),
  grade: z.number().int().positive().nullable().optional(),
})

export const stageRosterSchema = z.object({
  rows: z.array(rosterRowSchema).min(1, 'Roster must contain at least one row.'),
})

export type StageRosterInput = z.infer<typeof stageRosterSchema>

export const rosterReportResponseSchema = z.object({
  id: z.string(),
  school_id: z.string().nullable().optional(),
  total_rows: z.number(),
  valid_rows: z.number(),
  rejected_rows: z.number(),
  status: z.enum(['staged', 'accepted', 'rejected']),
  review_state: z.enum(['pending', 'accepted', 'rejected']),
  rejected_items: z.array(
    z.object({
      row_index: z.number(),
      nis: z.string().nullable().optional(),
      full_name: z.string().nullable().optional(),
      class_name: z.string().nullable().optional(),
      grade: z.number().nullable().optional(),
      reason: z.string(),
    }),
  ),
  accepted_at: z.string().nullable().optional(),
  accepted_by: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export type RosterReportResponse = z.infer<typeof rosterReportResponseSchema>

export const createRoleSchema = z.object({
  name: z
    .string()
    .min(1, 'Role name is required.')
    .regex(/^[a-z0-9-_]+$/, 'Role name must be lowercase alphanumeric with hyphens or underscores.'),
  description: z.string().nullable().optional(),
  permissions: z.array(z.string().min(1)).optional(),
})

export type CreateRoleInput = z.infer<typeof createRoleSchema>

export const updateRoleSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-_]+$/, 'Role name must be lowercase alphanumeric with hyphens or underscores.')
    .optional(),
  description: z.string().nullable().optional(),
  permissions: z.array(z.string().min(1)).optional(),
  is_active: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>

export const roleResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  is_active: z.boolean(),
  permissions: z.array(z.string()).optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export type RoleResponse = z.infer<typeof roleResponseSchema>

export const createPermissionSchema = z.object({
  name: z.string().min(1, 'Permission name is required.'),
  description: z.string().nullable().optional(),
})

export type CreatePermissionInput = z.infer<typeof createPermissionSchema>

export const permissionResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export type PermissionResponse = z.infer<typeof permissionResponseSchema>

export const createStaffSchema = z
  .object({
    user_id: z.string().min(1).optional(),
    userId: z.string().min(1).optional(),
    email: z.string().email('Valid email is required.'),
    full_name: z.string().min(1).nullable().optional(),
    fullName: z.string().min(1).nullable().optional(),
    role: z.string().min(1, 'Role is required.'),
    roles: z.array(z.string().min(1)).optional(),
    gender: z.string().nullable().optional(),
    password: z.string().min(6).optional(),
  })
  .refine((data) => Boolean(data.full_name || data.fullName), {
    message: 'Full name is required.',
    path: ['full_name'],
  })

export type CreateStaffInput = z.infer<typeof createStaffSchema>

export const updateStaffSchema = z.object({
  full_name: z.string().min(1).nullable().optional(),
  fullName: z.string().min(1).nullable().optional(),
  role: z.string().min(1).optional(),
  roles: z.array(z.string().min(1)).optional(),
  lifecycle_status: profileLifecycleStatusSchema.optional(),
  lifecycleStatus: profileLifecycleStatusSchema.optional(),
  gender: z.string().nullable().optional(),
})

export type UpdateStaffInput = z.infer<typeof updateStaffSchema>

export const staffResponseSchema = z.object({
  user_id: z.string(),
  full_name: z.string().nullable(),
  email: z.string().nullable().optional(),
  nis: z.string().nullable().optional(),
  class_name: z.string().nullable().optional(),
  absence_number: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  lifecycle_status: profileLifecycleStatusSchema,
  gender: z.string().nullable().optional(),
  roles: z.array(z.string()).optional(),
  effective_permissions: z.array(z.string()).optional(),
})

export type StaffResponse = z.infer<typeof staffResponseSchema>

export const requestStaffPasswordResetSchema = z.object({
  email: z.string().email().optional(),
})

export type RequestStaffPasswordResetInput = z.infer<typeof requestStaffPasswordResetSchema>

export const effectivePermissionsResponseSchema = z.object({
  user_id: z.string(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
})

export type EffectivePermissionsResponse = z.infer<typeof effectivePermissionsResponseSchema>

export const updateStudentEmailSchema = z.object({
  email: z.string().trim().email('Valid email is required.'),
})

export type UpdateStudentEmailInput = z.infer<typeof updateStudentEmailSchema>

export const rejectStudentSchema = z.object({
  reason: z.string().trim().optional(),
})

export type RejectStudentInput = z.infer<typeof rejectStudentSchema>

// ---------------------------------------------------------------------------
// Academic Attendance Policy Schemas
// ---------------------------------------------------------------------------

export const createAcademicPeriodSchema = z.object({
  school_id: z.string().min(1).optional(),
  schoolId: z.string().min(1).optional(),
  name: z.string().min(1, 'Academic period name is required.'),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD').optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD').optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD').optional(),
  is_active: z.boolean().optional(),
  isActive: z.boolean().optional(),
}).refine((data) => Boolean(data.start_date || data.startDate), {
  message: 'Start date is required.',
  path: ['start_date'],
}).refine((data) => Boolean(data.end_date || data.endDate), {
  message: 'End date is required.',
  path: ['end_date'],
})

export type CreateAcademicPeriodInput = z.infer<typeof createAcademicPeriodSchema>

export const updateAcademicPeriodSchema = z.object({
  name: z.string().min(1).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD').optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD').optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD').optional(),
  is_active: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

export type UpdateAcademicPeriodInput = z.infer<typeof updateAcademicPeriodSchema>

export const academicPeriodResponseSchema = z.object({
  id: z.string(),
  school_id: z.string(),
  name: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  is_active: z.boolean(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export type AcademicPeriodResponse = z.infer<typeof academicPeriodResponseSchema>

export const createClassSchema = z.object({
  school_id: z.string().min(1).optional(),
  schoolId: z.string().min(1).optional(),
  academic_period_id: z.string().min(1).nullable().optional(),
  academicPeriodId: z.string().min(1).nullable().optional(),
  name: z.string().min(1, 'Class name is required.'),
  grade: z.number().int().positive().nullable().optional(),
})

export type CreateClassInput = z.infer<typeof createClassSchema>

export const updateClassSchema = z.object({
  name: z.string().min(1).optional(),
  grade: z.number().int().positive().nullable().optional(),
  academic_period_id: z.string().min(1).nullable().optional(),
  academicPeriodId: z.string().min(1).nullable().optional(),
})

export type UpdateClassInput = z.infer<typeof updateClassSchema>

export const classResponseSchema = z.object({
  id: z.string(),
  school_id: z.string(),
  academic_period_id: z.string().nullable().optional(),
  name: z.string(),
  grade: z.number().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export type ClassResponse = z.infer<typeof classResponseSchema>

export const enrollStudentSchema = z.object({
  user_id: z.string().min(1, 'User ID is required.').optional(),
  userId: z.string().min(1, 'User ID is required.').optional(),
  class_id: z.string().min(1, 'Class ID is required.').optional(),
  classId: z.string().min(1, 'Class ID is required.').optional(),
  academic_period_id: z.string().min(1, 'Academic period ID is required.').optional(),
  academicPeriodId: z.string().min(1, 'Academic period ID is required.').optional(),
}).refine((data) => Boolean(data.user_id || data.userId), {
  message: 'User ID is required.',
  path: ['user_id'],
}).refine((data) => Boolean(data.class_id || data.classId), {
  message: 'Class ID is required.',
  path: ['class_id'],
}).refine((data) => Boolean(data.academic_period_id || data.academicPeriodId), {
  message: 'Academic period ID is required.',
  path: ['academic_period_id'],
})

export type EnrollStudentInput = z.infer<typeof enrollStudentSchema>

export const transferStudentEnrollmentSchema = z.object({
  user_id: z.string().min(1, 'User ID is required.').optional(),
  userId: z.string().min(1, 'User ID is required.').optional(),
  to_class_id: z.string().min(1, 'Target class ID is required.').optional(),
  toClassId: z.string().min(1, 'Target class ID is required.').optional(),
  academic_period_id: z.string().min(1, 'Academic period ID is required.').optional(),
  academicPeriodId: z.string().min(1, 'Academic period ID is required.').optional(),
}).refine((data) => Boolean(data.user_id || data.userId), {
  message: 'User ID is required.',
  path: ['user_id'],
}).refine((data) => Boolean(data.to_class_id || data.toClassId), {
  message: 'Target class ID is required.',
  path: ['to_class_id'],
}).refine((data) => Boolean(data.academic_period_id || data.academicPeriodId), {
  message: 'Academic period ID is required.',
  path: ['academic_period_id'],
})

export type TransferStudentEnrollmentInput = z.infer<typeof transferStudentEnrollmentSchema>

export const promoteStudentEnrollmentSchema = z.object({
  user_id: z.string().min(1, 'User ID is required.').optional(),
  userId: z.string().min(1, 'User ID is required.').optional(),
  from_academic_period_id: z.string().min(1, 'Source academic period ID is required.').optional(),
  fromAcademicPeriodId: z.string().min(1, 'Source academic period ID is required.').optional(),
  to_academic_period_id: z.string().min(1, 'Target academic period ID is required.').optional(),
  toAcademicPeriodId: z.string().min(1, 'Target academic period ID is required.').optional(),
  to_class_id: z.string().min(1, 'Target class ID is required.').optional(),
  toClassId: z.string().min(1, 'Target class ID is required.').optional(),
}).refine((data) => Boolean(data.user_id || data.userId), {
  message: 'User ID is required.',
  path: ['user_id'],
}).refine((data) => Boolean(data.from_academic_period_id || data.fromAcademicPeriodId), {
  message: 'Source academic period ID is required.',
  path: ['from_academic_period_id'],
}).refine((data) => Boolean(data.to_academic_period_id || data.toAcademicPeriodId), {
  message: 'Target academic period ID is required.',
  path: ['to_academic_period_id'],
}).refine((data) => Boolean(data.to_class_id || data.toClassId), {
  message: 'Target class ID is required.',
  path: ['to_class_id'],
})

export type PromoteStudentEnrollmentInput = z.infer<typeof promoteStudentEnrollmentSchema>

export const exitStudentEnrollmentSchema = z.object({
  user_id: z.string().min(1, 'User ID is required.').optional(),
  userId: z.string().min(1, 'User ID is required.').optional(),
  academic_period_id: z.string().min(1, 'Academic period ID is required.').optional(),
  academicPeriodId: z.string().min(1, 'Academic period ID is required.').optional(),
  status: z.enum(['archived', 'graduated']).default('archived').optional(),
}).refine((data) => Boolean(data.user_id || data.userId), {
  message: 'User ID is required.',
  path: ['user_id'],
}).refine((data) => Boolean(data.academic_period_id || data.academicPeriodId), {
  message: 'Academic period ID is required.',
  path: ['academic_period_id'],
})

export type ExitStudentEnrollmentInput = z.infer<typeof exitStudentEnrollmentSchema>

export const classEnrollmentStatusSchema = z.enum(['active', 'transferred', 'promoted', 'graduated', 'archived'])

export const classEnrollmentResponseSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  class_id: z.string(),
  academic_period_id: z.string(),
  status: classEnrollmentStatusSchema,
  class_name: z.string().nullable().optional(),
  student_name: z.string().nullable().optional(),
  nis: z.string().nullable().optional(),
  period_name: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export type ClassEnrollmentResponse = z.infer<typeof classEnrollmentResponseSchema>

export const createScheduleSchema = z.object({
  school_id: z.string().min(1).nullable().optional(),
  schoolId: z.string().min(1).nullable().optional(),
  class_id: z.string().min(1).nullable().optional(),
  classId: z.string().min(1).nullable().optional(),
  academic_period_id: z.string().min(1).nullable().optional(),
  academicPeriodId: z.string().min(1).nullable().optional(),
  location_id: z.string().min(1).nullable().optional(),
  locationId: z.string().min(1).nullable().optional(),
  day_of_week: z.string().min(1).optional(),
  dayOfWeek: z.string().min(1).optional(),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time format must be HH:mm or HH:mm:ss').optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time format must be HH:mm or HH:mm:ss').optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time format must be HH:mm or HH:mm:ss').optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time format must be HH:mm or HH:mm:ss').optional(),
  start_checkout: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time format must be HH:mm or HH:mm:ss').optional(),
  startCheckout: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time format must be HH:mm or HH:mm:ss').optional(),
  end_checkout: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time format must be HH:mm or HH:mm:ss').optional(),
  endCheckout: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time format must be HH:mm or HH:mm:ss').optional(),
  grace_period_minutes: z.number().int().min(0).default(0).optional(),
  gracePeriodMinutes: z.number().int().min(0).default(0).optional(),
  is_active: z.boolean().default(true).optional(),
  isActive: z.boolean().default(true).optional(),
}).refine((data) => Boolean(data.day_of_week || data.dayOfWeek), {
  message: 'Day of week is required.',
  path: ['day_of_week'],
}).refine((data) => Boolean(data.start_time || data.startTime), {
  message: 'Start time is required.',
  path: ['start_time'],
}).refine((data) => Boolean(data.end_time || data.endTime), {
  message: 'End time is required.',
  path: ['end_time'],
}).refine((data) => Boolean(data.start_checkout || data.startCheckout), {
  message: 'Start checkout is required.',
  path: ['start_checkout'],
}).refine((data) => Boolean(data.end_checkout || data.endCheckout), {
  message: 'End checkout is required.',
  path: ['end_checkout'],
})

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>

export const updateScheduleSchema = z.object({
  class_id: z.string().min(1).nullable().optional(),
  classId: z.string().min(1).nullable().optional(),
  academic_period_id: z.string().min(1).nullable().optional(),
  academicPeriodId: z.string().min(1).nullable().optional(),
  location_id: z.string().min(1).nullable().optional(),
  locationId: z.string().min(1).nullable().optional(),
  day_of_week: z.string().min(1).optional(),
  dayOfWeek: z.string().min(1).optional(),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  start_checkout: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  startCheckout: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  end_checkout: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  endCheckout: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  grace_period_minutes: z.number().int().min(0).optional(),
  gracePeriodMinutes: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>

export const scheduleResponseSchema = z.object({
  id: z.string(),
  school_id: z.string().nullable().optional(),
  class_id: z.string().nullable().optional(),
  academic_period_id: z.string().nullable().optional(),
  location_id: z.string().nullable().optional(),
  day_of_week: z.string().optional(),
  hari: z.string().optional(),
  mulai_masuk: z.string().nullable().optional(),
  selesai_masuk: z.string().nullable().optional(),
  mulai_pulang: z.string().nullable().optional(),
  selesai_pulang: z.string().nullable().optional(),
  kompensasi_waktu: z.number().nullable().optional(),
  is_active: z.boolean(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export type ScheduleResponse = z.infer<typeof scheduleResponseSchema>

export const createLocationSchema = z.object({
  school_id: z.string().min(1).nullable().optional(),
  schoolId: z.string().min(1).nullable().optional(),
  name: z.string().min(1, 'Location name is required.'),
  latitude: z.number({ required_error: 'Latitude is required.' }),
  longitude: z.number({ required_error: 'Longitude is required.' }),
  radius_meters: z.number().positive().default(100.0).optional(),
  radiusMeters: z.number().positive().default(100.0).optional(),
  is_active: z.boolean().default(true).optional(),
  isActive: z.boolean().default(true).optional(),
})

export type CreateLocationInput = z.infer<typeof createLocationSchema>

export const updateLocationSchema = z.object({
  name: z.string().min(1).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  radius_meters: z.number().positive().optional(),
  radiusMeters: z.number().positive().optional(),
  is_active: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

export type UpdateLocationInput = z.infer<typeof updateLocationSchema>

export const locationResponseSchema = z.object({
  id: z.string(),
  school_id: z.string().nullable().optional(),
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  radius_meters: z.number(),
  is_active: z.boolean(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export type LocationResponse = z.infer<typeof locationResponseSchema>

export const createCalendarExceptionSchema = z.object({
  school_id: z.string().min(1).nullable().optional(),
  schoolId: z.string().min(1).nullable().optional(),
  academic_period_id: z.string().min(1).nullable().optional(),
  academicPeriodId: z.string().min(1).nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  reason: z.string().min(1, 'Reason is required.'),
  is_holiday: z.boolean().default(true).optional(),
  isHoliday: z.boolean().default(true).optional(),
})

export type CreateCalendarExceptionInput = z.infer<typeof createCalendarExceptionSchema>

export const updateCalendarExceptionSchema = z.object({
  academic_period_id: z.string().min(1).nullable().optional(),
  academicPeriodId: z.string().min(1).nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  reason: z.string().min(1).optional(),
  is_holiday: z.boolean().optional(),
  isHoliday: z.boolean().optional(),
})

export type UpdateCalendarExceptionInput = z.infer<typeof updateCalendarExceptionSchema>

export const calendarExceptionResponseSchema = z.object({
  id: z.string(),
  school_id: z.string().nullable().optional(),
  academic_period_id: z.string().nullable().optional(),
  date: z.string(),
  reason: z.string(),
  is_holiday: z.boolean(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export type CalendarExceptionResponse = z.infer<typeof calendarExceptionResponseSchema>

// ---------------------------------------------------------------------------
// Manual Attendance & Attendance Attempts Schemas
// ---------------------------------------------------------------------------

export const createManualAttendanceSchema = z
  .object({
    user_id: z.string().min(1, 'User ID is required.').optional(),
    userId: z.string().min(1, 'User ID is required.').optional(),
    action_type: z.enum(['check_in', 'check_out']).optional(),
    actionType: z.enum(['check_in', 'check_out']).optional(),
    status: z.enum(['Hadir', 'Terlambat', 'Pulang', 'Alpha']).optional(),
    reason: z.string().min(3, 'Reason must be at least 3 characters.').max(500),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
    attempt_id: z.string().min(1).nullable().optional(),
    attemptId: z.string().min(1).nullable().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
  })
  .refine((data) => Boolean(data.user_id || data.userId), {
    message: 'User ID is required.',
    path: ['user_id'],
  })
  .refine((data) => Boolean(data.action_type || data.actionType), {
    message: 'Action type is required.',
    path: ['action_type'],
  })

export type CreateManualAttendanceInput = z.infer<typeof createManualAttendanceSchema>

export const attendanceAttemptResponseSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  action_type: z.enum(['check_in', 'check_out']),
  status: z.enum(['success', 'failed', 'error']),
  reason: z.string().nullable().optional(),
  quality_score: z.number().nullable().optional(),
  confidence: z.number().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  process_time_ms: z.number().nullable().optional(),
  created_at: z.string().optional(),
})

export type AttendanceAttemptResponse = z.infer<typeof attendanceAttemptResponseSchema>

export const attendanceResponseSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  date: z.string(),
  status: z.enum(['Hadir', 'Terlambat', 'Pulang', 'Alpha']),
  action_type: z.enum(['check_in', 'check_out']).nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  created_at: z.string().optional(),
})

export type AttendanceResponse = z.infer<typeof attendanceResponseSchema>

// ---------------------------------------------------------------------------
// Leave Requests Admin Schemas
// ---------------------------------------------------------------------------

export const adminLeaveRequestResponseSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  student_name: z.string().nullable().optional(),
  student_nis: z.string().nullable().optional(),
  student_class: z.string().nullable().optional(),
  absence_number: z.string().nullable().optional(),
  category: z.enum(['sakit', 'pergi', 'dispensasi', 'lainnya']),
  description: z.string(),
  status: z.boolean(),
  date: z.string(),
  approval_status: z.enum(['pending', 'approved', 'rejected']),
  attachment_url: z.string().nullable().optional(),
  rejection_reason: z.string().nullable().optional(),
  rejected_at: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export type AdminLeaveRequestResponse = z.infer<typeof adminLeaveRequestResponseSchema>

export const rejectLeaveRequestSchema = z.object({
  reason: z.string().min(1).optional(),
  rejection_reason: z.string().min(1).optional(),
})

export type RejectLeaveRequestInput = z.infer<typeof rejectLeaveRequestSchema>

// ---------------------------------------------------------------------------
// Notification Outbox Admin Schemas
// ---------------------------------------------------------------------------

export const enqueueAdminNotificationSchema = z
  .object({
    user_id: z.string().min(1, 'User ID is required.').optional(),
    userId: z.string().min(1, 'User ID is required.').optional(),
    channel: z.enum(['push', 'email']),
    payload: notificationPayloadSchema.refine((obj) => Object.keys(obj).length > 0, {
      message: 'Payload cannot be empty.',
    }),
    next_retry_at: z.string().datetime().optional(),
    nextRetryAt: z.string().datetime().optional(),
  })
  .refine((data) => Boolean(data.user_id || data.userId), {
    message: 'User ID is required.',
    path: ['user_id'],
  })

export type EnqueueAdminNotificationInput = z.infer<typeof enqueueAdminNotificationSchema>

export const notificationResponseSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  channel: z.enum(['push', 'email']),
  payload: notificationPayloadSchema,
  status: z.enum(['pending', 'processing', 'delivered', 'failed']),
  retry_count: z.number(),
  next_retry_at: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export type NotificationResponse = z.infer<typeof notificationResponseSchema>



