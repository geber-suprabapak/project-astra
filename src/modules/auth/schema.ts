import { z } from 'zod'

export const studentSignupSchema = z.object({
  nis: z.string().trim().min(1, 'NIS is required'),
  email: z.string().trim().email('Valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  full_name: z.string().trim().optional(),
})

export type StudentSignupInput = z.infer<typeof studentSignupSchema>

export const studentResetPasswordSchema = z.object({
  nis: z.string().trim().min(1, 'NIS is required'),
  code: z.string().trim().min(1, 'Reset code is required'),
  new_password: z.string().min(8, 'New password must be at least 8 characters'),
})
 
export const changePasswordSchema = z.object({
  new_password: z.string().min(8, 'New password must be at least 8 characters'),
})

export type StudentResetPasswordInput = z.infer<typeof studentResetPasswordSchema>
