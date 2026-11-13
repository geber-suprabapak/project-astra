import { z } from 'zod'

export const createAcademicPeriodSchema = z
  .object({
    school_id: z.string().min(1).optional(),
    schoolId: z.string().min(1).optional(),
    name: z.string().min(1, 'Academic period name is required.'),
    start_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD')
      .optional(),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD')
      .optional(),
    end_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD')
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD')
      .optional(),
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
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD')
    .optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD')
    .optional(),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD')
    .optional(),
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

export const enrollStudentSchema = z
  .object({
    user_id: z.string().min(1, 'User ID is required.').optional(),
    userId: z.string().min(1, 'User ID is required.').optional(),
    class_id: z.string().min(1, 'Class ID is required.').optional(),
    classId: z.string().min(1, 'Class ID is required.').optional(),
    academic_period_id: z.string().min(1, 'Academic period ID is required.').optional(),
    academicPeriodId: z.string().min(1, 'Academic period ID is required.').optional(),
  })
  .refine((data) => Boolean(data.user_id || data.userId), {
    message: 'User ID is required.',
    path: ['user_id'],
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
    user_id: z.string().min(1, 'User ID is required.').optional(),
    userId: z.string().min(1, 'User ID is required.').optional(),
    to_class_id: z.string().min(1, 'Target class ID is required.').optional(),
    toClassId: z.string().min(1, 'Target class ID is required.').optional(),
    academic_period_id: z.string().min(1, 'Academic period ID is required.').optional(),
    academicPeriodId: z.string().min(1, 'Academic period ID is required.').optional(),
  })
  .refine((data) => Boolean(data.user_id || data.userId), {
    message: 'User ID is required.',
    path: ['user_id'],
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
    user_id: z.string().min(1, 'User ID is required.').optional(),
    userId: z.string().min(1, 'User ID is required.').optional(),
    from_academic_period_id: z.string().min(1, 'Source academic period ID is required.').optional(),
    fromAcademicPeriodId: z.string().min(1, 'Source academic period ID is required.').optional(),
    to_academic_period_id: z.string().min(1, 'Target academic period ID is required.').optional(),
    toAcademicPeriodId: z.string().min(1, 'Target academic period ID is required.').optional(),
    to_class_id: z.string().min(1, 'Target class ID is required.').optional(),
    toClassId: z.string().min(1, 'Target class ID is required.').optional(),
  })
  .refine((data) => Boolean(data.user_id || data.userId), {
    message: 'User ID is required.',
    path: ['user_id'],
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
    user_id: z.string().min(1, 'User ID is required.').optional(),
    userId: z.string().min(1, 'User ID is required.').optional(),
    academic_period_id: z.string().min(1, 'Academic period ID is required.').optional(),
    academicPeriodId: z.string().min(1, 'Academic period ID is required.').optional(),
    status: z.enum(['archived', 'graduated']).default('archived').optional(),
  })
  .refine((data) => Boolean(data.user_id || data.userId), {
    message: 'User ID is required.',
    path: ['user_id'],
  })
  .refine((data) => Boolean(data.academic_period_id || data.academicPeriodId), {
    message: 'Academic period ID is required.',
    path: ['academic_period_id'],
  })

export type ExitStudentEnrollmentInput = z.infer<typeof exitStudentEnrollmentSchema>

export const classEnrollmentStatusSchema = z.enum([
  'active',
  'transferred',
  'promoted',
  'graduated',
  'archived',
])

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
