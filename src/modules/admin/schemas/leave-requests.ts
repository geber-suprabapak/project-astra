import { z } from 'zod'
import {
  identityRoleSchema,
  leaveRequestApprovalStatusSchema,
  leaveRequestCategorySchema,
} from '../../../providers/types.js'

// Loose UUID shape (zod 3 `z.string().uuid()` semantics): zod 4's uuid()
// additionally requires valid version/variant nibbles.
const looseUuidSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/)

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
  requested_start_date: z.string().optional(),
  original_end_date: z.string().nullable().optional(),
  effective_end_date: z.string().nullable().optional(),
  duration_days: z.number().int().min(1).max(30).nullable().optional(),
  approval_status: z.enum(['pending', 'approved', 'rejected']),
  attachment_url: z.string().nullable().optional(),
  rejection_reason: z.string().nullable().optional(),
  rejected_at: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export type AdminLeaveRequestResponse = z.infer<typeof adminLeaveRequestResponseSchema>

export const leaveDecisionHistoryActionSchema = z.enum([
  'approve_leave_request',
  'reject_leave_request',
  'reopen_leave_request',
  'force_finish_leave_request',
])

export const adminLeaveDecisionHistoryEventSchema = z.object({
  action: leaveDecisionHistoryActionSchema,
  occurred_at: z.string().min(1),
  actor_name: z.string().nullable().catch(null),
  actor_role: identityRoleSchema.nullable().catch(null),
})

export type AdminLeaveDecisionHistoryEvent = z.infer<typeof adminLeaveDecisionHistoryEventSchema>

export const rejectLeaveRequestSchema = z.object({
  reason: z.string().min(1).optional(),
  rejection_reason: z.string().min(1).optional(),
})

export const approveLeaveRequestSchema = z
  .object({
    duration_days: z.number().int().min(1).max(30).optional(),
    durationDays: z.number().int().min(1).max(30).optional(),
  })
  .refine((data) => data.duration_days !== undefined || data.durationDays !== undefined, {
    message: 'Duration is required when approving a leave request.',
    path: ['duration_days'],
  })

const forceFinishDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD required')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  }, 'Date must be a valid calendar date.')

export const forceFinishLeaveRequestSchema = z
  .object({
    effective_end_date: forceFinishDateSchema.optional(),
    effectiveEndDate: forceFinishDateSchema.optional(),
    last_excused_date: forceFinishDateSchema.optional(),
    lastExcusedDate: forceFinishDateSchema.optional(),
    reason: z.string().trim().min(1).max(500),
  })
  .refine(
    (data) =>
      Boolean(
        data.effective_end_date ||
        data.effectiveEndDate ||
        data.last_excused_date ||
        data.lastExcusedDate,
      ),
    { message: 'Effective end date is required.', path: ['effective_end_date'] },
  )

export type RejectLeaveRequestInput = z.infer<typeof rejectLeaveRequestSchema>

export const createAdminLeaveRequestSchema = z
  .object({
    user_id: z.string().min(1, 'Target user_id is required').optional(),
    userId: z.string().min(1, 'Target user_id is required').optional(),
    category: leaveRequestCategorySchema,
    description: z.string().min(1, 'Description is required').max(1000),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD required'),
    file_id: looseUuidSchema.optional().nullable(),
    fileId: looseUuidSchema.optional().nullable(),
    // Administrative creation records the student's request only. Approval or
    // rejection must go through the role-checked transition endpoints.
    approval_status: leaveRequestApprovalStatusSchema.default('pending'),
    approvalStatus: leaveRequestApprovalStatusSchema.optional(),
  })
  .refine((data) => Boolean(data.user_id || data.userId), {
    message: 'Target user_id is required',
    path: ['user_id'],
  })

export type CreateAdminLeaveRequestInput = z.infer<typeof createAdminLeaveRequestSchema>
