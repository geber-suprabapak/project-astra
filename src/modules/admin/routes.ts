import { Hono } from 'hono'
import { auth } from '../../middleware/auth.js'
import { privilegedAuth } from '../../middleware/privileged-auth.js'
import { rateLimits } from '../../middleware/rate-limit.js'
import { successResponse } from '../../lib/http/responses.js'
import { AppError } from '../../lib/errors/app-error.js'
import { defaultProviders } from '../../providers/index.js'
import type { AppProviders } from '../../providers/types.js'
import type { AppEnv } from '../../types/context.js'
import {
  bootstrapSchoolSchema,
  createPermissionSchema,
  createRoleSchema,
  createSchoolAdminSchema,
  createStaffSchema,
  requestStaffPasswordResetSchema,
  stageRosterSchema,
  updateRoleSchema,
  updateStaffSchema,
  rejectStudentSchema,
  updateStudentEmailSchema,
} from './schema.js'
import {
  acceptRosterReport,
  approveStudent,
  bootstrapSchool,
  createPermission,
  createRole,
  createSchoolAdmin,
  createStaff,
  correctStudentEmail,
  disableStudent,
  generateStudentResetCode,
  getBootstrapStatus,
  getPrivilegedSession,
  getRole,
  getRosterReport,
  getStaff,
  getStaffEffectivePermissions,
  listPermissions,
  listRoles,
  listStaff,
  openStudentSignup,
  requestStaffPasswordReset,
  updateRole,
  updateStaff,
  getStudent,
  listStudents,
  rejectStudent,
  validateAndStageRoster,
} from './service.js'
import { profileLifecycleStatusSchema } from '../../providers/types.js'

export interface AdminRouterDeps {
  providers?: AppProviders
}

