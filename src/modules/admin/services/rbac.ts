import { AppError } from '../../../lib/errors/app-error.js'
import type { AppProviders, IdentityRole, Permission, Role } from '../../../providers/types.js'
import { assertAdminAccess, assertPlatformAdmin } from './shared.js'

export async function listRoles(params: {
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Role[]> {
  assertAdminAccess(params.actorRole)

  return params.providers.domainStore.getRoles()
}

export async function getRole(params: {
  id: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Role> {
  assertAdminAccess(params.actorRole)

  const role = await params.providers.domainStore.getRoleById(params.id)
  if (!role) {
    throw AppError.notFound('Role')
  }

  return role
}

export async function createRole(params: {
  name: string
  description?: string | null
  permissions?: string[]
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Role> {
  assertPlatformAdmin(params.actorRole)

  const role = await params.providers.domainStore.createRole({
    name: params.name,
    description: params.description,
    permissions: params.permissions,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'create_role',
    entity_type: 'role',
    entity_id: role.id,
    details: {
      name: role.name,
      permissions: role.permissions,
    },
  })

  return role
}

export async function updateRole(params: {
  id: string
  name?: string
  description?: string | null
  permissions?: string[]
  isActive?: boolean
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Role> {
  assertPlatformAdmin(params.actorRole)

  const updated = await params.providers.domainStore.updateRole(params.id, {
    name: params.name,
    description: params.description,
    permissions: params.permissions,
    isActive: params.isActive,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'update_role',
    entity_type: 'role',
    entity_id: updated.id,
    details: {
      name: updated.name,
      is_active: updated.is_active,
      permissions: updated.permissions,
    },
  })

  return updated
}

export async function listPermissions(params: {
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Permission[]> {
  assertAdminAccess(params.actorRole)

  return params.providers.domainStore.getPermissions()
}

export async function createPermission(params: {
  name: string
  description?: string | null
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<Permission> {
  assertPlatformAdmin(params.actorRole)

  const perm = await params.providers.domainStore.createPermission({
    name: params.name,
    description: params.description,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'create_permission',
    entity_type: 'permission',
    entity_id: perm.id,
    details: {
      name: perm.name,
    },
  })

  return perm
}
