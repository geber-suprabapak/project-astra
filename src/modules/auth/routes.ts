import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { successResponse } from '../../lib/http/responses.js'
import { AppError } from '../../lib/errors/app-error.js'
import { auth } from '../../middleware/auth.js'
import { rateLimits } from '../../middleware/rate-limit.js'
import { defaultProviders } from '../../providers/index.js'
import type { AppProviders } from '../../providers/types.js'
import type { AppEnv } from '../../types/context.js'
import { changePasswordSchema, studentResetPasswordSchema, studentSignupSchema } from './schema.js'
import { registerStudent, resetStudentPassword } from './service.js'

export interface StudentAuthRouterDeps {
  providers?: AppProviders
}

export function createStudentAuthRouter(deps: StudentAuthRouterDeps = {}) {
  const router = new Hono<AppEnv>()

  router.use(
    '*',
    bodyLimit({
      maxSize: 32 * 1024,
      onError: () => {
        throw new AppError(
          'VALIDATION_ERROR',
          413,
          'Student auth request payload exceeds the 32KB limit.',
        )
      },
    }),
  )

  // POST /signup
  router.post('/signup', rateLimits.authSignup, async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const body = await c.req.json()
    const parsed = studentSignupSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }

    const profile = await registerStudent(parsed.data, providers)
    return successResponse(
      c,
      profile,
      'Student registration submitted successfully. Awaiting school administrator approval.',
      201,
    )
  })

  // POST /reset-password
  router.post('/reset-password', rateLimits.authResetPassword, async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const body = await c.req.json()
    const parsed = studentResetPasswordSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }

    const result = await resetStudentPassword(parsed.data, providers)
    return successResponse(c, result, result.message)
  })

  return router
}

export const studentAuthRouter = createStudentAuthRouter()

export function createPasswordRouter(deps: StudentAuthRouterDeps = {}) {
  const router = new Hono<AppEnv>()
  router.use('*', auth)
  router.use('*', rateLimits.profilePassword)
  router.post('/', async (c) => {
    const parsed = changePasswordSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const userId = c.get('userId')
    const profile = await providers.domainStore.getUserProfile(userId)
    if (!profile.email) {
      throw AppError.internal('Cannot verify password — user email not found.')
    }
    await providers.identityProvider.verifyPassword(profile.email, parsed.data.current_password)
    await providers.identityProvider.updatePassword(userId, parsed.data.new_password)
    await providers.identityProvider.updateUserMetadata(userId, { must_change_password: false })
    await providers.domainStore.revokeUserSessions(userId)
    await providers.identityProvider.revokeUserSessions?.(userId)
    await providers.domainStore.insertAuditLog({
      actor_id: userId,
      action: 'password_change',
      entity_type: 'profile',
      entity_id: userId,
      details: {},
    })
    return successResponse(c, { success: true }, 'Password updated successfully.')
  })
  return router
}

export const passwordRouter = createPasswordRouter()
