import { z } from 'zod'

export const DashboardProfileSchema = z.object({
  user_id: z.string(),
  full_name: z.string().nullable(),
  email: z.string().nullable(),
  nis: z.string().nullable(),
  class_name: z.string().nullable(),
  absence_number: z.string().nullable(),
  avatar_url: z.string().nullable(),
  role: z.string().nullable(),
})

export const DashboardAttendanceSchema = z.object({
  today_status: z.enum(['pending', 'present', 'absent', 'leave']),
  has_checked_in: z.boolean(),
  has_checked_out: z.boolean(),
  check_in_time: z.string().nullable(),
  check_out_time: z.string().nullable(),
  total_work_hours: z.number().nullable(),
})

export const DashboardScheduleSchema = z.object({
  day_key: z.string(),
  start_check_in_at: z.string().nullable(),
  end_check_in_at: z.string().nullable(),
  start_check_out_at: z.string().nullable(),
  end_check_out_at: z.string().nullable(),
  compensation_minutes: z.number().nullable(),
})

export const DashboardFaceSchema = z.object({
  server_status: z.enum(['healthy', 'unhealthy']),
  enrollment_status: z.enum(['enrolled', 'not_enrolled']),
  message: z.string(),
})

export const DashboardPermitSchema = z.object({
  has_active_permit: z.boolean(),
  active_category: z.string().nullable(),
})

export const DashboardPrimaryActionSchema = z.union([
  z.object({
    allowed: z.literal(true),
    type: z.enum(['check_in', 'check_out']),
    label: z.string(),
    reason_code: z.null(),
    reason_message: z.null(),
  }),
  z.object({
    allowed: z.literal(false),
    type: z.null(),
    label: z.string(),
    reason_code: z.string(),
    reason_message: z.string(),
  }),
])

export const DashboardServerTimeSchema = z.object({
  now: z.string(),
  timezone: z.string(),
  source: z.literal('bff'),
})

export const DashboardResponseSchema = z.object({
  profile: DashboardProfileSchema,
  attendance: DashboardAttendanceSchema,
  schedule: DashboardScheduleSchema.nullable(),
  face: DashboardFaceSchema,
  permit: DashboardPermitSchema,
  primary_action: DashboardPrimaryActionSchema,
  server_time: DashboardServerTimeSchema,
})