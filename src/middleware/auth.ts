import type { MiddlewareHandler } from 'hono'
import { defaultProviders } from '../providers/index.js'
import { env } from '../config/env.js'
import { AppError } from '../lib/errors/app-error.js'
import { ErrorCode } from '../lib/errors/codes.js'
import type { AppEnv } from '../types/context.js'
import type { IdentityUser } from '../providers/types.js'

export const auth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    throw AppError.authRequired()
  }

  const token = authHeader.slice(7)
  const providers = c.get('providers') ?? defaultProviders

  let identityUser: IdentityUser
  try {
    identityUser = await providers.identityProvider.verifyToken(token)
  } catch (err) {
    const isLegacyMobilePath = c.req.path.startsWith('/v1/mobile/')
    if (!isLegacyMobilePath || !providers.identityProvider.verifyLegacyToken) {
      if (err instanceof AppError) throw err
      throw AppError.authInvalid()
    }
    identityUser = await providers.identityProvider.verifyLegacyToken(token)
  }
  if (!identityUser.scopes || identityUser.scopes.length === 0) {
    throw AppError.authInvalid('Token missing scope claim.')
  }

  const userId = identityUser.legacyUserId
    ? await providers.domainStore.resolveLegacyUserId?.(identityUser.legacyUserId)
    : identityUser.userId
  if (!userId) {
    throw AppError.forbidden()
  }

  const isRevoked = await providers.domainStore.isSessionRevoked(userId)
  if (isRevoked) {
    throw AppError.authInvalid('Session has been revoked.')
  }

  let profile
  try {
    profile = await providers.domainStore.getUserProfile(userId)
  } catch (err) {
    if (err instanceof AppError && err.code === ErrorCode.RESOURCE_NOT_FOUND) {
      throw AppError.forbidden()
    }
    throw err
  }

  if (profile.lifecycle_status !== 'approved') {
    throw AppError.forbidden()
  }

  const userRoles = await providers.domainStore.getUserRoles(userId)
  const tokenRoles = new Set(identityUser.roles ?? [])
  // SAFETY: assigned role strings are checked against identity token role set
  const hasMatchingRole =
    Boolean(profile.role && tokenRoles.has(profile.role)) ||
    userRoles.some((r) => tokenRoles.has(r as NonNullable<IdentityUser['roles']>[number]))

  if (!hasMatchingRole) {
    throw AppError.forbidden()
  }

  c.set('userId', userId)
  c.set('rawToken', token)
  c.set('identityUser', identityUser)
  c.set('profileLifecycleStatus', profile.lifecycle_status)
  c.set('profileRole', profile.role ?? null)
  c.set('tenantKey', env.tenantKey)

  await next()
}
