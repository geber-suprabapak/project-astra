import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
import type { IdentityProvider, IdentityUser } from '../types.js'

export interface OidcIdentityProviderOptions {
  issuer?: string
  jwksUrl?: string
  jwtSecret?: string
  audience?: string
  logtoEndpoint?: string
  logtoAppId?: string
  logtoAppSecret?: string
}

export class OidcIdentityProvider implements IdentityProvider {
  private readonly issuer?: string
  private readonly jwksUrl?: string
  private readonly jwtSecret?: string
  private readonly audience: string
  private readonly logtoEndpoint?: string
  private readonly logtoAppId?: string
  private readonly logtoAppSecret?: string
  private jwksGetter: ReturnType<typeof createRemoteJWKSet> | null = null

  constructor(options: OidcIdentityProviderOptions = {}) {
    this.issuer = 'issuer' in options ? options.issuer : env.oidcIssuer
    this.jwksUrl = 'jwksUrl' in options ? options.jwksUrl : env.oidcJwksUrl
    this.jwtSecret = 'jwtSecret' in options ? options.jwtSecret : env.oidcJwtSecret
    this.audience = options.audience ?? env.oidcAudience
    this.logtoEndpoint = 'logtoEndpoint' in options ? options.logtoEndpoint : env.logtoEndpoint
    this.logtoAppId = 'logtoAppId' in options ? options.logtoAppId : env.logtoAppId
    this.logtoAppSecret = 'logtoAppSecret' in options ? options.logtoAppSecret : env.logtoAppSecret
  }

  private getJwksGetter() {
    if (!this.jwksGetter && this.jwksUrl) {
      this.jwksGetter = createRemoteJWKSet(new URL(this.jwksUrl))
    }
    return this.jwksGetter
  }

  async verifyToken(token: string): Promise<IdentityUser> {
    try {
      const verifyOptions: { audience: string; issuer?: string } = {
        audience: this.audience,
      }
      if (this.issuer) {
        verifyOptions.issuer = this.issuer
      }

      let payload: JWTPayload

      if (this.jwtSecret) {
        const secret = new TextEncoder().encode(this.jwtSecret)
        const { payload: p } = await jwtVerify(token, secret, verifyOptions)
        payload = p
      } else {
        const jwks = this.getJwksGetter()
        if (!jwks) {
          throw AppError.authInvalid('JWKS configuration missing.')
        }
        const { payload: p } = await jwtVerify(token, jwks, verifyOptions)
        payload = p
      }

      const parsedSub = z.string().min(1).safeParse(payload.sub)
      if (!parsedSub.success) {
        throw AppError.authInvalid('Token missing subject claim.')
      }

      return {
        userId: parsedSub.data,
        email: typeof payload['email'] === 'string' ? payload['email'] : null,
        ...payload,
      }
    } catch (err) {
      if (err instanceof AppError) throw err
      throw AppError.authInvalid()
    }
  }

  async verifyPassword(email: string, password: string): Promise<void> {
    if (!this.logtoEndpoint || !this.logtoAppId || !this.logtoAppSecret) {
      throw AppError.internal('Identity provider management API is not configured.')
    }

    try {
      const response = await fetch(`${this.logtoEndpoint.replace(/\/$/, '')}/api/interaction/verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!response.ok) {
        throw AppError.authInvalid('Current password is incorrect.')
      }
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, email }, 'Logto password verification failed with error')
      throw AppError.authInvalid('Current password is incorrect.')
    }
  }

  async updatePassword(userId: string, newPassword: string): Promise<void> {
    if (!this.logtoEndpoint || !this.logtoAppId || !this.logtoAppSecret) {
      throw AppError.internal('Identity provider management API is not configured.')
    }

    try {
      const response = await fetch(
        `${this.logtoEndpoint.replace(/\/$/, '')}/api/users/${encodeURIComponent(userId)}/password`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: newPassword }),
        },
      )
      if (!response.ok) {
        logger.error({ userId, status: response.status }, 'Logto update password returned error status')
        throw AppError.internal('Failed to update password in identity provider.')
      }
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId }, 'Logto update password error')
      throw AppError.internal('Failed to update password in identity provider.')
    }
  }

  async updateUserMetadata(userId: string, metadata: Record<string, unknown>): Promise<void> {
    if (!this.logtoEndpoint || !this.logtoAppId || !this.logtoAppSecret) {
      throw AppError.internal('Identity provider management API is not configured.')
    }

    try {
      const response = await fetch(
        `${this.logtoEndpoint.replace(/\/$/, '')}/api/users/${encodeURIComponent(userId)}/custom-data`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(metadata),
        },
      )
      if (!response.ok) {
        logger.error({ userId, status: response.status }, 'Logto update user metadata returned error status')
        throw AppError.internal('Failed to update user metadata in identity provider.')
      }
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId }, 'Logto update user metadata error')
      throw AppError.internal('Failed to update user metadata in identity provider.')
    }
  }

  async checkHealth(): Promise<boolean> {
    if (this.jwksUrl) {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 3000)
        try {
          const res = await fetch(this.jwksUrl, { method: 'GET', signal: controller.signal })
          return res.ok
        } finally {
          clearTimeout(timer)
        }
      } catch {
        return false
      }
    }

    if (this.jwtSecret) {
      return true
    }

    return false
  }
}
