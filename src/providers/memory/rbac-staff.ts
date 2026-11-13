import { AppError } from '../../lib/errors/app-error.js'
import type {
  AuditLog,
  AuditLogEntry,
  CreatePermissionParams,
  CreateRoleParams,
  CreateStaffParams,
  Permission,
  Role,
  UpdateRoleParams,
  UpdateStaffParams,
  UserProfile,
} from '../types.js'
import type { MemoryDomainState } from './domain-state.js'

export function insertMemoryAuditLog(store: MemoryDomainState, entry: AuditLogEntry): AuditLog {
  const log: AuditLog = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    actor_id: entry.actor_id ?? null,
    action: entry.action,
    entity_type: entry.entity_type,
    entity_id: entry.entity_id ?? null,
    details: entry.details ? JSON.parse(JSON.stringify(entry.details)) : null,
    created_at: new Date().toISOString(),
  }
  store.auditLogs.push(log)
  return log
}

export function getMemoryAuditLogs(
  store: MemoryDomainState,
  entityType?: string,
  entityId?: string,
): AuditLog[] {
  return [...store.auditLogs].reverse().filter((log) => {
    if (entityType && log.entity_type !== entityType) return false
    if (entityId && log.entity_id !== entityId) return false
    return true
  })
}

export function getMemoryRoles(store: MemoryDomainState, activeOnly = false): Role[] {
  const roles = Array.from(store.roles.values())
  if (activeOnly) {
    return roles.filter((r) => r.is_active)
  }
  return roles.map((r) => ({ ...r, permissions: [...(r.permissions ?? [])] }))
}

export function getMemoryRoleById(store: MemoryDomainState, id: string): Role | null {
  for (const role of store.roles.values()) {
    if (role.id === id) {
      return { ...role, permissions: [...(role.permissions ?? [])] }
    }
  }
  return null
}

export function getMemoryRoleByName(store: MemoryDomainState, name: string): Role | null {
  const role = store.roles.get(name.toLowerCase())
  if (!role) return null
  return { ...role, permissions: [...(role.permissions ?? [])] }
}

