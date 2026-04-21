import { supabaseAdmin } from './admin.js'
import { env } from '../../config/env.js'
import { AppError } from '../../lib/errors/app-error.js'

const AVATAR_TTL_SECONDS = 86400 // 24h — matches mobile utils/avatar.ts
const PERMIT_TTL_SECONDS = 604800 // 7 days — matches mobile perizinan/izin.tsx

function avatarPath(userId: string, ext: string) {
  return `${userId}/avatar.${ext}`
}

function permitPath(userId: string, ext: string) {
  return `${userId}/${Date.now()}.${ext}`
}

function extFromContentType(contentType: string): string {
  if (contentType === 'image/png') return 'png'
  if (contentType === 'image/webp') return 'webp'
  return 'jpg'
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

export async function uploadAvatar(
  userId: string,
  file: Buffer,
  contentType: string,
): Promise<string> {
  const ext = extFromContentType(contentType)
  const path = avatarPath(userId, ext)

  const { error } = await supabaseAdmin.storage
    .from(env.supabaseBucketAvatars)
    .upload(path, file, { contentType, upsert: true })

  if (error) throw AppError.storageUploadFailed(error.message)
  return path
}

export async function deleteAvatar(userId: string): Promise<void> {
  // Delete all avatar variants for the user
  const { data: files } = await supabaseAdmin.storage
    .from(env.supabaseBucketAvatars)
    .list(userId)

  if (files && files.length > 0) {
    const paths = files.map((f) => `${userId}/${f.name}`)
    await supabaseAdmin.storage.from(env.supabaseBucketAvatars).remove(paths)
  }
}

export async function getSignedAvatarUrl(path: string): Promise<string | null> {
  if (!path) return null
  const { data, error } = await supabaseAdmin.storage
    .from(env.supabaseBucketAvatars)
    .createSignedUrl(path, AVATAR_TTL_SECONDS)

  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

// ---------------------------------------------------------------------------
// Permits
// ---------------------------------------------------------------------------

export async function uploadPermitAttachment(
  userId: string,
  file: Buffer,
  contentType: string,
): Promise<string> {
  const ext = extFromContentType(contentType)
  const path = permitPath(userId, ext)

  const { error } = await supabaseAdmin.storage
    .from(env.supabaseBucketPermits)
    .upload(path, file, { contentType, upsert: false })

  if (error) throw AppError.storageUploadFailed(error.message)
  return path
}

export async function getSignedPermitUrl(path: string): Promise<string | null> {
  if (!path) return null
  const { data, error } = await supabaseAdmin.storage
    .from(env.supabaseBucketPermits)
    .createSignedUrl(path, PERMIT_TTL_SECONDS)

  if (error || !data?.signedUrl) return null
  return data.signedUrl
}
