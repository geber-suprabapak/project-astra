import type { Hono } from 'hono'
import { successResponse } from '../../../lib/http/responses.js'
import type { AppEnv } from '../../../types/context.js'
import {
  createPermissionSchema,
  createRoleSchema,
  createStaffSchema,
  requestStaffPasswordResetSchema,
  updateRoleSchema,
  updateStaffSchema,
} from '../schema.js'
import {
  createPermission,
  createRole,
  createStaff,
  getRole,
  getStaff,
  getStaffEffectivePermissions,
  listPermissions,
  listRoles,
  listStaff,
  requestStaffPasswordReset,
  updateRole,
  updateStaff,
} from '../service.js'
import { type AdminRouterDeps, parseJsonBody, resolveAdminProviders } from './shared.js'

export function registerRbacStaffRoutes(router: Hono<AppEnv>, deps: AdminRouterDeps): void {
  // GET /v1/admin/roles
  router.get('/roles', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const roles = await listRoles({
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, roles, 'Roles retrieved successfully.')
  })

  // GET /v1/admin/roles/:id
  router.get('/roles/:id', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const id = c.req.param('id')
    const role = await getRole({
      id,
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, role, 'Role retrieved successfully.')
  })

  // POST /v1/admin/roles
  router.post('/roles', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const data = await parseJsonBody(c, createRoleSchema)

    const role = await createRole({
      name: data.name,
      description: data.description,
      permissions: data.permissions,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, role, 'Role created successfully.', 201)
  })

  // PATCH /v1/admin/roles/:id
  router.patch('/roles/:id', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const id = c.req.param('id')
    const data = await parseJsonBody(c, updateRoleSchema)

    const isActive = data.is_active ?? data.isActive
    const role = await updateRole({
      id,
      name: data.name,
      description: data.description,
      permissions: data.permissions,
      isActive,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, role, 'Role updated successfully.')
  })

  // GET /v1/admin/permissions
  router.get('/permissions', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const permissions = await listPermissions({
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, permissions, 'Permissions retrieved successfully.')
  })

  // POST /v1/admin/permissions
  router.post('/permissions', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const data = await parseJsonBody(c, createPermissionSchema)

    const perm = await createPermission({
      name: data.name,
      description: data.description,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, perm, 'Permission created successfully.', 201)
  })

  // GET /v1/admin/staff
  router.get('/staff', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const staff = await listStaff({
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, staff, 'Staff profiles retrieved successfully.')
  })

  // GET /v1/admin/staff/:userId
  router.get('/staff/:userId', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const userId = c.req.param('userId')
    const staff = await getStaff({
      userId,
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, staff, 'Staff profile retrieved successfully.')
  })

  // POST /v1/admin/staff
  router.post('/staff', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const data = await parseJsonBody(c, createStaffSchema)

    const userId = data.user_id ?? data.userId
    const fullName = (data.full_name ?? data.fullName)!

    const staff = await createStaff({
      userId,
      email: data.email,
      fullName,
      role: data.role,
      roles: data.roles,
      gender: data.gender,
      password: data.password,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, staff, 'Staff profile created successfully.', 201)
  })

  // PATCH /v1/admin/staff/:userId
  router.patch('/staff/:userId', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const userId = c.req.param('userId')
    const data = await parseJsonBody(c, updateStaffSchema)

    const fullName = data.full_name ?? data.fullName
    const lifecycleStatus = data.lifecycle_status ?? data.lifecycleStatus

    const staff = await updateStaff({
      userId,
      fullName,
      role: data.role,
      roles: data.roles,
      lifecycleStatus,
      gender: data.gender,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, staff, 'Staff profile updated successfully.')
  })

  // POST /v1/admin/staff/:userId/reset-password
  router.post('/staff/:userId/reset-password', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const userId = c.req.param('userId')
    let email: string | undefined
    try {
      const body = await c.req.json()
      const parsed = requestStaffPasswordResetSchema.safeParse(body)
      if (parsed.success) {
        email = parsed.data.email
      }
    } catch {
      // Body is optional
    }

    const result = await requestStaffPasswordReset({
      userId,
      email,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, result, result.message)
  })

  // GET /v1/admin/staff/:userId/effective-permissions
  router.get('/staff/:userId/effective-permissions', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const userId = c.req.param('userId')
    const result = await getStaffEffectivePermissions({
      userId,
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, result, 'Effective permissions retrieved successfully.')
  })
}
