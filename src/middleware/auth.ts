import type { MiddlewareHandler } from 'hono'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { env } from '../config/env.js'
import { AppError } from '../lib/errors/app-error.js'
import type { AppEnv } from '../types/context.js'

// Cache JWKS fetcher (initialized lazily)
let jwksGetter: ReturnType<typeof createRemoteJWKSet> | null = null

function getJwksGetter() {
  if (!jwksGetter && env.supabaseJwksUrl) {
    jwksGetter = createRemoteJWKSet(new URL(env.supabaseJwksUrl))
  }
  return jwksGetter
}

export const auth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    throw AppError.authRequired()
  }

  const token = authHeader.slice(7)

  try {
    let payload: Record<string, unknown>

    if (env.supabaseJwtSecret) {
      const secret = new TextEncoder().encode(env.supabaseJwtSecret)
      const { payload: p } = await jwtVerify(token, secret, {
        issuer: env.supabaseJwtIssuer,
        audience: env.supabaseJwtAudience,
      })
      payload = p
    } else {
      const jwks = getJwksGetter()!
      const { payload: p } = await jwtVerify(token, jwks, {
        issuer: env.supabaseJwtIssuer,
        audience: env.supabaseJwtAudience,
      })
      payload = p
    }

    const userId = payload['sub']
    if (typeof userId !== 'string' || !userId) {
      throw AppError.authInvalid('Token missing subject claim.')
    }

    c.set('userId', userId)
    c.set('rawToken', token)
  } catch (err) {
    if (err instanceof AppError) throw err
    throw AppError.authInvalid()
  }

  await next()
}
