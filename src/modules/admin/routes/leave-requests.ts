import type { Context, Hono } from 'hono'
import { successResponse } from '../../../lib/http/responses.js'
import { AppError } from '../../../lib/errors/app-error.js'
import {
  leaveRequestApprovalStatusSchema,
  leaveRequestCategorySchema,
} from '../../../providers/types.js'
import type { AppEnv } from '../../../types/context.js'
import {
  approveLeaveRequestSchema,
  createAdminLeaveRequestSchema,
  forceFinishLeaveRequestSchema,
  rejectLeaveRequestSchema,
} from '../schema.js'
import {
  approveLeaveRequest,
  createAdminLeaveRequest,
  deleteAdminLeaveRequest,
  forceFinishLeaveRequest,
  getAdminLeaveRequest,
  getAdminLeaveRequestHistory,
  listAdminLeaveRequests,
  rejectLeaveRequest,
  reopenLeaveRequest,
} from '../service.js'
import {
  type AdminRouterDeps,
  parseJsonBody,
  parseJsonBodyOrEmpty,
  requireRouteParam,
  resolveAdminProviders,
} from './shared.js'

export function registerLeaveRequestRoutes(router: Hono<AppEnv>, deps: AdminRouterDeps): void {
  // GET /v1/admin/leave-requests & /v1/admin/permits
  const handleListLeaveRequests = async (c: Context<AppEnv>) => {
    const providers = resolveAdminProviders(c, deps)
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
  const handleCreateAdminLeaveRequest = async (c: Context<AppEnv>) => {
    const providers = resolveAdminProviders(c, deps)
    const data = await parseJsonBody(c, createAdminLeaveRequestSchema)

    const userId = data.user_id ?? data.userId
    const fileId = data.file_id ?? data.fileId
    const approvalStatus = data.approval_status ?? data.approvalStatus ?? 'pending'

    const created = await createAdminLeaveRequest({
      userId: userId!,
      category: data.category,
      description: data.description,
      date: data.date,
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
  const handleGetLeaveRequest = async (c: Context<AppEnv>) => {
    const providers = resolveAdminProviders(c, deps)
    const id = requireRouteParam(c, 'id')
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

  // GET /v1/admin/leave-requests/:id/history
  router.get('/leave-requests/:id/history', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const history = await getAdminLeaveRequestHistory({
      id: c.req.param('id'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, history, 'Leave decision history retrieved successfully.')
  })

  // PATCH /v1/admin/leave-requests/:id & /v1/admin/permits/:id
  const handlePatchLeaveRequest = async (c: Context<AppEnv>) => {
    const providers = resolveAdminProviders(c, deps)
    const id = requireRouteParam(c, 'id')
    const body = await c.req.json().catch(() => ({}))
    const status = body.approval_status ?? body.approvalStatus
    if (status === 'approved') {
      const parsed = approveLeaveRequestSchema.safeParse(body)
      if (!parsed.success) {
        throw AppError.validationError(parsed.error.flatten())
      }
      const approved = await approveLeaveRequest({
        id,
        durationDays: parsed.data.duration_days ?? parsed.data.durationDays,
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
    } else if (status === 'pending') {
      const reopened = await reopenLeaveRequest({
        id,
        actorRole: c.get('profileRole'),
        actorId: c.get('userId'),
        providers,
      })
      return successResponse(c, reopened, 'Leave request reopened successfully.')
    } else {
      throw AppError.validationError('Invalid or missing approval_status in PATCH body.')
    }
  }

  router.patch('/leave-requests/:id', handlePatchLeaveRequest)
  router.patch('/permits/:id', handlePatchLeaveRequest)

  // POST|PATCH /v1/admin/leave-requests/:id/approve & /v1/admin/permits/:id/approve
  const handleApproveLeaveRequest = async (c: Context<AppEnv>) => {
    const providers = resolveAdminProviders(c, deps)
    const id = requireRouteParam(c, 'id')
    const contentType = c.req.header('content-type') || ''
    let durationDays: number | undefined
    if (contentType.includes('application/json')) {
      const data = await parseJsonBodyOrEmpty(c, approveLeaveRequestSchema)
      durationDays = data.duration_days ?? data.durationDays
    }
    const approved = await approveLeaveRequest({
      id,
      durationDays,
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

  // POST /v1/admin/leave-requests/:id/force-finish
  const handleForceFinishLeaveRequest = async (c: Context<AppEnv>) => {
    const providers = resolveAdminProviders(c, deps)
    const data = await parseJsonBodyOrEmpty(c, forceFinishLeaveRequestSchema)
    const effectiveEndDate =
      data.effective_end_date ??
      data.effectiveEndDate ??
      data.last_excused_date ??
      data.lastExcusedDate
    const finished = await forceFinishLeaveRequest({
      id: requireRouteParam(c, 'id'),
      effectiveEndDate: effectiveEndDate!,
      reason: data.reason,
      actorRole: c.get('profileRole'),
      actorId: c.get('userId'),
      providers,
    })
    return successResponse(c, finished, 'Leave request force-finished successfully.')
  }

  router.post('/leave-requests/:id/force-finish', handleForceFinishLeaveRequest)
  router.post('/permits/:id/force-finish', handleForceFinishLeaveRequest)

  // POST|PATCH /v1/admin/leave-requests/:id/reject & /v1/admin/permits/:id/reject
  const handleRejectLeaveRequest = async (c: Context<AppEnv>) => {
    const providers = resolveAdminProviders(c, deps)
    const id = requireRouteParam(c, 'id')
    const contentType = c.req.header('content-type') || ''
    let reason: string | undefined

    if (contentType.includes('application/json')) {
      const data = await parseJsonBodyOrEmpty(c, rejectLeaveRequestSchema)
      reason = data.reason ?? data.rejection_reason
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

  // POST|PATCH /v1/admin/leave-requests/:id/reopen & /v1/admin/permits/:id/reopen
  const handleReopenLeaveRequest = async (c: Context<AppEnv>) => {
    const providers = resolveAdminProviders(c, deps)
    const id = requireRouteParam(c, 'id')
    const reopened = await reopenLeaveRequest({
      id,
      actorRole: c.get('profileRole'),
      actorId: c.get('userId'),
      providers,
    })
    return successResponse(c, reopened, 'Leave request reopened successfully.')
  }

  router.post('/leave-requests/:id/reopen', handleReopenLeaveRequest)
  router.patch('/leave-requests/:id/reopen', handleReopenLeaveRequest)
  router.post('/permits/:id/reopen', handleReopenLeaveRequest)
  router.patch('/permits/:id/reopen', handleReopenLeaveRequest)

  // DELETE /v1/admin/leave-requests/:id & /v1/admin/permits/:id
  const handleDeleteLeaveRequest = async (c: Context<AppEnv>) => {
    const providers = resolveAdminProviders(c, deps)
    const id = requireRouteParam(c, 'id')
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
}
