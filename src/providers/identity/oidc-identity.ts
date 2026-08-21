import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyOptions } from 'jose'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
import {
  identityRoleSchema,
  type CreateStudentIdentityParams,
  type IdentityProvider,
  type IdentityRole,
  type IdentityUser,
  type UserMetadata,
} from '../types.js'
import { isMfaVerified } from './claims.js'

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
      if (!this.issuer) {
        throw AppError.authInvalid('OIDC issuer configuration missing.')
      }

      const verifyOptions: JWTVerifyOptions = {
        audience: this.audience,
        issuer: this.issuer,
        requiredClaims: ['exp'],
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

      const parsedEmail = z.string().safeParse(payload.email)
      const parsedRoles = z.array(identityRoleSchema).safeParse(payload.roles)
      const parsedScope = z.string().min(1).safeParse(payload.scope)
      if (!parsedScope.success) {
        throw AppError.authInvalid('Token missing scope claim.')
      }
      const scopes = parsedScope.data.split(' ').filter(Boolean)
      if (scopes.length === 0) {
        throw AppError.authInvalid('Token missing scope claim.')
      }
      const parsedMfa = z.boolean().safeParse(payload.mfa_verified)
      const parsedAmr = z.array(z.string().min(1)).safeParse(payload.amr)
      const parsedMustChangePassword = z.boolean().safeParse(payload.must_change_password)

      return {
        userId: parsedSub.data,
        email: parsedEmail.success ? parsedEmail.data : null,
        roles: parsedRoles.success ? parsedRoles.data : [],
        scopes,
        mfaVerified: isMfaVerified(
          parsedMfa.success ? parsedMfa.data : undefined,
          parsedAmr.success ? parsedAmr.data : undefined,
        ),
        mustChangePassword: parsedMustChangePassword.success
          ? parsedMustChangePassword.data
          : undefined,
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
      const response = await fetch(
        `${this.logtoEndpoint.replace(/\/$/, '')}/api/interaction/verification`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        },
      )
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
        logger.error(
          { userId, status: response.status },
          'Logto update password returned error status',
        )
        throw AppError.internal('Failed to update password in identity provider.')
      }
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId }, 'Logto update password error')
      throw AppError.internal('Failed to update password in identity provider.')
    }
  }

  async updateUserMetadata(userId: string, metadata: UserMetadata): Promise<void> {
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
        logger.error(
          { userId, status: response.status },
          'Logto update user metadata returned error status',
        )
        throw AppError.internal('Failed to update user metadata in identity provider.')
      }
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId }, 'Logto update user metadata error')
      throw AppError.internal('Failed to update user metadata in identity provider.')
    }
  }

  async createStaffIdentity(params: {
    email: string
    fullName: string
    role: string
    password?: string
  }): Promise<{ userId: string; email: string }> {
    if (!this.logtoEndpoint || !this.logtoAppId || !this.logtoAppSecret) {
      return {
        userId: `logto-staff-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        email: params.email,
      }
    }

    try {
      const response = await fetch(
        `${this.logtoEndpoint.replace(/\/$/, '')}/api/users`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            primaryEmail: params.email,
            name: params.fullName,
            password: params.password,
            customData: { role: params.role },
          }),
        },
      )
      if (!response.ok) {
        logger.error({ status: response.status, email: params.email }, 'Logto create user failed')
        if (response.status === 409 || response.status === 422) {
          throw AppError.conflict(`Identity already exists for email "${params.email}".`)
        }
        throw AppError.internal('Failed to create user in identity provider.')
      }
      // SAFETY: response JSON contains id from Logto user creation
      const data = (await response.json()) as { id: string }
      return { userId: data.id, email: params.email }
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, email: params.email }, 'Logto create user error')
      throw AppError.internal('Failed to create user in identity provider.')
    }
  }

  async requestPasswordResetEmail(email: string): Promise<void> {
    if (!this.logtoEndpoint || !this.logtoAppId || !this.logtoAppSecret) {
      return
    }

    try {
      const response = await fetch(
        `${this.logtoEndpoint.replace(/\/$/, '')}/api/interaction/verification/password-reset`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        },
      )
      if (!response.ok) {
        logger.warn({ status: response.status, email }, 'Logto password reset email request failed')
      }
    } catch (err) {
      logger.warn({ err, email }, 'Logto password reset email error')
    }
  }

  async revokeUserSessions(userId: string): Promise<void> {
    if (!this.logtoEndpoint || !this.logtoAppId || !this.logtoAppSecret) {
      return
    }

    try {
      await fetch(
        `${this.logtoEndpoint.replace(/\/$/, '')}/api/users/${encodeURIComponent(userId)}/sign-out`,
        {
          method: 'POST',
        },
      )
    } catch (err) {
      logger.warn({ err, userId }, 'Logto sign-out error during session revocation')
    }
  }

  async assignRoles(userId: string, roles: string[]): Promise<void> {
    if (!this.logtoEndpoint || !this.logtoAppId || !this.logtoAppSecret) {
      return
    }

    try {
      await fetch(
        `${this.logtoEndpoint.replace(/\/$/, '')}/api/users/${encodeURIComponent(userId)}/roles`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roleNames: roles }),
        },
      )
    } catch (err) {
      logger.warn({ err, userId, roles }, 'Logto role assignment error')
    }
  }

  async createStudentIdentity(params: CreateStudentIdentityParams): Promise<{ userId: string }> {
    if (!this.logtoEndpoint || !this.logtoAppId || !this.logtoAppSecret) {
      throw AppError.internal('Identity provider management API is not configured.')
    }

    try {
      const response = await fetch(`${this.logtoEndpoint.replace(/\/$/, '')}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: params.username,
          primaryEmail: params.email,
          password: params.password,
          name: params.name,
          isSuspended: params.suspended ?? true,
          roleNames: params.roles ?? ['student'],
        }),
      })

      if (!response.ok) {
        throw AppError.internal('Failed to create student identity in identity provider.')
      }

      // SAFETY: Logto user creation response contains an id field.
      const data = (await response.json()) as { id: string }
      return { userId: data.id }
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, username: params.username }, 'Logto create student identity error')
      throw AppError.internal('Failed to create student identity in identity provider.')
    }
  }

  async setUserSuspended(userId: string, suspended: boolean): Promise<void> {
    if (!this.logtoEndpoint || !this.logtoAppId || !this.logtoAppSecret) {
      throw AppError.internal('Identity provider management API is not configured.')
    }

    try {
      const response = await fetch(
        `${this.logtoEndpoint.replace(/\/$/, '')}/api/users/${encodeURIComponent(userId)}/is-suspended`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isSuspended: suspended }),
        },
      )
      if (!response.ok) {
        throw AppError.internal('Failed to update user status in identity provider.')
      }
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId, suspended }, 'Logto set user suspended error')
      throw AppError.internal('Failed to update user status in identity provider.')
    }
  }

  async assignUserRole(userId: string, role: IdentityRole): Promise<void> {
    if (!this.logtoEndpoint || !this.logtoAppId || !this.logtoAppSecret) {
      throw AppError.internal('Identity provider management API is not configured.')
    }

    try {
      const response = await fetch(
        `${this.logtoEndpoint.replace(/\/$/, '')}/api/users/${encodeURIComponent(userId)}/roles`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roleNames: [role] }),
        },
      )
      if (!response.ok) {
        throw AppError.internal('Failed to assign role in identity provider.')
      }
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId, role }, 'Logto assign user role error')
      throw AppError.internal('Failed to assign role in identity provider.')
    }
  }

  async revokeUserRole(userId: string, role: IdentityRole): Promise<void> {
    if (!this.logtoEndpoint || !this.logtoAppId || !this.logtoAppSecret) {
      throw AppError.internal('Identity provider management API is not configured.')
    }

    try {
      const response = await fetch(
        `${this.logtoEndpoint.replace(/\/$/, '')}/api/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(role)}`,
        { method: 'DELETE' },
      )
      if (!response.ok && response.status !== 404) {
        throw AppError.internal('Failed to revoke role in identity provider.')
      }
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId, role }, 'Logto revoke user role error')
      throw AppError.internal('Failed to revoke role in identity provider.')
    }
  }

  async updateUserEmail(userId: string, email: string): Promise<void> {
    if (!this.logtoEndpoint || !this.logtoAppId || !this.logtoAppSecret) {
      throw AppError.internal('Identity provider management API is not configured.')
    }

    try {
      const response = await fetch(
        `${this.logtoEndpoint.replace(/\/$/, '')}/api/users/${encodeURIComponent(userId)}/primary-email`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ primaryEmail: email }),
        },
      )
      if (!response.ok) {
        throw AppError.internal('Failed to update email in identity provider.')
      }
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, userId }, 'Logto update user email error')
      throw AppError.internal('Failed to update email in identity provider.')
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
