import { z } from 'zod'

export const updateStudentEmailSchema = z.object({
  email: z.string().trim().email('Valid email is required.'),
})

export type UpdateStudentEmailInput = z.infer<typeof updateStudentEmailSchema>

export const rejectStudentSchema = z.object({
  reason: z.string().trim().optional(),
})

export type RejectStudentInput = z.infer<typeof rejectStudentSchema>
