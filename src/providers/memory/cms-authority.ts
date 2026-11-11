import { AppError } from '../../lib/errors/app-error.js'
import type { CmsProfile, CmsSession } from '../../modules/cms/schema.js'

export function assertMemoryCmsAuthority(
  store: { cmsProfiles: Map<string, CmsProfile> },
  access: CmsSession,
) {
  const profile = [...store.cmsProfiles.values()].find((row) => row.id === access.id)
  if (
    !profile?.access_enabled ||
    profile.authz_version !== access.authz_version ||
    profile.role !== access.role ||
    profile.jurusan_id !== access.jurusan_id ||
    profile.jurusan_slug !== access.jurusan_slug
  )
    throw AppError.forbidden()
}
