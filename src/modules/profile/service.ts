import {
  getUserProfile,
  updateUserProfile,
} from '../../clients/supabase/admin.js'
import {
  deleteAvatar,
  getSignedAvatarUrl,
  uploadAvatar,
} from '../../clients/supabase/storage.js'
import { adminUpdatePassword, updateUserMetadata, verifyPassword } from '../../clients/supabase/auth.js'
import { AppError } from '../../lib/errors/app-error.js'
import {
  ALLOWED_AVATAR_TYPES,
  MAX_AVATAR_SIZE_BYTES,
} from './schema.js'

export interface ProfileResponse {
  user_id: string
  full_name: string | null
  email: string | null | undefined
  nis: string | null | undefined
  class_name: string | null | undefined
  absence_number: string | null | undefined
  gender: string | null | undefined
  role: string | null | undefined
  avatar_url: string | null
}

export async function getProfile(userId: string): Promise<ProfileResponse> {
  const profile = await getUserProfile(userId)
  const avatarUrl = profile.avatar_url
    ? await getSignedAvatarUrl(profile.avatar_url)
    : null

  return {
    user_id: profile.user_id,
    full_name: profile.full_name,
    email: profile.email,
    nis: profile.nis,
    class_name: profile.class_name,
    absence_number: profile.absence_number,
    gender: profile.gender,
    role: profile.role,
    avatar_url: avatarUrl,
  }
}

export async function updateAvatar(
  userId: string,
  file: { buffer: Buffer; contentType: string } | null,
  clear: boolean,
): Promise<string | null> {
  if (clear) {
    await deleteAvatar(userId)
    await updateUserProfile(userId, { avatar_url: null })
    await updateUserMetadata(userId, { avatar_url: null })
    return null
  }

  if (!file) throw AppError.validationError('File or clear:true is required.')

  if (!(ALLOWED_AVATAR_TYPES as readonly string[]).includes(file.contentType)) {
    throw AppError.validationError(
      `Unsupported file type. Allowed: ${ALLOWED_AVATAR_TYPES.join(', ')}.`,
    )
  }

  if (file.buffer.length > MAX_AVATAR_SIZE_BYTES) {
    throw AppError.validationError('Avatar file size must be under 5MB.')
  }

  const path = await uploadAvatar(userId, file.buffer, file.contentType)
  await updateUserProfile(userId, { avatar_url: path })
  await updateUserMetadata(userId, { avatar_url: path })

  const signedUrl = await getSignedAvatarUrl(path)
  return signedUrl
}

export async function changePassword(
  userId: string,
  email: string | null | undefined,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  if (!email) {
    throw AppError.internal('Cannot verify password — user email not found.')
  }
  await verifyPassword(email, currentPassword)
  await adminUpdatePassword(userId, newPassword)
}
