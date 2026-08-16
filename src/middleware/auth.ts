import type { MiddlewareHandler } from 'hono'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { z } from 'zod'
import { env } from '../config/env.js'
import { AppError } from '../lib/errors/app-error.js'
import type { AppEnv } from '../types/context.js'

interface JwtVerifyConfig {
  audience: string
  issuer?: string
}

function createJwtVerifyOptions(): JwtVerifyConfig {
  const options: JwtVerifyConfig = {
    audience: env.supabaseJwtAudience,
  }
  if (env.supabaseJwtIssuer) {
    options.issuer = env.supabaseJwtIssuer
  }
  return options
}

const jwtVerifyOptions = createJwtVerifyOptions()

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
    let payload: JWTPayload

    if (env.supabaseJwtSecret) {
      const secret = new TextEncoder().encode(env.supabaseJwtSecret)
      const { payload: p } = await jwtVerify(token, secret, jwtVerifyOptions)
      payload = p
    } else {
      const jwks = getJwksGetter()!
      const { payload: p } = await jwtVerify(token, jwks, jwtVerifyOptions)
      payload = p
    }

    const parsedSub = z.string().min(1).safeParse(payload.sub)
    if (!parsedSub.success) {
      throw AppError.authInvalid('Token missing subject claim.')
    }

    const userId = parsedSub.data

    c.set('userId', userId)
    c.set('rawToken', token)
    c.set('tenantKey', env.tenantKey)
  } catch (err) {
    if (err instanceof AppError) throw err
    throw AppError.authInvalid()
  }

  await next()
}
