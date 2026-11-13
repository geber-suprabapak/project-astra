import type { Hono } from 'hono'
import { successResponse } from '../../../lib/http/responses.js'
import type { AppEnv } from '../../../types/context.js'
import {
  classEnrollmentStatusSchema,
  createAcademicPeriodSchema,
  createClassSchema,
  enrollStudentSchema,
  exitStudentEnrollmentSchema,
  promoteStudentEnrollmentSchema,
  transferStudentEnrollmentSchema,
  updateAcademicPeriodSchema,
  updateClassSchema,
} from '../schema.js'
import {
  createAcademicPeriod,
  createClass,
  enrollStudent,
  exitStudentEnrollment,
  listAcademicPeriods,
  listClassEnrollments,
  listClasses,
  promoteStudentEnrollment,
  setActiveAcademicPeriod,
  transferStudentEnrollment,
  updateAcademicPeriod,
  updateClass,
} from '../service.js'
import { type AdminRouterDeps, parseJsonBody, resolveAdminProviders } from './shared.js'

export function registerAcademicEnrollmentRoutes(
  router: Hono<AppEnv>,
  deps: AdminRouterDeps,
): void {
  // GET /v1/admin/academic-periods
  router.get('/academic-periods', async (c) => {
    const providers = resolveAdminProviders(c, deps)
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
    const providers = resolveAdminProviders(c, deps)
    const data = await parseJsonBody(c, createAcademicPeriodSchema)
    const period = await createAcademicPeriod({
      name: data.name,
      startDate: (data.start_date ?? data.startDate)!,
      endDate: (data.end_date ?? data.endDate)!,
      isActive: data.is_active ?? data.isActive,
      schoolId: data.school_id ?? data.schoolId,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, period, 'Academic period created successfully.', 201)
  })

  // PUT /v1/admin/academic-periods/:id
  router.put('/academic-periods/:id', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const id = c.req.param('id')
    const data = await parseJsonBody(c, updateAcademicPeriodSchema)
    const period = await updateAcademicPeriod({
      id,
      name: data.name,
      startDate: data.start_date ?? data.startDate,
      endDate: data.end_date ?? data.endDate,
      isActive: data.is_active ?? data.isActive,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, period, 'Academic period updated successfully.')
  })

  // POST /v1/admin/academic-periods/:id/set-active
  router.post('/academic-periods/:id/set-active', async (c) => {
    const providers = resolveAdminProviders(c, deps)
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
    const providers = resolveAdminProviders(c, deps)
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
    const providers = resolveAdminProviders(c, deps)
    const data = await parseJsonBody(c, createClassSchema)
    const cls = await createClass({
      name: data.name,
      grade: data.grade,
      academicPeriodId: data.academic_period_id ?? data.academicPeriodId,
      schoolId: data.school_id ?? data.schoolId,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, cls, 'Class created successfully.', 201)
  })

  // PUT /v1/admin/classes/:id
  router.put('/classes/:id', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const id = c.req.param('id')
    const data = await parseJsonBody(c, updateClassSchema)
    const cls = await updateClass({
      id,
      name: data.name,
      grade: data.grade,
      academicPeriodId: data.academic_period_id ?? data.academicPeriodId,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, cls, 'Class updated successfully.')
  })

  // GET /v1/admin/enrollments
  router.get('/enrollments', async (c) => {
    const providers = resolveAdminProviders(c, deps)
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
    const providers = resolveAdminProviders(c, deps)
    const data = await parseJsonBody(c, enrollStudentSchema)
    const enrollment = await enrollStudent({
      userId: (data.user_id ?? data.userId)!,
      classId: (data.class_id ?? data.classId)!,
      academicPeriodId: (data.academic_period_id ?? data.academicPeriodId)!,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, enrollment, 'Student enrolled successfully.', 201)
  })

  // POST /v1/admin/enrollments/transfer
  router.post('/enrollments/transfer', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const data = await parseJsonBody(c, transferStudentEnrollmentSchema)
    const result = await transferStudentEnrollment({
      userId: (data.user_id ?? data.userId)!,
      toClassId: (data.to_class_id ?? data.toClassId)!,
      academicPeriodId: (data.academic_period_id ?? data.academicPeriodId)!,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, result, 'Student enrollment transferred successfully.')
  })

  // POST /v1/admin/enrollments/promote
  router.post('/enrollments/promote', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const data = await parseJsonBody(c, promoteStudentEnrollmentSchema)
    const result = await promoteStudentEnrollment({
      userId: (data.user_id ?? data.userId)!,
      fromAcademicPeriodId: (data.from_academic_period_id ?? data.fromAcademicPeriodId)!,
      toAcademicPeriodId: (data.to_academic_period_id ?? data.toAcademicPeriodId)!,
      toClassId: (data.to_class_id ?? data.toClassId)!,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, result, 'Student enrollment promoted successfully.')
  })

  // POST /v1/admin/enrollments/exit
  router.post('/enrollments/exit', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const data = await parseJsonBody(c, exitStudentEnrollmentSchema)
    const result = await exitStudentEnrollment({
      userId: (data.user_id ?? data.userId)!,
      academicPeriodId: (data.academic_period_id ?? data.academicPeriodId)!,
      status: data.status,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, result, 'Student enrollment exited successfully.')
  })
}
