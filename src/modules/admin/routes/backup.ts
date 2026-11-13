import type { Hono } from 'hono'
import { successResponse } from '../../../lib/http/responses.js'
import { AppError } from '../../../lib/errors/app-error.js'
import type { AppEnv } from '../../../types/context.js'
import { backupStatusQuerySchema, createBackupSchema } from '../schema.js'
import { getAdminBackupStatus, recordAdminBackup } from '../service.js'
import { type AdminRouterDeps, parseJsonBody, resolveAdminProviders } from './shared.js'

export function registerBackupRoutes(router: Hono<AppEnv>, deps: AdminRouterDeps): void {
  // POST /v1/admin/backups
  router.post('/backups', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const data = await parseJsonBody(c, createBackupSchema)

    const backup = await recordAdminBackup({
      input: data,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, backup, 'Backup recorded successfully.', 201)
  })

  // GET /v1/admin/backups/status
  router.get('/backups/status', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const query = {
      year_month: c.req.query('year_month'),
      scope: c.req.query('scope'),
    }
    const parsed = backupStatusQuerySchema.safeParse(query)
    if (!parsed.success) {
      throw AppError.validationError(parsed.error.flatten())
    }

    const status = await getAdminBackupStatus({
      query: parsed.data,
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, status, 'Backup status retrieved.')
  })
}
