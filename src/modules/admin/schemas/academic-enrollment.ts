import { z } from 'zod'

const dateYmdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
const absenceNumberInputSchema = z
  .string()
  .regex(/^[1-9][0-9]*$/, 'Absence number must be a positive integer')
  .nullable()
  .optional()

export const createAcademicPeriodSchema = z
  .object({
    school_id: z.string().min(1).optional(),
    schoolId: z.string().min(1).optional(),
    name: z.string().min(1, 'Academic period name is required.'),
    start_date: dateYmdSchema.optional(),
    startDate: dateYmdSchema.optional(),
    end_date: dateYmdSchema.optional(),
    endDate: dateYmdSchema.optional(),
    is_active: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Boolean(data.start_date || data.startDate), {
    message: 'Start date is required.',
    path: ['start_date'],
  })
  .refine((data) => Boolean(data.end_date || data.endDate), {
    message: 'End date is required.',
    path: ['end_date'],
  })

export type CreateAcademicPeriodInput = z.infer<typeof createAcademicPeriodSchema>

export const updateAcademicPeriodSchema = z.object({
  name: z.string().min(1).optional(),
  start_date: dateYmdSchema.optional(),
  startDate: dateYmdSchema.optional(),
  end_date: dateYmdSchema.optional(),
  endDate: dateYmdSchema.optional(),
  is_active: z.boolean().optional(),
  isActive: z.boolean().optional(),
  override_locked: z.boolean().optional(),
  overrideLocked: z.boolean().optional(),
  reason: z.string().trim().max(500).optional(),
})

export type UpdateAcademicPeriodInput = z.infer<typeof updateAcademicPeriodSchema>

export const periodLockReasonSchema = z.object({
  reason: z.string().trim().min(3, 'Reason must be at least 3 characters.').max(500),
})

export type PeriodLockReasonInput = z.infer<typeof periodLockReasonSchema>

export const academicPeriodResponseSchema = z.object({
  id: z.string(),
  school_id: z.string(),
  name: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  is_active: z.boolean(),
  is_locked: z.boolean().optional(),
  locked_at: z.string().nullable().optional(),
  locked_by: z.string().nullable().optional(),
  lock_reason: z.string().nullable().optional(),
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

export const deleteClassSchema = z.object({
  override_locked: z.boolean().optional(),
  overrideLocked: z.boolean().optional(),
  reason: z.string().trim().max(500).optional(),
})

export type DeleteClassInput = z.infer<typeof deleteClassSchema>

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

export const enrollStudentSchema = z
  .object({
    student_id: z.string().min(1).optional(),
    studentId: z.string().min(1).optional(),
    user_id: z.string().min(1).optional(),
    userId: z.string().min(1).optional(),
    class_id: z.string().min(1, 'Class ID is required.').optional(),
    classId: z.string().min(1, 'Class ID is required.').optional(),
    academic_period_id: z.string().min(1, 'Academic period ID is required.').optional(),
    academicPeriodId: z.string().min(1, 'Academic period ID is required.').optional(),
    absence_number: absenceNumberInputSchema,
    absenceNumber: absenceNumberInputSchema,
    effective_date: dateYmdSchema.optional(),
    effectiveDate: dateYmdSchema.optional(),
    override_locked: z.boolean().optional(),
    overrideLocked: z.boolean().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((data) => Boolean(data.student_id || data.studentId || data.user_id || data.userId), {
    message: 'Student ID or User ID is required.',
    path: ['student_id'],
  })
  .refine((data) => Boolean(data.class_id || data.classId), {
    message: 'Class ID is required.',
    path: ['class_id'],
  })
  .refine((data) => Boolean(data.academic_period_id || data.academicPeriodId), {
    message: 'Academic period ID is required.',
    path: ['academic_period_id'],
  })

export type EnrollStudentInput = z.infer<typeof enrollStudentSchema>

export const transferStudentEnrollmentSchema = z
  .object({
    student_id: z.string().min(1).optional(),
    studentId: z.string().min(1).optional(),
    user_id: z.string().min(1).optional(),
    userId: z.string().min(1).optional(),
    to_class_id: z.string().min(1, 'Target class ID is required.').optional(),
    toClassId: z.string().min(1, 'Target class ID is required.').optional(),
    academic_period_id: z.string().min(1, 'Academic period ID is required.').optional(),
    academicPeriodId: z.string().min(1, 'Academic period ID is required.').optional(),
    absence_number: absenceNumberInputSchema,
    absenceNumber: absenceNumberInputSchema,
    effective_date: dateYmdSchema.optional(),
    effectiveDate: dateYmdSchema.optional(),
    override_locked: z.boolean().optional(),
    overrideLocked: z.boolean().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((data) => Boolean(data.student_id || data.studentId || data.user_id || data.userId), {
    message: 'Student ID or User ID is required.',
    path: ['student_id'],
  })
  .refine((data) => Boolean(data.to_class_id || data.toClassId), {
    message: 'Target class ID is required.',
    path: ['to_class_id'],
  })
  .refine((data) => Boolean(data.academic_period_id || data.academicPeriodId), {
    message: 'Academic period ID is required.',
    path: ['academic_period_id'],
  })

export type TransferStudentEnrollmentInput = z.infer<typeof transferStudentEnrollmentSchema>

export const promoteStudentEnrollmentSchema = z
  .object({
    student_id: z.string().min(1).optional(),
    studentId: z.string().min(1).optional(),
    user_id: z.string().min(1).optional(),
    userId: z.string().min(1).optional(),
    from_academic_period_id: z.string().min(1, 'Source academic period ID is required.').optional(),
    fromAcademicPeriodId: z.string().min(1, 'Source academic period ID is required.').optional(),
    to_academic_period_id: z.string().min(1, 'Target academic period ID is required.').optional(),
    toAcademicPeriodId: z.string().min(1, 'Target academic period ID is required.').optional(),
    to_class_id: z.string().min(1, 'Target class ID is required.').optional(),
    toClassId: z.string().min(1, 'Target class ID is required.').optional(),
    absence_number: absenceNumberInputSchema,
    absenceNumber: absenceNumberInputSchema,
    effective_date: dateYmdSchema.optional(),
    effectiveDate: dateYmdSchema.optional(),
    override_locked: z.boolean().optional(),
    overrideLocked: z.boolean().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((data) => Boolean(data.student_id || data.studentId || data.user_id || data.userId), {
    message: 'Student ID or User ID is required.',
    path: ['student_id'],
  })
  .refine((data) => Boolean(data.from_academic_period_id || data.fromAcademicPeriodId), {
    message: 'Source academic period ID is required.',
    path: ['from_academic_period_id'],
  })
  .refine((data) => Boolean(data.to_academic_period_id || data.toAcademicPeriodId), {
    message: 'Target academic period ID is required.',
    path: ['to_academic_period_id'],
  })
  .refine((data) => Boolean(data.to_class_id || data.toClassId), {
    message: 'Target class ID is required.',
    path: ['to_class_id'],
  })

export type PromoteStudentEnrollmentInput = z.infer<typeof promoteStudentEnrollmentSchema>

export const exitStudentEnrollmentSchema = z
  .object({
    student_id: z.string().min(1).optional(),
    studentId: z.string().min(1).optional(),
    user_id: z.string().min(1).optional(),
    userId: z.string().min(1).optional(),
    academic_period_id: z.string().min(1, 'Academic period ID is required.').optional(),
    academicPeriodId: z.string().min(1, 'Academic period ID is required.').optional(),
    status: z.enum(['archived', 'graduated']).default('archived').optional(),
    effective_date: dateYmdSchema.optional(),
    effectiveDate: dateYmdSchema.optional(),
    override_locked: z.boolean().optional(),
    overrideLocked: z.boolean().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((data) => Boolean(data.student_id || data.studentId || data.user_id || data.userId), {
    message: 'Student ID or User ID is required.',
    path: ['student_id'],
  })
  .refine((data) => Boolean(data.academic_period_id || data.academicPeriodId), {
    message: 'Academic period ID is required.',
    path: ['academic_period_id'],
  })

export type ExitStudentEnrollmentInput = z.infer<typeof exitStudentEnrollmentSchema>

const batchClassMappingInputSchema = z.object({
  from_class_id: z.string().min(1),
  to_class_id: z.string().min(1).nullable(),
  action: z.enum(['promote', 'continue', 'graduate']),
})

const batchStudentOverrideInputSchema = z.object({
  student_id: z.string().min(1),
  action: z.enum(['retain', 'transfer', 'exit']),
  to_class_id: z.string().min(1).nullable().optional(),
  exit_status: z.enum(['graduated', 'archived']).optional(),
  absence_number: absenceNumberInputSchema,
  reason: z.string().trim().max(500).optional(),
})

export const batchTransitionPreviewSchema = z.object({
  from_academic_period_id: z.string().min(1),
  to_academic_period_id: z.string().min(1),
  mode: z.enum(['promote_to_next_year', 'continue_semester']),
  class_mappings: z.array(batchClassMappingInputSchema).optional(),
  overrides: z.array(batchStudentOverrideInputSchema).optional(),
  clear_conflicting_absence_numbers: z.boolean().optional(),
  effective_date: dateYmdSchema.optional(),
})

export type BatchTransitionPreviewInput = z.infer<typeof batchTransitionPreviewSchema>

export const batchTransitionCommitSchema = batchTransitionPreviewSchema.extend({
  source_hash: z.string().min(16, 'source_hash is required.'),
  override_locked: z.boolean().optional(),
  reason: z.string().trim().max(500).optional(),
})

export type BatchTransitionCommitInput = z.infer<typeof batchTransitionCommitSchema>

export const classEnrollmentStatusSchema = z.enum([
  'active',
  'transferred',
  'promoted',
  'graduated',
  'archived',
])

export const classEnrollmentResponseSchema = z.object({
  id: z.string(),
  student_id: z.string().nullable().optional(),
  user_id: z.string().nullable(),
  class_id: z.string(),
  academic_period_id: z.string(),
  absence_number: z.string().nullable().optional(),
  status: classEnrollmentStatusSchema,
  effective_start_date: z.string().nullable().optional(),
  effective_end_date: z.string().nullable().optional(),
  class_name: z.string().nullable().optional(),
  student_name: z.string().nullable().optional(),
  nis: z.string().nullable().optional(),
  period_name: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export type ClassEnrollmentResponse = z.infer<typeof classEnrollmentResponseSchema>