export function createMemoryRole(store: MemoryDomainState, params: CreateRoleParams): Role {
  const nameLower = params.name.toLowerCase()
  if (store.roles.has(nameLower)) {
    throw AppError.conflict(`Role with name "${params.name}" already exists.`)
  }
  const role: Role = {
    id: `role-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: nameLower,
    description: params.description ?? null,
    is_active: true,
    permissions: params.permissions ? [...params.permissions] : [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  store.roles.set(nameLower, role)
  return { ...role }
}

export function updateMemoryRole(
  store: MemoryDomainState,
  id: string,
  params: UpdateRoleParams,
): Role {
  let targetRole: Role | null = null
  let targetKey: string | null = null
  for (const [key, role] of store.roles.entries()) {
    if (role.id === id) {
      targetRole = role
      targetKey = key
      break
    }
  }
  if (!targetRole || !targetKey) {
    throw AppError.notFound('Role')
  }

  if (params.name && params.name.toLowerCase() !== targetRole.name) {
    const newNameLower = params.name.toLowerCase()
    if (store.roles.has(newNameLower)) {
      throw AppError.conflict(`Role with name "${params.name}" already exists.`)
    }
    store.roles.delete(targetKey)
    targetRole.name = newNameLower
    targetKey = newNameLower
  }

  if (params.description !== undefined) {
    targetRole.description = params.description
  }
  if (params.permissions !== undefined) {
    targetRole.permissions = [...params.permissions]
  }
  if (params.isActive !== undefined) {
    targetRole.is_active = params.isActive
  }
  targetRole.updated_at = new Date().toISOString()
  store.roles.set(targetKey, targetRole)
  return { ...targetRole, permissions: [...(targetRole.permissions ?? [])] }
}

export function getMemoryPermissions(store: MemoryDomainState): Permission[] {
  return Array.from(store.permissions.values()).map((p) => ({ ...p }))
}

export function createMemoryPermission(
  store: MemoryDomainState,
  params: CreatePermissionParams,
): Permission {
  const nameLower = params.name.toLowerCase()
  if (store.permissions.has(nameLower)) {
    throw AppError.conflict(`Permission with name "${params.name}" already exists.`)
  }
  const perm: Permission = {
    id: `perm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: nameLower,
    description: params.description ?? null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  store.permissions.set(nameLower, perm)
  return { ...perm }
}

export function getMemoryUserRoles(store: MemoryDomainState, userId: string): string[] {
  const assigned = store.userRoles.get(userId)
  const result = new Set<string>()
  if (assigned) {
    for (const r of assigned) result.add(r)
  }
  const profile = store.profiles.get(userId)
  if (profile?.role) {
    result.add(profile.role)
  }
  return Array.from(result)
}

export function assignMemoryUserRoles(
  store: MemoryDomainState,
  userId: string,
  roleNames: string[],
): void {
  const set = new Set<string>()
  for (const r of roleNames) {
    set.add(r.toLowerCase())
  }
  store.userRoles.set(userId, set)
}

export function getMemoryUserEffectivePermissions(
  store: MemoryDomainState,
  userId: string,
): string[] {
  const roles = getMemoryUserRoles(store, userId)
  const permissions = new Set<string>()
  for (const roleName of roles) {
    const role = store.roles.get(roleName.toLowerCase())
    if (role && role.is_active && role.permissions) {
      for (const p of role.permissions) {
        permissions.add(p)
      }
    }
  }
  return Array.from(permissions).sort()
}

export function createMemoryStaffProfile(
  store: MemoryDomainState,
  params: CreateStaffParams,
): UserProfile {
  for (const p of store.profiles.values()) {
    if (p.email && p.email.toLowerCase() === params.email.toLowerCase()) {
      throw AppError.conflict(`Email "${params.email}" is already registered.`)
    }
  }

  const userId = params.userId ?? `staff-${Date.now()}`
  // SAFETY: role is verified against active roles in service
  const primaryRole = params.role as UserProfile['role']
  const profile: UserProfile = {
    user_id: userId,
    full_name: params.fullName,
    email: params.email,
    role: primaryRole,
    lifecycle_status: 'approved',
    gender: params.gender ?? null,
  }
  store.profiles.set(userId, profile)

  const allRoles = new Set<string>([params.role])
  if (params.roles) {
    for (const r of params.roles) allRoles.add(r)
  }
  store.userRoles.set(userId, allRoles)

  return { ...profile }
}

export function getMemoryStaffProfiles(store: MemoryDomainState): UserProfile[] {
  const result: UserProfile[] = []
  for (const p of store.profiles.values()) {
    if (p.role && p.role !== 'student') {
      result.push({ ...p })
    }
  }
  return result
}

export function getMemoryStaffProfile(
  store: MemoryDomainState,
  userId: string,
): UserProfile | null {
  const profile = store.profiles.get(userId)
  if (!profile || profile.role === 'student') return null
  return { ...profile }
}

export async function updateMemoryStaffProfile(
  store: MemoryDomainState,
  userId: string,
  updates: UpdateStaffParams,
): Promise<UserProfile> {
  const profile = store.profiles.get(userId)
  if (!profile) {
    throw AppError.notFound('Staff profile')
  }

  if (updates.fullName !== undefined) {
    profile.full_name = updates.fullName
  }
  if (updates.gender !== undefined) {
    profile.gender = updates.gender
  }
  if (updates.role !== undefined) {
    // SAFETY: updates.role is validated by schema and service
    profile.role = updates.role as UserProfile['role']
    const existingRoles = store.userRoles.get(userId) ?? new Set<string>()
    existingRoles.add(updates.role)
    store.userRoles.set(userId, existingRoles)
  }
  if (updates.roles !== undefined) {
    const set = new Set<string>(updates.roles)
    if (updates.role) set.add(updates.role)
    store.userRoles.set(userId, set)
  }
  if (updates.lifecycleStatus !== undefined) {
    profile.lifecycle_status = updates.lifecycleStatus
  }
  if (
    updates.lifecycleStatus !== undefined ||
    updates.role !== undefined ||
    updates.roles !== undefined
  ) {
    await store.revokeUserSessions(userId)
  }
  store.profiles.set(userId, profile)
  return { ...profile }
}

export function revokeMemoryUserSessions(store: MemoryDomainState, userId: string): void {
  store.revokedSessions.set(userId, Date.now())
}

export function isMemorySessionRevoked(
  store: MemoryDomainState,
  userId: string,
  issuedAt?: number,
): boolean {
  const revokedAt = store.revokedSessions.get(userId)
  if (revokedAt === undefined) return false
  return (
    issuedAt === undefined ||
    !Number.isSafeInteger(issuedAt) ||
    issuedAt < 0 ||
    issuedAt > Math.floor(Date.now() / 1000) ||
    issuedAt * 1000 <= revokedAt
  )
}
