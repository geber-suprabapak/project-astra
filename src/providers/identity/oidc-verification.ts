import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyOptions } from 'jose'
import { z } from 'zod'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
import { identityRoleSchema, type IdentityUser } from '../types.js'
import { isMfaVerified } from './claims.js'

export interface OidcIdentityProviderOptions {
  issuer?: string
  jwksUrl?: string
  jwtSecret?: string
  audience?: string
  logtoEndpoint?: string
  logtoAppId?: string
  logtoCmsAccessRoleName?: string
  logtoAppSecret?: string
  legacyJwtSecret?: string
  legacyIssuer?: string
  legacyAudience?: string
  legacyBridgeExpiresAt?: string
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

export interface OidcVerifierConfig {
  issuer?: string
  jwksUrl?: string
  jwtSecret?: string
  audience: string
  legacyJwtSecret?: string
  legacyIssuer?: string
  legacyAudience: string
  legacyBridgeExpiresAt?: string
}

export class OidcTokenVerifier {
  private jwksGetter: ReturnType<typeof createRemoteJWKSet> | null = null

  constructor(private readonly config: OidcVerifierConfig) {}

  private getJwksGetter() {
    if (!this.jwksGetter && this.config.jwksUrl) {
      this.jwksGetter = createRemoteJWKSet(new URL(this.config.jwksUrl))
    }
    return this.jwksGetter
  }

  async verifyToken(token: string): Promise<IdentityUser> {
    try {
      if (!this.config.issuer) {
        throw AppError.authInvalid('OIDC issuer configuration missing.')
      }

      const verifyOptions: JWTVerifyOptions = {
        audience: this.config.audience,
        issuer: this.config.issuer,
        requiredClaims: ['exp'],
      }

      let payload: JWTPayload

      if (this.config.jwtSecret) {
        const secret = new TextEncoder().encode(this.config.jwtSecret)
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
      const issuedAt = z.number().int().nonnegative().safeParse(payload.iat)

      return {
        userId: parsedSub.data,
        issuedAt: issuedAt.success ? issuedAt.data : undefined,
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
      if (
        !this.config.legacyJwtSecret ||
        !this.config.legacyIssuer ||
        !this.config.legacyBridgeExpiresAt
      ) {
        throw AppError.authInvalid('Legacy mobile authentication bridge is not configured.')
      }
      if (new Date(this.config.legacyBridgeExpiresAt).getTime() <= Date.now()) {
        throw AppError.authInvalid('Legacy mobile authentication bridge has expired.')
      }

      const secret = new TextEncoder().encode(this.config.legacyJwtSecret)
      const { payload } = await jwtVerify(token, secret, {
        audience: this.config.legacyAudience,
        issuer: this.config.legacyIssuer,
        requiredClaims: ['exp', 'sub'],
      })
      // Loose UUID shape (zod 3 `z.string().uuid()` semantics): zod 4's uuid()
      // additionally requires valid version/variant nibbles.
      const parsedSub = z
        .string()
        .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/)
        .safeParse(payload.sub)
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

  async checkHealth(): Promise<boolean> {
    if (this.config.jwksUrl) {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 3000)
        try {
          const res = await fetch(this.config.jwksUrl, {
            method: 'GET',
            signal: controller.signal,
          })
          return res.ok
        } finally {
          clearTimeout(timer)
        }
      } catch {
        return false
      }
    }

    if (this.config.jwtSecret) {
      return true
    }

    return false
  }
}
