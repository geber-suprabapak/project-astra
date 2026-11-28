import type { Hono } from 'hono'
import { AppError } from '../../../lib/errors/app-error.js'
import { successResponse } from '../../../lib/http/responses.js'
import type { AppEnv } from '../../../types/context.js'
import { adminAuditLogsQuerySchema } from '../schema.js'
import { listAdminAuditLogs } from '../service.js'
import {
  type AdminRouterDeps,
  isValidIsoDate,
  parseOptionalLimit,
  parseOptionalOffset,
  resolveAdminProviders,
} from './shared.js'

export function registerAuditLogRoutes(router: Hono<AppEnv>, deps: AdminRouterDeps): void {
  // GET /v1/admin/audit-logs
  router.get('/audit-logs', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const limit = parseOptionalLimit(c.req.query('limit'), 100) ?? 50
    const offset = parseOptionalOffset(c.req.query('offset')) ?? 0

    const rawQuery = {
      entity_type: c.req.query('entity_type') ?? c.req.query('entityType') ?? undefined,
      action: c.req.query('action') ?? undefined,
      actor_id: c.req.query('actor_id') ?? c.req.query('actorId') ?? undefined,
      start_date: c.req.query('start_date') ?? c.req.query('startDate') ?? undefined,
      end_date: c.req.query('end_date') ?? c.req.query('endDate') ?? undefined,
    }
    const parsed = adminAuditLogsQuerySchema.safeParse(rawQuery)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }
    const { entity_type, action, actor_id, start_date, end_date } = parsed.data
    if (start_date && !isValidIsoDate(start_date)) {
      throw AppError.validationError('start_date is not a valid calendar date.')
    }
    if (end_date && !isValidIsoDate(end_date)) {
      throw AppError.validationError('end_date is not a valid calendar date.')
    }
    if (start_date && end_date && start_date > end_date) {
      throw AppError.validationError('start_date must be less than or equal to end_date.')
    }

    const result = await listAdminAuditLogs({
      limit,
      offset,
      entityType: entity_type,
      action,
      actorId: actor_id,
      startDate: start_date,
      endDate: end_date,
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, result.items, 'Audit logs retrieved successfully.', 200, {
      pagination: {
        limit,
        offset,
        has_more: result.hasMore,
      },
    })
  })
}
