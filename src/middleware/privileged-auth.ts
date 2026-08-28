import type { MiddlewareHandler } from 'hono'
import { hasScope, logtoScopes } from '../authz/scopes.js'
import { AppError } from '../lib/errors/app-error.js'
import type { AppEnv } from '../types/context.js'

export const privilegedAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const identityUser = c.get('identityUser')
  if (!identityUser) {
    throw AppError.authRequired()
  }

  if (!hasScope(identityUser.scopes, logtoScopes.adminRead)) {
    throw AppError.forbidden()
  }

  await next()
}
