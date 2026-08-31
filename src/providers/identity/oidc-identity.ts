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
  legacyJwtSecret?: string
  legacyIssuer?: string
  legacyAudience?: string
  legacyBridgeExpiresAt?: string
}

type LogtoCreateUserPayload = {
  username?: string
  primaryEmail: string
  password?: string
  name?: string
  isSuspended: boolean
  roleNames: readonly IdentityRole[]
  customData: { nis?: string }
}

type OidcVerificationError = Error & {
  code?: string
  claim?: string
}

type OidcVerificationFailureMetadata = {
  name: string
  code?: string
  claim?: string
}

const safeOidcClaimNames = new Set(['iss', 'aud', 'exp', 'nbf'])

export function getOidcVerificationFailureMetadata(
  error: OidcVerificationError,
): OidcVerificationFailureMetadata {
  const metadata: OidcVerificationFailureMetadata = { name: error.name }
  if (error.code) metadata.code = error.code
  if (error.claim && safeOidcClaimNames.has(error.claim)) metadata.claim = error.claim
  return metadata
}

export class OidcIdentityProvider implements IdentityProvider {
  private readonly issuer?: string
  private readonly jwksUrl?: string
  private readonly jwtSecret?: string
  private readonly audience: string
  private readonly logtoEndpoint?: string
  private readonly logtoAppId?: string
  private readonly logtoAppSecret?: string
  private readonly legacyJwtSecret?: string
  private readonly legacyIssuer?: string
  private readonly legacyAudience: string
  private readonly legacyBridgeExpiresAt?: string
  private jwksGetter: ReturnType<typeof createRemoteJWKSet> | null = null

  constructor(options: OidcIdentityProviderOptions = {}) {
    this.issuer = 'issuer' in options ? options.issuer : env.oidcIssuer
    this.jwksUrl = 'jwksUrl' in options ? options.jwksUrl : env.oidcJwksUrl
    this.jwtSecret = 'jwtSecret' in options ? options.jwtSecret : env.oidcJwtSecret
    this.audience = options.audience ?? env.oidcAudience
    this.logtoEndpoint = 'logtoEndpoint' in options ? options.logtoEndpoint : env.logtoEndpoint
    this.logtoAppId = 'logtoAppId' in options ? options.logtoAppId : env.logtoAppId
    this.logtoAppSecret = 'logtoAppSecret' in options ? options.logtoAppSecret : env.logtoAppSecret
    this.legacyJwtSecret =
      'legacyJwtSecret' in options ? options.legacyJwtSecret : env.legacySupabaseJwtSecret
    this.legacyIssuer =
      'legacyIssuer' in options ? options.legacyIssuer : env.legacySupabaseJwtIssuer
    this.legacyAudience =
      'legacyAudience' in options
        ? (options.legacyAudience ?? 'authenticated')
        : env.legacySupabaseJwtAudience
    this.legacyBridgeExpiresAt =
      'legacyBridgeExpiresAt' in options
        ? options.legacyBridgeExpiresAt
        : env.legacyAuthBridgeExpiresAt
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
        authSource: 'logto',
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
      // SAFETY: this branch narrows the caught value to Error; jose verification
      // errors expose their optional machine-readable code as a string.
      const verification =
        err instanceof Error
          ? getOidcVerificationFailureMetadata(err as OidcVerificationError)
          : { name: 'UnknownError' }
      logger.warn({ verification }, 'OIDC token verification failed')
      throw AppError.authInvalid()
    }
  }

  async verifyLegacyToken(token: string): Promise<IdentityUser> {
    try {
      if (!this.legacyJwtSecret || !this.legacyIssuer || !this.legacyBridgeExpiresAt) {
        throw AppError.authInvalid('Legacy mobile authentication bridge is not configured.')
      }
      if (new Date(this.legacyBridgeExpiresAt).getTime() <= Date.now()) {
        throw AppError.authInvalid('Legacy mobile authentication bridge has expired.')
      }

      const secret = new TextEncoder().encode(this.legacyJwtSecret)
      const { payload } = await jwtVerify(token, secret, {
        audience: this.legacyAudience,
        issuer: this.legacyIssuer,
        requiredClaims: ['exp', 'sub'],
      })
      const parsedSub = z.string().uuid().safeParse(payload.sub)
      if (!parsedSub.success) {
        throw AppError.authInvalid('Legacy token has an invalid subject claim.')
      }
      const appMetadata = z
        .object({ role: z.string().optional() })
        .passthrough()
        .safeParse(payload.app_metadata)
      if (!appMetadata.success || appMetadata.data.role !== 'siswa') {
        throw AppError.forbidden('Legacy bridge accepts student mobile identities only.')
      }
      const parsedEmail = z.string().safeParse(payload.email)
      return {
        userId: parsedSub.data,
        legacyUserId: parsedSub.data,
        authSource: 'legacy_supabase',
        email: parsedEmail.success ? parsedEmail.data : null,
        roles: ['student'],
        scopes: ['legacy:mobile'],
        mfaVerified: false,
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
      const response = await fetch(`${this.logtoEndpoint.replace(/\/$/, '')}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryEmail: params.email,
          name: params.fullName,
          password: params.password,
          customData: { role: params.role },
        }),
      })
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

  private m2mToken: string | null = null
  private m2mTokenExpiresAt = 0

  private async getManagementToken(): Promise<string> {
    if (!this.logtoEndpoint || !this.logtoAppId || !this.logtoAppSecret) {
      throw AppError.internal('Identity provider management API is not configured.')
    }

    if (this.m2mToken && Date.now() < this.m2mTokenExpiresAt - 60000) {
      return this.m2mToken
    }

    const credentials = Buffer.from(`${this.logtoAppId}:${this.logtoAppSecret}`).toString('base64')
    const response = await fetch(`${this.logtoEndpoint.replace(/\/$/, '')}/oidc/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: 'grant_type=client_credentials&resource=https://default.logto.app/api&scope=all',
    })

    if (!response.ok) {
      logger.error({ status: response.status }, 'Failed to fetch Logto management token')
      throw AppError.internal('Failed to authenticate with identity provider management API.')
    }

    // SAFETY: Successful Logto token responses contain a string access_token and optional expires_in.
    const data = (await response.json()) as { access_token: string; expires_in?: number }
    this.m2mToken = data.access_token
    this.m2mTokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000
    return this.m2mToken
  }

  async createStudentIdentity(params: CreateStudentIdentityParams): Promise<{ userId: string }> {
    if (!this.logtoEndpoint || !this.logtoAppId || !this.logtoAppSecret) {
      throw AppError.internal('Identity provider management API is not configured.')
    }

    try {
      const token = await this.getManagementToken()
      const userPayload: LogtoCreateUserPayload = {
        primaryEmail: params.email,
        password: params.password,
        name: params.name,
        isSuspended: params.suspended ?? true,
        roleNames: params.roles ?? ['student'],
        customData: params.username ? { nis: params.username } : {},
      }

      if (params.username && !/^\d+$/.test(params.username)) {
        userPayload.username = params.username
      }

      const response = await fetch(`${this.logtoEndpoint.replace(/\/$/, '')}/api/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(userPayload),
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
