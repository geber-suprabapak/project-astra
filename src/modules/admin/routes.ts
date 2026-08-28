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
  createAdminLeaveRequestSchema,
  createCalendarExceptionSchema,
  createClassSchema,
  createLocationSchema,
  createManualAttendanceSchema,
  createPermissionSchema,
  createRoleSchema,
  createScheduleSchema,
  createSchoolAdminSchema,
  createStaffSchema,
  enqueueAdminNotificationSchema,
  enrollStudentSchema,
  exitStudentEnrollmentSchema,
  promoteStudentEnrollmentSchema,
  rejectLeaveRequestSchema,
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
  approveLeaveRequest,
  approveStudent,
  bootstrapSchool,
  correctStudentEmail,
  createAcademicPeriod,
  createAdminLeaveRequest,
  createCalendarException,
  createClass,
  createLocation,
  createManualAttendance,
  createPermission,
  createRole,
  createSchedule,
  createSchoolAdmin,
  createStaff,
  deleteAdminLeaveRequest,
  deleteAdminNotification,
  deleteCalendarException,
  deleteLocation,
  deleteSchedule,
  disableStudent,
  enqueueAdminNotification,
  enrollStudent,
  exitStudentEnrollment,
  generateStudentResetCode,
  getAdminLeaveRequest,
  getAdminNotification,
  getAttendanceAttempt,
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
  listAdminLeaveRequests,
  listAdminNotifications,
  listAttendanceAttempts,
  listAttendances,
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
  rejectLeaveRequest,
  rejectStudent,
  requestStaffPasswordReset,
  resetStudentFaceEnrollment,
  retryAdminNotification,
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
import {
  attendanceActionTypeSchema,
  attendanceAttemptStatusSchema,
  leaveRequestApprovalStatusSchema,
  leaveRequestCategorySchema,
  notificationChannelSchema,
  notificationStatusSchema,
  profileLifecycleStatusSchema,
} from '../../providers/types.js'

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

    return successResponse(c, report, 'Roster report accepted and canonical records committed.')
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

  // DELETE /v1/admin/students/:userId/face-enrollment
  router.delete('/students/:userId/face-enrollment', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const userId = c.req.param('userId')
    await resetStudentFaceEnrollment({
      userId,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, null, 'Student face enrollment reset successfully.')
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
      fromAcademicPeriodId:
        parsed.data.from_academic_period_id ?? parsed.data.fromAcademicPeriodId!,
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

  // PUT|PATCH /v1/admin/schedules/:id
  const handleUpdateSchedule = async (c: any) => {
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
  }

  router.put('/schedules/:id', handleUpdateSchedule)
  router.patch('/schedules/:id', handleUpdateSchedule)

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

  // PUT|PATCH /v1/admin/locations/:id
  const handleUpdateLocation = async (c: any) => {
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
  }

  router.put('/locations/:id', handleUpdateLocation)
  router.patch('/locations/:id', handleUpdateLocation)

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

  // -------------------------------------------------------------------------
  // Manual Attendance & Attendance Attempts Routes
  // -------------------------------------------------------------------------

  // POST /v1/admin/attendance/manual & /v1/admin/attendances/manual
  const handleCreateManualAttendance = async (c: any) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const body = await c.req.json()
    const parsed = createManualAttendanceSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }

    const targetUserId = (parsed.data.user_id ?? parsed.data.userId)!
    const actionType = (parsed.data.action_type ?? parsed.data.actionType)!
    const attemptId = parsed.data.attempt_id ?? parsed.data.attemptId ?? null

    const attendance = await createManualAttendance({
      userId: targetUserId,
      actionType,
      status: parsed.data.status,
      reason: parsed.data.reason,
      date: parsed.data.date,
      attemptId,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, attendance, 'Manual attendance recorded successfully.', 201)
  }

  router.post('/attendance/manual', handleCreateManualAttendance)
  router.post('/attendances/manual', handleCreateManualAttendance)

  // GET /v1/admin/attendance/attempts & /v1/admin/attendances/attempts
  const handleListAttendanceAttempts = async (c: any) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const userId = c.req.query('user_id') ?? c.req.query('userId')
    const statusQuery = c.req.query('status')
    const actionTypeQuery = c.req.query('action_type') ?? c.req.query('actionType')
    const limitQuery = c.req.query('limit')

    const statusParsed = statusQuery ? attendanceAttemptStatusSchema.safeParse(statusQuery) : null
    const actionTypeParsed = actionTypeQuery
      ? attendanceActionTypeSchema.safeParse(actionTypeQuery)
      : null

    if (statusQuery && (!statusParsed || !statusParsed.success)) {
      throw AppError.validationError('Invalid status query parameter.')
    }
    if (actionTypeQuery && (!actionTypeParsed || !actionTypeParsed.success)) {
      throw AppError.validationError('Invalid action_type query parameter.')
    }

    const limit = limitQuery ? Number(limitQuery) : undefined

    const attempts = await listAttendanceAttempts({
      filter: {
        userId,
        status: statusParsed ? statusParsed.data : undefined,
        actionType: actionTypeParsed ? actionTypeParsed.data : undefined,
        limit,
      },
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, attempts, 'Attendance attempts retrieved successfully.')
  }

  router.get('/attendance/attempts', handleListAttendanceAttempts)
  router.get('/attendances/attempts', handleListAttendanceAttempts)

  // GET /v1/admin/attendance/attempts/:id & /v1/admin/attendances/attempts/:id
  const handleGetAttendanceAttempt = async (c: any) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const id = c.req.param('id')
    const attempt = await getAttendanceAttempt({
      id,
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, attempt, 'Attendance attempt retrieved successfully.')
  }

  router.get('/attendance/attempts/:id', handleGetAttendanceAttempt)
  router.get('/attendances/attempts/:id', handleGetAttendanceAttempt)

  // GET /v1/admin/attendance & /v1/admin/attendances
  const handleListAttendances = async (c: any) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const userId = c.req.query('user_id') ?? c.req.query('userId')
    const date = c.req.query('date')
    const status = c.req.query('status')
    const actionType = c.req.query('action_type') ?? c.req.query('actionType')
    const limitQuery = c.req.query('limit')
    const limit = limitQuery ? Number(limitQuery) : undefined

    const attendances = await listAttendances({
      filter: { userId, date, status, actionType, limit },
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, attendances, 'Attendances retrieved successfully.')
  }

  router.get('/attendance', handleListAttendances)
  router.get('/attendances', handleListAttendances)

  // -------------------------------------------------------------------------
  // Leave Requests Routes
  // -------------------------------------------------------------------------

  // GET /v1/admin/leave-requests & /v1/admin/permits
  const handleListLeaveRequests = async (c: any) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const userId =
      c.req.query('user_id') ??
      c.req.query('userId') ??
      c.req.query('student_id') ??
      c.req.query('studentId')
    const statusQuery =
      c.req.query('status') ?? c.req.query('approval_status') ?? c.req.query('approvalStatus')
    const categoryQuery = c.req.query('category')
    const startDate = c.req.query('start_date') ?? c.req.query('startDate')
    const endDate = c.req.query('end_date') ?? c.req.query('endDate')
    const limitQuery = c.req.query('limit')
    const offsetQuery = c.req.query('offset')

    const statusParsed = statusQuery
      ? leaveRequestApprovalStatusSchema.safeParse(statusQuery)
      : null
    const categoryParsed = categoryQuery
      ? leaveRequestCategorySchema.safeParse(categoryQuery)
      : null

    if (statusQuery && (!statusParsed || !statusParsed.success)) {
      throw AppError.validationError('Invalid status query parameter.')
    }
    if (categoryQuery && (!categoryParsed || !categoryParsed.success)) {
      throw AppError.validationError('Invalid category query parameter.')
    }

    const limit = limitQuery ? Number(limitQuery) : undefined
    const offset = offsetQuery ? Number(offsetQuery) : undefined

    const leaveRequests = await listAdminLeaveRequests({
      filter: {
        userId,
        approvalStatus: statusParsed ? statusParsed.data : undefined,
        category: categoryParsed ? categoryParsed.data : undefined,
        startDate,
        endDate,
        limit,
        offset,
      },
      actorRole: c.get('profileRole'),
      actorId: c.get('userId'),
      providers,
    })

    return successResponse(c, leaveRequests, 'Leave requests retrieved successfully.')
  }

  router.get('/leave-requests', handleListLeaveRequests)
  router.get('/permits', handleListLeaveRequests)

  // POST /v1/admin/leave-requests & /v1/admin/permits
  const handleCreateAdminLeaveRequest = async (c: any) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const body = await c.req.json()
    const parsed = createAdminLeaveRequestSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }

    const userId = parsed.data.user_id ?? parsed.data.userId
    const fileId = parsed.data.file_id ?? parsed.data.fileId
    const approvalStatus = parsed.data.approval_status ?? parsed.data.approvalStatus ?? 'approved'

    const created = await createAdminLeaveRequest({
      userId: userId!,
      category: parsed.data.category,
      description: parsed.data.description,
      date: parsed.data.date,
      fileId,
      approvalStatus,
      actorRole: c.get('profileRole'),
      actorId: c.get('userId'),
      providers,
    })

    return successResponse(c, created, 'Leave request created successfully.', 201)
  }

  router.post('/leave-requests', handleCreateAdminLeaveRequest)
  router.post('/permits', handleCreateAdminLeaveRequest)

  // GET /v1/admin/leave-requests/:id & /v1/admin/permits/:id
  const handleGetLeaveRequest = async (c: any) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const id = c.req.param('id')
    const leaveRequest = await getAdminLeaveRequest({
      id,
      actorRole: c.get('profileRole'),
      actorId: c.get('userId'),
      providers,
    })
    return successResponse(c, leaveRequest, 'Leave request retrieved successfully.')
  }

  router.get('/leave-requests/:id', handleGetLeaveRequest)
  router.get('/permits/:id', handleGetLeaveRequest)

  // PATCH /v1/admin/leave-requests/:id & /v1/admin/permits/:id
  const handlePatchLeaveRequest = async (c: any) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))
    const status = body.approval_status ?? body.approvalStatus
    if (status === 'approved') {
      const approved = await approveLeaveRequest({
        id,
        actorRole: c.get('profileRole'),
        actorId: c.get('userId'),
        providers,
      })
      return successResponse(c, approved, 'Leave request approved successfully.')
    } else if (status === 'rejected') {
      const rejected = await rejectLeaveRequest({
        id,
        reason: body.reason ?? body.rejection_reason ?? body.rejectionReason,
        actorRole: c.get('profileRole'),
        actorId: c.get('userId'),
        providers,
      })
      return successResponse(c, rejected, 'Leave request rejected successfully.')
    } else {
      throw AppError.validationError('Invalid or missing approval_status in PATCH body.')
    }
  }

  router.patch('/leave-requests/:id', handlePatchLeaveRequest)
  router.patch('/permits/:id', handlePatchLeaveRequest)

  // POST|PATCH /v1/admin/leave-requests/:id/approve & /v1/admin/permits/:id/approve
  const handleApproveLeaveRequest = async (c: any) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const id = c.req.param('id')
    const approved = await approveLeaveRequest({
      id,
      actorRole: c.get('profileRole'),
      actorId: c.get('userId'),
      providers,
    })
    return successResponse(c, approved, 'Leave request approved successfully.')
  }

  router.post('/leave-requests/:id/approve', handleApproveLeaveRequest)
  router.patch('/leave-requests/:id/approve', handleApproveLeaveRequest)
  router.post('/permits/:id/approve', handleApproveLeaveRequest)
  router.patch('/permits/:id/approve', handleApproveLeaveRequest)

  // POST|PATCH /v1/admin/leave-requests/:id/reject & /v1/admin/permits/:id/reject
  const handleRejectLeaveRequest = async (c: any) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const id = c.req.param('id')
    const contentType = c.req.header('content-type') || ''
    let reason: string | undefined

    if (contentType.includes('application/json')) {
      const body = await c.req.json().catch(() => ({}))
      const parsed = rejectLeaveRequestSchema.safeParse(body)
      if (!parsed.success) {
        throw AppError.validationError(parsed.error.flatten())
      }
      reason = parsed.data.reason ?? parsed.data.rejection_reason
    }

    const rejected = await rejectLeaveRequest({
      id,
      reason,
      actorRole: c.get('profileRole'),
      actorId: c.get('userId'),
      providers,
    })
    return successResponse(c, rejected, 'Leave request rejected successfully.')
  }

  router.post('/leave-requests/:id/reject', handleRejectLeaveRequest)
  router.patch('/leave-requests/:id/reject', handleRejectLeaveRequest)
  router.post('/permits/:id/reject', handleRejectLeaveRequest)
  router.patch('/permits/:id/reject', handleRejectLeaveRequest)

  // DELETE /v1/admin/leave-requests/:id & /v1/admin/permits/:id
  const handleDeleteLeaveRequest = async (c: any) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const id = c.req.param('id')
    await deleteAdminLeaveRequest({
      id,
      actorRole: c.get('profileRole'),
      actorId: c.get('userId'),
      providers,
    })
    return successResponse(c, { id }, 'Leave request deleted successfully.')
  }

  router.delete('/leave-requests/:id', handleDeleteLeaveRequest)
  router.delete('/permits/:id', handleDeleteLeaveRequest)

  // ---------------------------------------------------------------------------
  // Notification Outbox Admin Routes
  // ---------------------------------------------------------------------------

  // GET /v1/admin/notifications & /v1/admin/notifications/outbox
  const handleListNotifications = async (c: any) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const userId = c.req.query('userId') || c.req.query('user_id')
    const channelParam = c.req.query('channel')
    const statusParam = c.req.query('status')
    const limitParam = c.req.query('limit')
    const offsetParam = c.req.query('offset')

    const channelParsed = channelParam
      ? notificationChannelSchema.safeParse(channelParam)
      : undefined
    const statusParsed = statusParam ? notificationStatusSchema.safeParse(statusParam) : undefined

    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined
    const offset = offsetParam ? Number.parseInt(offsetParam, 10) : undefined

    const notifications = await listAdminNotifications({
      filter: {
        userId: userId || undefined,
        channel: channelParsed?.success ? channelParsed.data : undefined,
        status: statusParsed?.success ? statusParsed.data : undefined,
        limit,
        offset,
      },
      actorRole: c.get('profileRole'),
      actorId: c.get('userId'),
      providers,
    })

    return successResponse(c, notifications, 'Notifications retrieved successfully.')
  }

  router.get('/notifications', handleListNotifications)
  router.get('/notifications/outbox', handleListNotifications)

  // GET /v1/admin/notifications/:id
  const handleGetNotification = async (c: any) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const id = c.req.param('id')
    const notification = await getAdminNotification({
      id,
      actorRole: c.get('profileRole'),
      actorId: c.get('userId'),
      providers,
    })
    return successResponse(c, notification, 'Notification retrieved successfully.')
  }

  router.get('/notifications/:id', handleGetNotification)

  // POST /v1/admin/notifications & /v1/admin/notifications/enqueue
  const handleEnqueueNotification = async (c: any) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const body = await c.req.json().catch(() => ({}))
    const parsed = enqueueAdminNotificationSchema.safeParse(body)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }

    const userId = parsed.data.user_id || parsed.data.userId || ''
    const nextRetryAt = parsed.data.next_retry_at || parsed.data.nextRetryAt

    const notification = await enqueueAdminNotification({
      userId,
      channel: parsed.data.channel,
      payload: parsed.data.payload,
      nextRetryAt: nextRetryAt ?? null,
      actorRole: c.get('profileRole'),
      actorId: c.get('userId'),
      providers,
    })

    return successResponse(c, notification, 'Notification enqueued successfully.')
  }

  router.post('/notifications', handleEnqueueNotification)
  router.post('/notifications/enqueue', handleEnqueueNotification)

  // POST|PATCH /v1/admin/notifications/:id/retry
  const handleRetryNotification = async (c: any) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))

    const retried = await retryAdminNotification({
      id,
      resetCount: body.reset_count !== false && body.resetCount !== false,
      actorRole: c.get('profileRole'),
      actorId: c.get('userId'),
      providers,
    })

    return successResponse(c, retried, 'Notification retry scheduled successfully.')
  }

  router.post('/notifications/:id/retry', handleRetryNotification)
  router.patch('/notifications/:id/retry', handleRetryNotification)

  // DELETE /v1/admin/notifications/:id
  const handleDeleteNotification = async (c: any) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const id = c.req.param('id')
    await deleteAdminNotification({
      id,
      actorRole: c.get('profileRole'),
      actorId: c.get('userId'),
      providers,
    })
    return successResponse(c, { id }, 'Notification deleted successfully.')
  }

  router.delete('/notifications/:id', handleDeleteNotification)

  return router
}

export const adminRouter = createAdminRouter()
