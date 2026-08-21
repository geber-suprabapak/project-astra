import type { MiddlewareHandler } from 'hono'
import { AppError } from '../lib/errors/app-error.js'
import type { AppEnv } from '../types/context.js'

export const privilegedAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const identityUser = c.get('identityUser')
  const profileRole = c.get('profileRole')

  if (!identityUser || !profileRole) {
    throw AppError.authRequired()
  }

  const tokenRoles = new Set(identityUser.roles ?? [])
  const hasMatchingPrivilegedRole =
    (profileRole === 'platform_admin' || profileRole === 'school_admin') &&
    tokenRoles.has(profileRole)

  if (
    !hasMatchingPrivilegedRole ||
    identityUser.scopes?.includes('admin:read') !== true ||
    identityUser.mustChangePassword !== false ||
    identityUser.mfaVerified !== true
  ) {
    throw AppError.forbidden()
  }

  await next()
}
