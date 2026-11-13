import { AppError } from '../../../lib/errors/app-error.js'
import type { IdentityRole } from '../../../providers/types.js'

const CHRONOS_STAFF_ROLES: ReadonlySet<IdentityRole> = new Set([
  'platform_admin',
  'school_admin',
  'teacher',
  'staff',
])

export function assertPlatformAdmin(actorRole: IdentityRole | null): void {
  if (actorRole !== 'platform_admin') {
    throw AppError.forbidden()
  }
}

export function assertAdminAccess(actorRole: IdentityRole | null): void {
  if (actorRole !== 'platform_admin' && actorRole !== 'school_admin') {
    throw AppError.forbidden()
  }
}

export function assertChronosStaffAccess(actorRole: IdentityRole | null): void {
  if (!actorRole || !CHRONOS_STAFF_ROLES.has(actorRole)) {
    throw AppError.forbidden()
  }
}
