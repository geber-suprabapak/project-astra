import type { Hono } from 'hono'
import { successResponse } from '../../../lib/http/responses.js'
import { AppError } from '../../../lib/errors/app-error.js'
import { profileLifecycleStatusSchema } from '../../../providers/types.js'
import type { AppEnv } from '../../../types/context.js'
import { rejectStudentSchema, updateStudentEmailSchema } from '../schema.js'
import {
  approveStudent,
  correctStudentEmail,
  disableStudent,
  generateStudentResetCode,
  getStudent,
  listStudents,
  rejectStudent,
  resetStudentFaceEnrollment,
} from '../service.js'
import { type AdminRouterDeps, parseJsonBody, resolveAdminProviders } from './shared.js'

export function registerStudentRoutes(router: Hono<AppEnv>, deps: AdminRouterDeps): void {
  // GET /v1/admin/students
  router.get('/students', async (c) => {
    const providers = resolveAdminProviders(c, deps)
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
    const providers = resolveAdminProviders(c, deps)
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
    const providers = resolveAdminProviders(c, deps)
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
    const providers = resolveAdminProviders(c, deps)
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
    const providers = resolveAdminProviders(c, deps)
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
    const providers = resolveAdminProviders(c, deps)
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
    const providers = resolveAdminProviders(c, deps)
    const userId = c.req.param('userId')
    const data = await parseJsonBody(c, updateStudentEmailSchema)

    const student = await correctStudentEmail({
      userId,
      email: data.email,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, student, 'Student email corrected successfully.')
  })

  // DELETE /v1/admin/students/:userId/face-enrollment
  router.delete('/students/:userId/face-enrollment', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const userId = c.req.param('userId')
    await resetStudentFaceEnrollment({
      userId,
      requestId: c.get('requestId'),
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, null, 'Student face enrollment reset successfully.')
  })
}
