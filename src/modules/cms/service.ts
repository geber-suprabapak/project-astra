import { hasScope, logtoScopes } from '../../authz/scopes.js'
import { AppError } from '../../lib/errors/app-error.js'
import type { AppProviders, IdentityUser } from '../../providers/types.js'
import { cmsProfileSchema, type CmsSession } from './schema.js'

export async function getCmsSession(providers: AppProviders, token: string): Promise<CmsSession> {
  let identity: IdentityUser
  try {
    identity = await providers.identityProvider.verifyToken(token)
  } catch (error) {
    if (error instanceof AppError) throw error
    throw AppError.authInvalid()
  }
  if (identity.authSource !== 'logto' || identity.legacyUserId) {
    throw AppError.authInvalid()
  }
  if (!hasScope(identity.scopes, logtoScopes.cmsAccess)) {
    throw AppError.forbidden('Token is not authorized for the CMS API.')
  }
  const issuedAt = identity.issuedAt
  if (
    issuedAt === undefined ||
    !Number.isSafeInteger(issuedAt) ||
    issuedAt < 0 ||
    issuedAt > Math.floor(Date.now() / 1000)
  ) {
    throw AppError.authInvalid()
  }
  if (await providers.domainStore.isSessionRevoked(identity.userId, issuedAt)) {
    throw AppError.authInvalid('Session has been revoked.')
  }

  const profile = cmsProfileSchema
    .nullable()
    .parse(await providers.domainStore.getCmsProfileBySubject(identity.userId))
  if (!profile || profile.logto_subject !== identity.userId || !profile.access_enabled) {
    throw AppError.forbidden()
  }
  if (profile.session_valid_after && issuedAt * 1000 <= Date.parse(profile.session_valid_after)) {
    throw AppError.authInvalid('CMS session has been revoked.')
  }
  if (profile.role === 'admin_jurusan' && (!profile.jurusan_id || !profile.jurusan_slug)) {
    throw AppError.forbidden('CMS department binding is missing.')
  }

  return {
    id: profile.id,
    full_name: profile.full_name,
    email: profile.email,
    role: profile.role,
    jurusan_id: profile.jurusan_id,
    jurusan_slug: profile.jurusan_slug,
    authz_version: profile.authz_version,
  }
}
