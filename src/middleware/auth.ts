import type { MiddlewareHandler } from 'hono'
import { defaultProviders } from '../providers/index.js'
import { env } from '../config/env.js'
import { AppError } from '../lib/errors/app-error.js'
import type { AppEnv } from '../types/context.js'

export const auth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    throw AppError.authRequired()
  }

  const token = authHeader.slice(7)
  const identityProvider =
    c.get('providers')?.identityProvider ?? defaultProviders.identityProvider

  try {
    const identityUser = await identityProvider.verifyToken(token)

    c.set('userId', identityUser.userId)
    c.set('rawToken', token)
    c.set('tenantKey', env.tenantKey)
  } catch (err) {
    if (err instanceof AppError) throw err
    throw AppError.authInvalid()
  }

  await next()
}
