import { Hono } from 'hono'
import { auth } from '../../middleware/auth.js'
import { rateLimits } from '../../middleware/rate-limit.js'
import { successResponse } from '../../lib/http/responses.js'
import { AppError } from '../../lib/errors/app-error.js'
import { defaultProviders } from '../../providers/index.js'
import type { AppProviders } from '../../providers/types.js'
import { ClearAvatarSchema, UpdatePasswordSchema } from './schema.js'
import { changePassword, getProfile, updateAvatar } from './service.js'
import type { AppEnv } from '../../types/context.js'

export interface ProfileRouterDeps {
  providers?: AppProviders
}

export function createProfileRouter(deps: ProfileRouterDeps = {}) {
  const router = new Hono<AppEnv>()

  router.use('*', auth)

  // GET /v1/mobile/profile
  router.get('/', async (c) => {
    const userId = c.get('userId')
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const data = await getProfile(userId, providers)
    return successResponse(c, data, 'Profile retrieved.')
  })

  // PATCH /v1/mobile/profile/avatar
  router.patch('/avatar', rateLimits.profileAvatar, async (c) => {
    const userId = c.get('userId')
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const contentType = c.req.header('Content-Type') ?? ''

    if (contentType.includes('multipart/form-data')) {
      const form = await c.req.formData()
      const fileEntry = form.get('file')
      const clear = form.get('clear')

      if (clear === 'true') {
        await updateAvatar(userId, null, true, providers)
        return successResponse(c, { avatar_url: null }, 'Avatar cleared.')
      }

      if (!fileEntry || !(fileEntry instanceof Blob)) {
        throw AppError.validationError('File is required in multipart form.')
      }

      const arrayBuffer = await fileEntry.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const ct = fileEntry.type || 'application/octet-stream'

      const avatarUrl = await updateAvatar(userId, { buffer, contentType: ct }, false, providers)
      return successResponse(c, { avatar_url: avatarUrl }, 'Avatar updated.')
    }

    if (contentType.includes('application/json')) {
      const body = await c.req.json()
      const parsedClear = ClearAvatarSchema.safeParse(body)
      if (parsedClear.success && parsedClear.data.clear === true) {
        await updateAvatar(userId, null, true, providers)
        return successResponse(c, { avatar_url: null }, 'Avatar cleared.')
      }
      throw AppError.validationError('Expected { "clear": true } or multipart/form-data with file.')
    }

    throw AppError.validationError('Unsupported Content-Type.')
  })

  // PATCH /v1/mobile/profile/password
  router.patch('/password', rateLimits.profilePassword, async (c) => {
    const userId = c.get('userId')
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const body = await c.req.json()
    const parsed = UpdatePasswordSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }

    const profile = await providers.domainStore.getUserProfile(userId)
    await changePassword(
      userId,
      profile.email,
      parsed.data.current_password,
      parsed.data.new_password,
      providers,
    )

    return successResponse(c, null, 'Password updated successfully.')
  })

  return router
}

export const profileRouter = createProfileRouter()
