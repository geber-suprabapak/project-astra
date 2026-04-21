import { z } from 'zod'

export const UpdatePasswordSchema = z.object({
  current_password: z.string().min(1, 'Current password is required.'),
  new_password: z.string().min(8, 'New password must be at least 8 characters.'),
})

export const ClearAvatarSchema = z.object({
  clear: z.literal(true),
})

export const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024 // 5MB
