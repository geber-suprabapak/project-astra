import type { Sql } from 'postgres'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
import type {
  CreatePermissionParams,
  CreateRoleParams,
  CreateStaffParams,
  Permission,
  Role,
  UpdateRoleParams,
  UpdateStaffParams,
  UserProfile,
} from '../types.js'
import { withPgError, type PgQuery } from './shared.js'
import { getUserProfile } from './students-roster.js'

async function syncRolePermissions(
  tx: PgQuery,
  roleId: string,
  permissions: string[],
): Promise<void> {
  for (const permName of permissions) {
    const permRows = await tx<{ id: string }[]>`
      SELECT id FROM permissions WHERE LOWER(name) = LOWER(${permName}) LIMIT 1
    `
    if (permRows.length > 0) {
      await tx`
        INSERT INTO role_permissions (role_id, permission_id)
        VALUES (${roleId}, ${permRows[0].id})
        ON CONFLICT DO NOTHING
      `
    }
  }
}

async function syncUserRoles(
  tx: PgQuery,
  userId: string,
  roleNames: Iterable<string>,
  replaceExisting = false,
): Promise<void> {
  if (replaceExisting) {
    await tx`DELETE FROM user_roles WHERE user_id = ${userId}`
  }
  for (const roleName of roleNames) {
    const roleRows = await tx<{ id: string }[]>`
      SELECT id FROM roles WHERE LOWER(name) = LOWER(${roleName}) LIMIT 1
    `
    if (roleRows.length > 0) {
      await tx`
        INSERT INTO user_roles (user_id, role_id)
        VALUES (${userId}, ${roleRows[0].id})
        ON CONFLICT DO NOTHING
      `
    }
  }
}

export async function getRoles(sql: Sql, activeOnly = false): Promise<Role[]> {
  return withPgError(
    (err) => logger.error({ err, activeOnly }, 'Failed to query roles'),
    async () => {
      if (activeOnly) {
        const rows = await sql<Role[]>`
          SELECT r.id, r.name, r.description, r.is_active, r.created_at::text, r.updated_at::text,
                 COALESCE(ARRAY_AGG(p.name) FILTER (WHERE p.name IS NOT NULL), '{}') as permissions
          FROM roles r
          LEFT JOIN role_permissions rp ON r.id = rp.role_id
          LEFT JOIN permissions p ON rp.permission_id = p.id
          WHERE r.is_active = true
          GROUP BY r.id, r.name, r.description, r.is_active, r.created_at, r.updated_at
          ORDER BY r.name ASC
        `
        return rows ?? []
      }
      const rows = await sql<Role[]>`
        SELECT r.id, r.name, r.description, r.is_active, r.created_at::text, r.updated_at::text,
               COALESCE(ARRAY_AGG(p.name) FILTER (WHERE p.name IS NOT NULL), '{}') as permissions
        FROM roles r
        LEFT JOIN role_permissions rp ON r.id = rp.role_id
        LEFT JOIN permissions p ON rp.permission_id = p.id
        GROUP BY r.id, r.name, r.description, r.is_active, r.created_at, r.updated_at
        ORDER BY r.name ASC
      `
      return rows ?? []
    },
  )
}

export async function getRoleById(sql: PgQuery, id: string): Promise<Role | null> {
  return withPgError(
    (err) => logger.error({ err, id }, 'Failed to query role by ID'),
    async () => {
      const rows = await sql<Role[]>`
        SELECT r.id, r.name, r.description, r.is_active, r.created_at::text, r.updated_at::text,
               COALESCE(ARRAY_AGG(p.name) FILTER (WHERE p.name IS NOT NULL), '{}') as permissions
        FROM roles r
        LEFT JOIN role_permissions rp ON r.id = rp.role_id
        LEFT JOIN permissions p ON rp.permission_id = p.id
        WHERE r.id = ${id}
        GROUP BY r.id, r.name, r.description, r.is_active, r.created_at, r.updated_at
        LIMIT 1
      `
      return rows[0] ?? null
    },
  )
}

export async function getRoleByName(sql: Sql, name: string): Promise<Role | null> {
  return withPgError(
    (err) => logger.error({ err, name }, 'Failed to query role by name'),
    async () => {
      const rows = await sql<Role[]>`
        SELECT r.id, r.name, r.description, r.is_active, r.created_at::text, r.updated_at::text,
               COALESCE(ARRAY_AGG(p.name) FILTER (WHERE p.name IS NOT NULL), '{}') as permissions
        FROM roles r
        LEFT JOIN role_permissions rp ON r.id = rp.role_id
        LEFT JOIN permissions p ON rp.permission_id = p.id
        WHERE LOWER(r.name) = LOWER(${name})
        GROUP BY r.id, r.name, r.description, r.is_active, r.created_at, r.updated_at
        LIMIT 1
      `
      return rows[0] ?? null
    },
  )
}

