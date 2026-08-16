import { createClient } from '@supabase/supabase-js'
import { env } from '../../config/env.js'
import { AppError } from '../../lib/errors/app-error.js'
import { supabaseAdmin } from './admin.js'

// Public client for password verification (uses user credentials only)
const supabaseAnon = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

export async function verifyPassword(email: string, password: string): Promise<void> {
  const { error } = await supabaseAnon.auth.signInWithPassword({ email, password })
  if (error) {
    throw AppError.authInvalid('Current password is incorrect.')
  }
}

export async function adminUpdatePassword(userId: string, newPassword: string): Promise<void> {
  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password: newPassword,
  })
  if (error) throw AppError.internal(`Failed to update password: ${error.message}`)
}

export type UserMetadata = Record<string, string | number | boolean | null | undefined>

export async function updateUserMetadata(userId: string, metadata: UserMetadata): Promise<void> {
  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    user_metadata: metadata,
  })
  if (error) throw AppError.internal(`Failed to update user metadata: ${error.message}`)
}
