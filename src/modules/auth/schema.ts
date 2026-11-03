import { z } from 'zod'

export const studentSignupSchema = z.object({
  nis: z.string().trim().min(1, 'NIS is required').max(64, 'NIS is too long'),
  email: z.string().trim().email('Valid email is required').max(254, 'Email is too long'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password is too long'),
  full_name: z.string().trim().max(200, 'Full name is too long').optional(),
})

export type StudentSignupInput = z.infer<typeof studentSignupSchema>

export const studentResetPasswordSchema = z.object({
  nis: z.string().trim().min(1, 'NIS is required').max(64, 'NIS is too long'),
  code: z.string().trim().min(1, 'Reset code is required').max(32, 'Reset code is too long'),
  new_password: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .max(128, 'New password is too long'),
})

export const changePasswordSchema = z.object({
  current_password: z
    .string()
    .min(1, 'Current password is required')
    .max(128, 'Current password is too long'),
  new_password: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .max(128, 'New password is too long'),
})

export type StudentResetPasswordInput = z.infer<typeof studentResetPasswordSchema>