export function createAdminRouter(deps: AdminRouterDeps = {}) {
  const router = new Hono<AppEnv>()

  router.use('*', auth)
  router.use('*', privilegedAuth)
  router.use('*', rateLimits.adminSession)

  // GET /v1/admin/session
  router.get('/session', (c) =>
    successResponse(
      c,
      getPrivilegedSession({
        userId: c.get('userId'),
        profileRole: c.get('profileRole'),
        profileStatus: c.get('profileLifecycleStatus'),
        identityUser: c.get('identityUser'),
      }),
      'Privileged session is active.',
    ),
  )

  // GET /v1/admin/bootstrap/status
  router.get('/bootstrap/status', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const status = await getBootstrapStatus(providers)
    return successResponse(c, status, 'Bootstrap status retrieved.')
  })

  // POST /v1/admin/bootstrap/school
  router.post('/bootstrap/school', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const body = await c.req.json()
    const parsed = bootstrapSchoolSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }

    const school = await bootstrapSchool({
      name: parsed.data.name,
      slug: parsed.data.slug,
      timezone: parsed.data.timezone,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, school, 'School bootstrapped successfully.', 201)
  })

  // POST /v1/admin/bootstrap/school-admin
  router.post('/bootstrap/school-admin', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const body = await c.req.json()
    const parsed = createSchoolAdminSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }

    const targetUserId = (parsed.data.user_id ?? parsed.data.userId)!
    const fullName = parsed.data.full_name ?? parsed.data.fullName ?? null
    const email = parsed.data.email ?? null

    const profile = await createSchoolAdmin({
      userId: targetUserId,
      fullName,
      email,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, profile, 'School admin profile created successfully.', 201)
  })

  // POST /v1/admin/bootstrap/roster
  router.post('/bootstrap/roster', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const body = await c.req.json()
    const parsed = stageRosterSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }

    const report = await validateAndStageRoster({
      rows: parsed.data.rows,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    const message =
      report.rejected_rows > 0
        ? 'Roster staged and validated with errors.'
        : 'Roster staged and validated.'

    return successResponse(c, report, message, 201)
  })

  // GET /v1/admin/bootstrap/roster/:id
  router.get('/bootstrap/roster/:id', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const id = c.req.param('id')
    const report = await getRosterReport({
      id,
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, report, 'Roster report retrieved.')
  })

  // POST /v1/admin/bootstrap/roster/:id/accept
  router.post('/bootstrap/roster/:id/accept', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const id = c.req.param('id')
    const report = await acceptRosterReport({
      id,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(
      c,
      report,
      'Roster report accepted and canonical records committed.',
    )
  })

  // POST /v1/admin/bootstrap/signup/open
  router.post('/bootstrap/signup/open', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const result = await openStudentSignup({
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, result, 'Student signup is now open.')
  })
  // GET /v1/admin/students
  router.get('/students', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const statusQuery = c.req.query('status')
    let parsedStatus
    if (statusQuery) {
      const parsed = profileLifecycleStatusSchema.safeParse(statusQuery)
      if (!parsed.success) {
        throw AppError.validationError('Invalid status query parameter.')
      }
      parsedStatus = parsed.data
    }

    const students = await listStudents({
      status: parsedStatus,
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, students, 'Student profiles retrieved.')
  })

  // GET /v1/admin/students/:userId
  router.get('/students/:userId', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const userId = c.req.param('userId')
    const student = await getStudent({
      userId,
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, student, 'Student profile retrieved.')
  })

  // POST /v1/admin/students/:userId/approve
  router.post('/students/:userId/approve', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const userId = c.req.param('userId')
    const student = await approveStudent({
      userId,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, student, 'Student profile approved successfully.')
  })

  // POST /v1/admin/students/:userId/reject
  router.post('/students/:userId/reject', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const userId = c.req.param('userId')
    let reason: string | undefined
    try {
      const body = await c.req.json()
      const parsed = rejectStudentSchema.safeParse(body)
      if (parsed.success) {
        reason = parsed.data.reason
      }
    } catch {
      // Empty body is acceptable.
    }

    const student = await rejectStudent({
      userId,
      reason,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, student, 'Student profile rejected.')
  })

  // POST /v1/admin/students/:userId/disable
  router.post('/students/:userId/disable', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const userId = c.req.param('userId')
    const student = await disableStudent({
      userId,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, student, 'Student profile disabled.')
  })

  // POST /v1/admin/students/:userId/reset-code
  router.post('/students/:userId/reset-code', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const userId = c.req.param('userId')
    const resetCode = await generateStudentResetCode({
      userId,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(
      c,
      resetCode,
      'One-time password reset code generated successfully.',
      201,
    )
  })

  // PATCH /v1/admin/students/:userId/email
  router.patch('/students/:userId/email', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const userId = c.req.param('userId')
    const body = await c.req.json()
    const parsed = updateStudentEmailSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }

    const student = await correctStudentEmail({
      userId,
      email: parsed.data.email,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, student, 'Student email corrected successfully.')
  })

  // GET /v1/admin/roles
  router.get('/roles', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const roles = await listRoles({
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, roles, 'Roles retrieved successfully.')
  })

  // GET /v1/admin/roles/:id
  router.get('/roles/:id', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
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
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const body = await c.req.json()
    const parsed = createRoleSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }

    const role = await createRole({
      name: parsed.data.name,
      description: parsed.data.description,
      permissions: parsed.data.permissions,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, role, 'Role created successfully.', 201)
  })

  // PATCH /v1/admin/roles/:id
  router.patch('/roles/:id', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const id = c.req.param('id')
    const body = await c.req.json()
    const parsed = updateRoleSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }

    const isActive = parsed.data.is_active ?? parsed.data.isActive
    const role = await updateRole({
      id,
      name: parsed.data.name,
      description: parsed.data.description,
      permissions: parsed.data.permissions,
      isActive,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, role, 'Role updated successfully.')
  })

  // GET /v1/admin/permissions
  router.get('/permissions', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const permissions = await listPermissions({
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, permissions, 'Permissions retrieved successfully.')
  })

  // POST /v1/admin/permissions
  router.post('/permissions', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const body = await c.req.json()
    const parsed = createPermissionSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }

    const perm = await createPermission({
      name: parsed.data.name,
      description: parsed.data.description,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, perm, 'Permission created successfully.', 201)
  })

  // GET /v1/admin/staff
  router.get('/staff', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const staff = await listStaff({
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, staff, 'Staff profiles retrieved successfully.')
  })

  // GET /v1/admin/staff/:userId
  router.get('/staff/:userId', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
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
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const body = await c.req.json()
    const parsed = createStaffSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }

    const userId = parsed.data.user_id ?? parsed.data.userId
    const fullName = (parsed.data.full_name ?? parsed.data.fullName)!

    const staff = await createStaff({
      userId,
      email: parsed.data.email,
      fullName,
      role: parsed.data.role,
      roles: parsed.data.roles,
      gender: parsed.data.gender,
      password: parsed.data.password,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, staff, 'Staff profile created successfully.', 201)
  })

  // PATCH /v1/admin/staff/:userId
  router.patch('/staff/:userId', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const userId = c.req.param('userId')
    const body = await c.req.json()
    const parsed = updateStaffSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }

    const fullName = parsed.data.full_name ?? parsed.data.fullName
    const lifecycleStatus = parsed.data.lifecycle_status ?? parsed.data.lifecycleStatus

    const staff = await updateStaff({
      userId,
      fullName,
      role: parsed.data.role,
      roles: parsed.data.roles,
      lifecycleStatus,
      gender: parsed.data.gender,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, staff, 'Staff profile updated successfully.')
  })

  // POST /v1/admin/staff/:userId/reset-password
  router.post('/staff/:userId/reset-password', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
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
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const userId = c.req.param('userId')
    const result = await getStaffEffectivePermissions({
      userId,
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, result, 'Effective permissions retrieved successfully.')
  })

  return router
}

export const adminRouter = createAdminRouter()
