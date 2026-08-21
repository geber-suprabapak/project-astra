import { Hono } from 'hono'
import { successResponse } from '../../lib/http/responses.js'
import { AppError } from '../../lib/errors/app-error.js'
import { auth } from '../../middleware/auth.js'
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

  // POST /signup
  router.post('/signup', async (c) => {
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
  router.post('/reset-password', async (c) => {
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
  router.post('/', async (c) => {
    const parsed = changePasswordSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const userId = c.get('userId')
    await providers.identityProvider.updatePassword(userId, parsed.data.new_password)
    await providers.identityProvider.updateUserMetadata(userId, { must_change_password: false })
    await providers.identityProvider.revokeUserSessions?.(userId)
    return successResponse(c, { success: true }, 'Password updated successfully.')
  })
  return router
}

export const passwordRouter = createPasswordRouter()