export async function createRole(sql: Sql, params: CreateRoleParams): Promise<Role> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to create role'),
    async () => {
      const nameLower = params.name.toLowerCase()
      const existing = await getRoleByName(sql, nameLower)
      if (existing) {
        throw AppError.conflict(`Role with name "${params.name}" already exists.`)
      }

      let createdRoleId: string | null = null
      await sql.begin(async (tx) => {
        const rows = await tx<{ id: string }[]>`
          INSERT INTO roles (name, description, is_active)
          VALUES (${nameLower}, ${params.description ?? null}, true)
          RETURNING id
        `
        if (!rows || rows.length === 0) {
          throw AppError.internal('Failed to insert role.')
        }
        createdRoleId = rows[0].id

        if (params.permissions && params.permissions.length > 0) {
          await syncRolePermissions(tx, createdRoleId, params.permissions)
        }
      })

      if (!createdRoleId) {
        throw AppError.internal('Failed to create role.')
      }

      const roleWithPerms = await getRoleById(sql, createdRoleId)
      if (!roleWithPerms) {
        throw AppError.internal('Failed to load created role.')
      }
      return roleWithPerms
    },
  )
}

export async function updateRole(sql: Sql, id: string, params: UpdateRoleParams): Promise<Role> {
  return withPgError(
    (err) => logger.error({ err, id, params }, 'Failed to update role'),
    async () => {
      const existing = await getRoleById(sql, id)
      if (!existing) {
        throw AppError.notFound('Role')
      }

      if (params.name && params.name.toLowerCase() !== existing.name.toLowerCase()) {
        const nameExisting = await getRoleByName(sql, params.name.toLowerCase())
        if (nameExisting && nameExisting.id !== id) {
          throw AppError.conflict(`Role with name "${params.name}" already exists.`)
        }
      }

      await sql.begin(async (tx) => {
        const nameLower = params.name ? params.name.toLowerCase() : existing.name
        const description =
          (params.description !== undefined ? params.description : existing.description) ?? null
        const isActive =
          params.isActive !== undefined ? params.isActive : (existing.is_active ?? true)

        await tx`
          UPDATE roles
          SET name = ${nameLower}, description = ${description}, is_active = ${isActive}, updated_at = NOW()
          WHERE id = ${id}
        `

        if (params.permissions !== undefined) {
          await tx`DELETE FROM role_permissions WHERE role_id = ${id}`
          await syncRolePermissions(tx, id, params.permissions)
        }
      })

      const updated = await getRoleById(sql, id)
      if (!updated) {
        throw AppError.internal('Failed to load updated role.')
      }
      return updated
    },
  )
}

export async function getPermissions(sql: Sql): Promise<Permission[]> {
  return withPgError(
    (err) => logger.error({ err }, 'Failed to query permissions'),
    async () => {
      const rows = await sql<Permission[]>`
        SELECT id, name, description, created_at::text, updated_at::text
        FROM permissions
        ORDER BY name ASC
      `
      return rows ?? []
    },
  )
}

export async function createPermission(
  sql: Sql,
  params: CreatePermissionParams,
): Promise<Permission> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to create permission'),
    async () => {
      const nameLower = params.name.toLowerCase()
      const rows = await sql<Permission[]>`
        INSERT INTO permissions (name, description)
        VALUES (${nameLower}, ${params.description ?? null})
        RETURNING id, name, description, created_at::text, updated_at::text
      `
      if (!rows || rows.length === 0) {
        throw AppError.internal('Failed to create permission.')
      }
      return rows[0]
    },
  )
}

export async function getUserRoles(sql: Sql, userId: string): Promise<string[]> {
  return withPgError(
    (err) => logger.error({ err, userId }, 'Failed to query user roles'),
    async () => {
      const rows = await sql<{ name: string }[]>`
        SELECT DISTINCT r.name
        FROM roles r
        JOIN user_roles ur ON r.id = ur.role_id
        WHERE ur.user_id = ${userId}
        UNION
        SELECT role as name
        FROM profiles
        WHERE user_id = ${userId} AND role IS NOT NULL
      `
      return rows.map((r) => r.name)
    },
  )
}

export async function assignUserRoles(
  sql: Sql,
  userId: string,
  roleNames: string[],
): Promise<void> {
  return withPgError(
    (err) => logger.error({ err, userId, roleNames }, 'Failed to assign user roles'),
    async () => {
      await sql.begin(async (tx) => {
        await syncUserRoles(tx, userId, roleNames, true)
      })
    },
  )
}

