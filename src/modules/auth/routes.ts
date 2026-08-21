import { Hono } from 'hono'
import { successResponse } from '../../lib/http/responses.js'
import { AppError } from '../../lib/errors/app-error.js'
import { defaultProviders } from '../../providers/index.js'
import type { AppProviders } from '../../providers/types.js'
import type { AppEnv } from '../../types/context.js'
import { studentResetPasswordSchema, studentSignupSchema } from './schema.js'
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
