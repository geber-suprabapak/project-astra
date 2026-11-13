import { z } from 'zod'

export const createManualAttendanceSchema = z
  .object({
    user_id: z.string().min(1, 'User ID is required.').optional(),
    userId: z.string().min(1, 'User ID is required.').optional(),
    action_type: z.enum(['check_in', 'check_out']).optional(),
    actionType: z.enum(['check_in', 'check_out']).optional(),
    status: z.enum(['Hadir', 'Terlambat', 'Pulang', 'Alpha']).optional(),
    reason: z.string().trim().min(3, 'Reason must be at least 3 characters.').max(500),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
      .optional(),
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
  .refine((data) => Boolean(data.attempt_id || data.attemptId), {
    message: 'Attendance attempt is required for manual attendance.',
    path: ['attempt_id'],
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

export const deleteAttendanceSchema = z.object({
  id: z.string().min(1, 'Attendance ID is required.'),
})

export type DeleteAttendanceInput = z.infer<typeof deleteAttendanceSchema>

export const bulkDeleteAttendanceSchema = z
  .object({
    ids: z.array(z.string().min(1, 'Attendance ID is required.')).min(1).max(1000),
  })
  .refine((value) => new Set(value.ids).size === value.ids.length, {
    message: 'Attendance IDs must be unique.',
    path: ['ids'],
  })

export type BulkDeleteAttendanceInput = z.infer<typeof bulkDeleteAttendanceSchema>
