import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { auth } from '../../middleware/auth.js'
import { rateLimits } from '../../middleware/rate-limit.js'
import { parseJsonRequest, readFormDataRequest } from '../../lib/http/request.js'
import { successResponse } from '../../lib/http/responses.js'
import { AppError } from '../../lib/errors/app-error.js'
import { defaultProviders } from '../../providers/index.js'
import type { AppProviders } from '../../providers/types.js'
import { ClearAvatarSchema, UpdatePasswordSchema } from './schema.js'
import { changePassword, getProfile, getStudentEnrollmentHistory, updateAvatar } from './service.js'
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

  // GET /v1/mobile/profile/enrollments & GET /v1/mobile/profile/enrollment-history
  const handleEnrollments = async (c: any) => {
    const userId = c.get('userId')
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const items = await getStudentEnrollmentHistory(userId, providers)
    return successResponse(c, { items }, 'Student enrollment history retrieved.')
  }

  router.get('/enrollments', handleEnrollments)
  router.get('/enrollment-history', handleEnrollments)

  // PATCH /v1/mobile/profile/avatar
  router.patch(
    '/avatar',
    bodyLimit({
      maxSize: 6 * 1024 * 1024,
      onError: () => {
        throw new AppError('VALIDATION_ERROR', 413, 'Avatar payload exceeds the 6MB limit.')
      },
    }),
    rateLimits.profileAvatar,
    async (c) => {
      const userId = c.get('userId')
      const providers = deps.providers ?? c.get('providers') ?? defaultProviders
      const contentType = c.req.header('Content-Type') ?? ''

      if (contentType.includes('multipart/form-data')) {
        const form = await readFormDataRequest(c)
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
        const ct = (fileEntry.type || 'application/octet-stream').split(';')[0]!.trim()

        const avatarUrl = await updateAvatar(userId, { buffer, contentType: ct }, false, providers)
        return successResponse(c, { avatar_url: avatarUrl }, 'Avatar updated.')
      }

      if (contentType.includes('application/json')) {
        const parsedClear = await parseJsonRequest(c, ClearAvatarSchema).catch(() => null)
        if (parsedClear?.clear === true) {
          await updateAvatar(userId, null, true, providers)
          return successResponse(c, { avatar_url: null }, 'Avatar cleared.')
        }
        throw AppError.validationError(
          'Expected { "clear": true } or multipart/form-data with file.',
        )
      }

      throw AppError.validationError('Unsupported Content-Type.')
    },
  )

  // PATCH /v1/mobile/profile/password
  router.patch('/password', rateLimits.profilePassword, async (c) => {
    const userId = c.get('userId')
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const data = await parseJsonRequest(c, UpdatePasswordSchema)

    const profile = await providers.domainStore.getUserProfile(userId)
    await changePassword(userId, profile.email, data.current_password, data.new_password, providers)

    return successResponse(c, null, 'Password updated successfully.')
  })

  return router
}

export const profileRouter = createProfileRouter()