export async function getUserEffectivePermissions(sql: Sql, userId: string): Promise<string[]> {
  return withPgError(
    (err) => logger.error({ err, userId }, 'Failed to query effective permissions'),
    async () => {
      const rows = await sql<{ name: string }[]>`
        SELECT DISTINCT p.name
        FROM permissions p
        JOIN role_permissions rp ON p.id = rp.permission_id
        JOIN roles r ON rp.role_id = r.id
        WHERE r.is_active = true
          AND (
            r.id IN (SELECT role_id FROM user_roles WHERE user_id = ${userId})
            OR LOWER(r.name) IN (SELECT LOWER(role) FROM profiles WHERE user_id = ${userId})
          )
        ORDER BY p.name ASC
      `
      return rows.map((r) => r.name)
    },
  )
}

export async function createStaffProfile(
  sql: Sql,
  params: CreateStaffParams,
): Promise<UserProfile> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to create staff profile'),
    async () => {
      const emailLower = params.email.toLowerCase()
      const existingEmail = await sql<{ user_id: string }[]>`
        SELECT user_id FROM profiles WHERE LOWER(email) = ${emailLower} LIMIT 1
      `
      if (existingEmail.length > 0) {
        throw AppError.conflict(`Email "${params.email}" is already registered.`)
      }

      const userId = params.userId ?? `staff-${Date.now()}`
      let profile: UserProfile | null = null

      await sql.begin(async (tx) => {
        const rows = await tx<UserProfile[]>`
          INSERT INTO profiles (user_id, full_name, email, role, lifecycle_status, gender)
          VALUES (${userId}, ${params.fullName}, ${params.email}, ${params.role}, 'approved', ${params.gender ?? null})
          RETURNING user_id, full_name, email, nis, class_name, absence_number, avatar_url, role, lifecycle_status, gender
        `
        if (!rows || rows.length === 0) {
          throw AppError.internal('Failed to create staff profile.')
        }
        profile = rows[0]

        const allRoles = new Set<string>([params.role, ...(params.roles ?? [])])
        await syncUserRoles(tx, userId, allRoles)
      })

      if (!profile) {
        throw AppError.internal('Failed to create staff profile.')
      }
      return profile
    },
  )
}

export async function getStaffProfiles(sql: Sql): Promise<UserProfile[]> {
  return withPgError(
    (err) => logger.error({ err }, 'Failed to query staff profiles'),
    async () => {
      const rows = await sql<UserProfile[]>`
        SELECT user_id, full_name, email, nis, class_name, absence_number, avatar_url, role, lifecycle_status, gender
        FROM profiles
        WHERE role != 'student'
        ORDER BY created_at DESC
      `
      return rows ?? []
    },
  )
}

export async function getStaffProfile(sql: Sql, userId: string): Promise<UserProfile | null> {
  return withPgError(
    (err) => logger.error({ err, userId }, 'Failed to query staff profile'),
    async () => {
      const rows = await sql<UserProfile[]>`
        SELECT user_id, full_name, email, nis, class_name, absence_number, avatar_url, role, lifecycle_status, gender
        FROM profiles
        WHERE user_id = ${userId} AND role != 'student'
        LIMIT 1
      `
      return rows[0] ?? null
    },
  )
}

export async function updateStaffProfile(
  sql: Sql,
  userId: string,
  updates: UpdateStaffParams,
): Promise<UserProfile> {
  return withPgError(
    (err) => logger.error({ err, userId, updates }, 'Failed to update staff profile'),
    async () => {
      const existing = await getUserProfile(sql, userId)
      if (!existing) {
        throw AppError.notFound('Staff profile')
      }

      await sql.begin(async (tx) => {
        const fullName =
          (updates.fullName !== undefined ? updates.fullName : existing.full_name) ?? null
        const gender = (updates.gender !== undefined ? updates.gender : existing.gender) ?? null
        const role = (updates.role !== undefined ? updates.role : existing.role) ?? 'student'
        const lifecycleStatus =
          (updates.lifecycleStatus !== undefined
            ? updates.lifecycleStatus
            : existing.lifecycle_status) ?? 'approved'

        await tx`
          UPDATE profiles
          SET full_name = ${fullName}, gender = ${gender}, role = ${role}, lifecycle_status = ${lifecycleStatus}, updated_at = NOW()
          WHERE user_id = ${userId}
        `

        if (updates.roles !== undefined || updates.role !== undefined) {
          const allRoles = new Set<string>()
          if (updates.role) allRoles.add(updates.role)
          if (updates.roles) {
            for (const r of updates.roles) allRoles.add(r)
          }
          await syncUserRoles(tx, userId, allRoles, true)
        }

        if (
          updates.lifecycleStatus !== undefined ||
          updates.role !== undefined ||
          updates.roles !== undefined
        ) {
          await tx`
            INSERT INTO revoked_sessions (user_id)
            VALUES (${userId})
          `
        }
      })

      return getUserProfile(sql, userId)
    },
  )
}
