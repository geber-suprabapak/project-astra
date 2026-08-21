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
  classEnrollmentStatusSchema,
  createAcademicPeriodSchema,
  createCalendarExceptionSchema,
  createClassSchema,
  createLocationSchema,
  createPermissionSchema,
  createRoleSchema,
  createScheduleSchema,
  createSchoolAdminSchema,
  createStaffSchema,
  enrollStudentSchema,
  exitStudentEnrollmentSchema,
  promoteStudentEnrollmentSchema,
  rejectStudentSchema,
  requestStaffPasswordResetSchema,
  stageRosterSchema,
  transferStudentEnrollmentSchema,
  updateAcademicPeriodSchema,
  updateCalendarExceptionSchema,
  updateClassSchema,
  updateLocationSchema,
  updateRoleSchema,
  updateScheduleSchema,
  updateStaffSchema,
  updateStudentEmailSchema,
} from './schema.js'
import {
  acceptRosterReport,
  approveStudent,
  bootstrapSchool,
  correctStudentEmail,
  createAcademicPeriod,
  createCalendarException,
  createClass,
  createLocation,
  createPermission,
  createRole,
  createSchedule,
  createSchoolAdmin,
  createStaff,
  deleteCalendarException,
  deleteLocation,
  deleteSchedule,
  disableStudent,
  enrollStudent,
  exitStudentEnrollment,
  generateStudentResetCode,
  getBootstrapStatus,
  getCalendarException,
  getLocation,
  getPrivilegedSession,
  getRole,
  getRosterReport,
  getSchedule,
  getStaff,
  getStaffEffectivePermissions,
  getStudent,
  listAcademicPeriods,
  listCalendarExceptions,
  listClasses,
  listClassEnrollments,
  listLocations,
  listPermissions,
  listRoles,
  listSchedules,
  listStaff,
  listStudents,
  openStudentSignup,
  promoteStudentEnrollment,
  rejectStudent,
  requestStaffPasswordReset,
  setActiveAcademicPeriod,
  transferStudentEnrollment,
  updateAcademicPeriod,
  updateCalendarException,
  updateClass,
  updateLocation,
  updateRole,
  updateSchedule,
  updateStaff,
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

  // -------------------------------------------------------------------------
  // Academic Attendance Policy Routes
  // -------------------------------------------------------------------------

  // GET /v1/admin/academic-periods
  router.get('/academic-periods', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const isActiveQuery = c.req.query('is_active') ?? c.req.query('isActive')
    const isActive = isActiveQuery !== undefined ? isActiveQuery === 'true' : undefined
    const periods = await listAcademicPeriods({
      actorRole: c.get('profileRole'),
      filter: { isActive },
      providers,
    })
    return successResponse(c, periods, 'Academic periods retrieved successfully.')
  })

  // POST /v1/admin/academic-periods
  router.post('/academic-periods', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const body = await c.req.json()
    const parsed = createAcademicPeriodSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }
    const period = await createAcademicPeriod({
      name: parsed.data.name,
      startDate: parsed.data.start_date ?? parsed.data.startDate!,
      endDate: parsed.data.end_date ?? parsed.data.endDate!,
      isActive: parsed.data.is_active ?? parsed.data.isActive,
      schoolId: parsed.data.school_id ?? parsed.data.schoolId,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, period, 'Academic period created successfully.', 201)
  })

  // PUT /v1/admin/academic-periods/:id
  router.put('/academic-periods/:id', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const id = c.req.param('id')
    const body = await c.req.json()
    const parsed = updateAcademicPeriodSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }
    const period = await updateAcademicPeriod({
      id,
      name: parsed.data.name,
      startDate: parsed.data.start_date ?? parsed.data.startDate,
      endDate: parsed.data.end_date ?? parsed.data.endDate,
      isActive: parsed.data.is_active ?? parsed.data.isActive,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, period, 'Academic period updated successfully.')
  })

  // POST /v1/admin/academic-periods/:id/set-active
  router.post('/academic-periods/:id/set-active', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const id = c.req.param('id')
    const period = await setActiveAcademicPeriod({
      id,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, period, 'Academic period activated successfully.')
  })

  // GET /v1/admin/classes
  router.get('/classes', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const schoolId = c.req.query('school_id') ?? c.req.query('schoolId')
    const academicPeriodId = c.req.query('academic_period_id') ?? c.req.query('academicPeriodId')
    const classes = await listClasses({
      schoolId,
      academicPeriodId,
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, classes, 'Classes retrieved successfully.')
  })

  // POST /v1/admin/classes
  router.post('/classes', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const body = await c.req.json()
    const parsed = createClassSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }
    const cls = await createClass({
      name: parsed.data.name,
      grade: parsed.data.grade,
      academicPeriodId: parsed.data.academic_period_id ?? parsed.data.academicPeriodId,
      schoolId: parsed.data.school_id ?? parsed.data.schoolId,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, cls, 'Class created successfully.', 201)
  })

  // PUT /v1/admin/classes/:id
  router.put('/classes/:id', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const id = c.req.param('id')
    const body = await c.req.json()
    const parsed = updateClassSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }
    const cls = await updateClass({
      id,
      name: parsed.data.name,
      grade: parsed.data.grade,
      academicPeriodId: parsed.data.academic_period_id ?? parsed.data.academicPeriodId,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, cls, 'Class updated successfully.')
  })

  // GET /v1/admin/enrollments
  router.get('/enrollments', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const userId = c.req.query('user_id') ?? c.req.query('userId')
    const classId = c.req.query('class_id') ?? c.req.query('classId')
    const academicPeriodId = c.req.query('academic_period_id') ?? c.req.query('academicPeriodId')
    const statusParam = c.req.query('status')
    const parsedStatus = statusParam ? classEnrollmentStatusSchema.safeParse(statusParam) : null
    const status = parsedStatus?.success ? parsedStatus.data : undefined
    const enrollments = await listClassEnrollments({
      userId,
      classId,
      academicPeriodId,
      status,
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, enrollments, 'Class enrollments retrieved successfully.')
  })

  // POST /v1/admin/enrollments
  router.post('/enrollments', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const body = await c.req.json()
    const parsed = enrollStudentSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }
    const enrollment = await enrollStudent({
      userId: parsed.data.user_id ?? parsed.data.userId!,
      classId: parsed.data.class_id ?? parsed.data.classId!,
      academicPeriodId: parsed.data.academic_period_id ?? parsed.data.academicPeriodId!,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, enrollment, 'Student enrolled successfully.', 201)
  })

  // POST /v1/admin/enrollments/transfer
  router.post('/enrollments/transfer', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const body = await c.req.json()
    const parsed = transferStudentEnrollmentSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }
    const result = await transferStudentEnrollment({
      userId: parsed.data.user_id ?? parsed.data.userId!,
      toClassId: parsed.data.to_class_id ?? parsed.data.toClassId!,
      academicPeriodId: parsed.data.academic_period_id ?? parsed.data.academicPeriodId!,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, result, 'Student enrollment transferred successfully.')
  })

  // POST /v1/admin/enrollments/promote
  router.post('/enrollments/promote', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const body = await c.req.json()
    const parsed = promoteStudentEnrollmentSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }
    const result = await promoteStudentEnrollment({
      userId: parsed.data.user_id ?? parsed.data.userId!,
      fromAcademicPeriodId: parsed.data.from_academic_period_id ?? parsed.data.fromAcademicPeriodId!,
      toAcademicPeriodId: parsed.data.to_academic_period_id ?? parsed.data.toAcademicPeriodId!,
      toClassId: parsed.data.to_class_id ?? parsed.data.toClassId!,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, result, 'Student enrollment promoted successfully.')
  })

  // POST /v1/admin/enrollments/exit
  router.post('/enrollments/exit', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const body = await c.req.json()
    const parsed = exitStudentEnrollmentSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }
    const result = await exitStudentEnrollment({
      userId: parsed.data.user_id ?? parsed.data.userId!,
      academicPeriodId: parsed.data.academic_period_id ?? parsed.data.academicPeriodId!,
      status: parsed.data.status,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, result, 'Student enrollment exited successfully.')
  })

  // GET /v1/admin/schedules
  router.get('/schedules', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const classId = c.req.query('class_id') ?? c.req.query('classId')
    const academicPeriodId = c.req.query('academic_period_id') ?? c.req.query('academicPeriodId')
    const dayOfWeek = c.req.query('day_of_week') ?? c.req.query('dayOfWeek')
    const isActiveQuery = c.req.query('is_active') ?? c.req.query('isActive')
    const isActive = isActiveQuery !== undefined ? isActiveQuery === 'true' : undefined
    const schedules = await listSchedules({
      filter: { classId, academicPeriodId, dayOfWeek, isActive },
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, schedules, 'Schedules retrieved successfully.')
  })

  // GET /v1/admin/schedules/:id
  router.get('/schedules/:id', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const id = c.req.param('id')
    const schedule = await getSchedule({
      id,
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, schedule, 'Schedule retrieved successfully.')
  })

  // POST /v1/admin/schedules
  router.post('/schedules', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const body = await c.req.json()
    const parsed = createScheduleSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }
    const schedule = await createSchedule({
      schoolId: parsed.data.school_id ?? parsed.data.schoolId,
      classId: parsed.data.class_id ?? parsed.data.classId,
      academicPeriodId: parsed.data.academic_period_id ?? parsed.data.academicPeriodId,
      locationId: parsed.data.location_id ?? parsed.data.locationId,
      dayOfWeek: parsed.data.day_of_week ?? parsed.data.dayOfWeek!,
      startTime: parsed.data.start_time ?? parsed.data.startTime!,
      endTime: parsed.data.end_time ?? parsed.data.endTime!,
      startCheckout: parsed.data.start_checkout ?? parsed.data.startCheckout!,
      endCheckout: parsed.data.end_checkout ?? parsed.data.endCheckout!,
      gracePeriodMinutes: parsed.data.grace_period_minutes ?? parsed.data.gracePeriodMinutes,
      isActive: parsed.data.is_active ?? parsed.data.isActive,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, schedule, 'Schedule created successfully.', 201)
  })

  // PUT /v1/admin/schedules/:id
  router.put('/schedules/:id', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const id = c.req.param('id')
    const body = await c.req.json()
    const parsed = updateScheduleSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }
    const schedule = await updateSchedule({
      id,
      classId: parsed.data.class_id ?? parsed.data.classId,
      academicPeriodId: parsed.data.academic_period_id ?? parsed.data.academicPeriodId,
      locationId: parsed.data.location_id ?? parsed.data.locationId,
      dayOfWeek: parsed.data.day_of_week ?? parsed.data.dayOfWeek,
      startTime: parsed.data.start_time ?? parsed.data.startTime,
      endTime: parsed.data.end_time ?? parsed.data.endTime,
      startCheckout: parsed.data.start_checkout ?? parsed.data.startCheckout,
      endCheckout: parsed.data.end_checkout ?? parsed.data.endCheckout,
      gracePeriodMinutes: parsed.data.grace_period_minutes ?? parsed.data.gracePeriodMinutes,
      isActive: parsed.data.is_active ?? parsed.data.isActive,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, schedule, 'Schedule updated successfully.')
  })

  // DELETE /v1/admin/schedules/:id
  router.delete('/schedules/:id', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const id = c.req.param('id')
    await deleteSchedule({
      id,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, { id }, 'Schedule deleted successfully.')
  })

  // GET /v1/admin/locations
  router.get('/locations', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const isActiveQuery = c.req.query('is_active') ?? c.req.query('isActive')
    const isActive = isActiveQuery !== undefined ? isActiveQuery === 'true' : undefined
    const locations = await listLocations({
      filter: { isActive },
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, locations, 'Locations retrieved successfully.')
  })

  // GET /v1/admin/locations/:id
  router.get('/locations/:id', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const id = c.req.param('id')
    const loc = await getLocation({
      id,
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, loc, 'Location retrieved successfully.')
  })

  // POST /v1/admin/locations
  router.post('/locations', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const body = await c.req.json()
    const parsed = createLocationSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }
    const loc = await createLocation({
      name: parsed.data.name,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      radiusMeters: parsed.data.radius_meters ?? parsed.data.radiusMeters,
      isActive: parsed.data.is_active ?? parsed.data.isActive,
      schoolId: parsed.data.school_id ?? parsed.data.schoolId,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, loc, 'Location created successfully.', 201)
  })

  // PUT /v1/admin/locations/:id
  router.put('/locations/:id', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const id = c.req.param('id')
    const body = await c.req.json()
    const parsed = updateLocationSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }
    const loc = await updateLocation({
      id,
      name: parsed.data.name,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      radiusMeters: parsed.data.radius_meters ?? parsed.data.radiusMeters,
      isActive: parsed.data.is_active ?? parsed.data.isActive,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, loc, 'Location updated successfully.')
  })

  // DELETE /v1/admin/locations/:id
  router.delete('/locations/:id', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const id = c.req.param('id')
    await deleteLocation({
      id,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, { id }, 'Location deleted successfully.')
  })

  // GET /v1/admin/calendar-exceptions
  router.get('/calendar-exceptions', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const academicPeriodId = c.req.query('academic_period_id') ?? c.req.query('academicPeriodId')
    const startDate = c.req.query('start_date') ?? c.req.query('startDate')
    const endDate = c.req.query('end_date') ?? c.req.query('endDate')
    const exceptions = await listCalendarExceptions({
      filter: { academicPeriodId, startDate, endDate },
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, exceptions, 'Calendar exceptions retrieved successfully.')
  })

  // GET /v1/admin/calendar-exceptions/:id
  router.get('/calendar-exceptions/:id', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const id = c.req.param('id')
    const exc = await getCalendarException({
      id,
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, exc, 'Calendar exception retrieved successfully.')
  })

  // POST /v1/admin/calendar-exceptions
  router.post('/calendar-exceptions', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const body = await c.req.json()
    const parsed = createCalendarExceptionSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }
    const exc = await createCalendarException({
      date: parsed.data.date,
      reason: parsed.data.reason,
      isHoliday: parsed.data.is_holiday ?? parsed.data.isHoliday,
      academicPeriodId: parsed.data.academic_period_id ?? parsed.data.academicPeriodId,
      schoolId: parsed.data.school_id ?? parsed.data.schoolId,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, exc, 'Calendar exception created successfully.', 201)
  })

  // PUT /v1/admin/calendar-exceptions/:id
  router.put('/calendar-exceptions/:id', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const id = c.req.param('id')
    const body = await c.req.json()
    const parsed = updateCalendarExceptionSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }
    const exc = await updateCalendarException({
      id,
      academicPeriodId: parsed.data.academic_period_id ?? parsed.data.academicPeriodId,
      date: parsed.data.date,
      reason: parsed.data.reason,
      isHoliday: parsed.data.is_holiday ?? parsed.data.isHoliday,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, exc, 'Calendar exception updated successfully.')
  })

  // DELETE /v1/admin/calendar-exceptions/:id
  router.delete('/calendar-exceptions/:id', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const id = c.req.param('id')
    await deleteCalendarException({
      id,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, { id }, 'Calendar exception deleted successfully.')
  })

  return router
}

export const adminRouter = createAdminRouter()

