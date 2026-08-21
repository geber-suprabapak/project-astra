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
  createSchoolAdminSchema,
  stageRosterSchema,
} from './schema.js'
import {
  acceptRosterReport,
  bootstrapSchool,
  createSchoolAdmin,
  getBootstrapStatus,
  getPrivilegedSession,
  getRosterReport,
  openStudentSignup,
  validateAndStageRoster,
} from './service.js'

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

  return router
}

export const adminRouter = createAdminRouter()
