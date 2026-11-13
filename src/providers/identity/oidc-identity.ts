import { env } from '../../config/env.js'
import type {
  CreateStudentIdentityParams,
  IdentityProvider,
  IdentityRole,
  IdentityUser,
  UserMetadata,
} from '../types.js'
import {
  deleteUser,
  requestPasswordResetEmail,
  revokeUserSessions,
  setUserSuspended,
  updatePassword,
  updateUserEmail,
  updateUserMetadata,
  verifyPassword,
} from './logto-account.js'
import { LogtoManagementClient } from './logto-client.js'
import {
  assignRoles,
  assignUserRole,
  createCmsIdentity,
  createStaffIdentity,
  createStudentIdentity,
  revokeUserRole,
} from './logto-provisioning.js'
import {
  getOidcVerificationFailureMetadata,
  OidcTokenVerifier,
  type OidcIdentityProviderOptions,
} from './oidc-verification.js'

export { getOidcVerificationFailureMetadata, type OidcIdentityProviderOptions }

export class OidcIdentityProvider implements IdentityProvider {
  private readonly verifier: OidcTokenVerifier
  private readonly logtoClient: LogtoManagementClient

  constructor(options: OidcIdentityProviderOptions = {}) {
    this.verifier = new OidcTokenVerifier({
      issuer: 'issuer' in options ? options.issuer : env.oidcIssuer,
      jwksUrl: 'jwksUrl' in options ? options.jwksUrl : env.oidcJwksUrl,
      jwtSecret: 'jwtSecret' in options ? options.jwtSecret : env.oidcJwtSecret,
      audience: options.audience ?? env.oidcAudience,
      legacyJwtSecret:
        'legacyJwtSecret' in options ? options.legacyJwtSecret : env.legacySupabaseJwtSecret,
      legacyIssuer: 'legacyIssuer' in options ? options.legacyIssuer : env.legacySupabaseJwtIssuer,
      legacyAudience:
        'legacyAudience' in options
          ? (options.legacyAudience ?? 'authenticated')
          : env.legacySupabaseJwtAudience,
      legacyBridgeExpiresAt:
        'legacyBridgeExpiresAt' in options
          ? options.legacyBridgeExpiresAt
          : env.legacyAuthBridgeExpiresAt,
    })

    this.logtoClient = new LogtoManagementClient({
      logtoEndpoint: 'logtoEndpoint' in options ? options.logtoEndpoint : env.logtoEndpoint,
      logtoAppId: 'logtoAppId' in options ? options.logtoAppId : env.logtoAppId,
      logtoAppSecret: 'logtoAppSecret' in options ? options.logtoAppSecret : env.logtoAppSecret,
      logtoCmsAccessRoleName: options.logtoCmsAccessRoleName ?? env.logtoCmsAccessRoleName,
    })
  }

  verifyToken(token: string): Promise<IdentityUser> {
    return this.verifier.verifyToken(token)
  }

  verifyLegacyToken(token: string): Promise<IdentityUser> {
    return this.verifier.verifyLegacyToken(token)
  }

  verifyPassword(email: string, password: string): Promise<void> {
    return verifyPassword(this.logtoClient, email, password)
  }

  updatePassword(userId: string, newPassword: string): Promise<void> {
    return updatePassword(this.logtoClient, userId, newPassword)
  }

  updateUserMetadata(userId: string, metadata: UserMetadata): Promise<void> {
    return updateUserMetadata(this.logtoClient, userId, metadata)
  }

  createCmsIdentity(params: {
    email: string
    fullName: string
    password: string
  }): Promise<{ userId: string }> {
    return createCmsIdentity(this.logtoClient, params)
  }

  createStaffIdentity(params: {
    email: string
    fullName: string
    role: string
    password?: string
  }): Promise<{ userId: string; email: string }> {
    return createStaffIdentity(this.logtoClient, params)
  }

  requestPasswordResetEmail(email: string): Promise<void> {
    return requestPasswordResetEmail(this.logtoClient, email)
  }

  revokeUserSessions(userId: string): Promise<void> {
    return revokeUserSessions(this.logtoClient, userId)
  }

  assignRoles(userId: string, roles: readonly string[]): Promise<void> {
    return assignRoles(this.logtoClient, userId, roles)
  }

  createStudentIdentity(params: CreateStudentIdentityParams): Promise<{ userId: string }> {
    return createStudentIdentity(this.logtoClient, params)
  }

  setUserSuspended(userId: string, suspended: boolean): Promise<void> {
    return setUserSuspended(this.logtoClient, userId, suspended)
  }

  assignUserRole(userId: string, role: IdentityRole): Promise<void> {
    return assignUserRole(this.logtoClient, userId, role)
  }

  revokeUserRole(userId: string, role: IdentityRole): Promise<void> {
    return revokeUserRole(this.logtoClient, userId, role)
  }

  updateUserEmail(userId: string, email: string): Promise<void> {
    return updateUserEmail(this.logtoClient, userId, email)
  }

  deleteUser(userId: string): Promise<void> {
    return deleteUser(this.logtoClient, userId)
  }

  checkHealth(): Promise<boolean> {
    return this.verifier.checkHealth()
  }
}
