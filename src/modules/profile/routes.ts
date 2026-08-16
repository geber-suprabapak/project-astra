import { Hono } from 'hono'
import { auth } from '../../middleware/auth.js'
import { rateLimits } from '../../middleware/rate-limit.js'
import { successResponse } from '../../lib/http/responses.js'
import { AppError } from '../../lib/errors/app-error.js'
import { ClearAvatarSchema, UpdatePasswordSchema } from './schema.js'
import { changePassword, getProfile, updateAvatar } from './service.js'
import { getUserProfile } from '../../clients/supabase/admin.js'
import type { AppEnv } from '../../types/context.js'

export const profileRouter = new Hono<AppEnv>()

profileRouter.use('*', auth)

// GET /v1/mobile/profile
profileRouter.get('/', async (c) => {
  const userId = c.get('userId')
  const data = await getProfile(userId)
  return successResponse(c, data, 'Profile retrieved.')
})

// PATCH /v1/mobile/profile/avatar
profileRouter.patch('/avatar', rateLimits.profileAvatar, async (c) => {
  const userId = c.get('userId')
  const contentType = c.req.header('Content-Type') ?? ''

  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData()
    const fileEntry = form.get('file')
    const clear = form.get('clear')

    if (clear === 'true') {
      await updateAvatar(userId, null, true)
      return successResponse(c, { avatar_url: null }, 'Avatar cleared.')
    }

    if (!fileEntry || !(fileEntry instanceof Blob)) {
      throw AppError.validationError('File is required in multipart form.')
    }

    const arrayBuffer = await fileEntry.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const ct = fileEntry.type || 'application/octet-stream'

    const avatarUrl = await updateAvatar(userId, { buffer, contentType: ct }, false)
    return successResponse(c, { avatar_url: avatarUrl }, 'Avatar updated.')
  }

  if (contentType.includes('application/json')) {
    const body = await c.req.json()
    const parsedClear = ClearAvatarSchema.safeParse(body)
    if (parsedClear.success && parsedClear.data.clear === true) {
      await updateAvatar(userId, null, true)
      return successResponse(c, { avatar_url: null }, 'Avatar cleared.')
    }
    throw AppError.validationError('Expected { "clear": true } or multipart/form-data with file.')
  }

  throw AppError.validationError('Unsupported Content-Type.')
})

// PATCH /v1/mobile/profile/password
profileRouter.patch('/password', rateLimits.profilePassword, async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json()
  const parsed = UpdatePasswordSchema.safeParse(body)
  if (!parsed.success) {
    throw AppError.validationError(parsed.error.flatten())
  }

  // Need email for verifyPassword
  const profile = await getUserProfile(userId)
  await changePassword(
    userId,
    profile.email,
    parsed.data.current_password,
    parsed.data.new_password,
  )

  return successResponse(c, null, 'Password updated successfully.')
})
