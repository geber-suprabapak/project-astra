import type { Hono } from 'hono'
import { successResponse } from '../../../lib/http/responses.js'
import type { AppEnv } from '../../../types/context.js'
import { bootstrapSchoolSchema, createSchoolAdminSchema, stageRosterSchema } from '../schema.js'
import {
  acceptRosterReport,
  bootstrapSchool,
  createSchoolAdmin,
  getBootstrapStatus,
  getPrivilegedSession,
  getRosterReport,
  openStudentSignup,
  validateAndStageRoster,
} from '../service.js'
import { type AdminRouterDeps, parseJsonBody, resolveAdminProviders } from './shared.js'

export function registerBootstrapRosterRoutes(router: Hono<AppEnv>, deps: AdminRouterDeps): void {
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
    const providers = resolveAdminProviders(c, deps)
    const status = await getBootstrapStatus(providers)
    return successResponse(c, status, 'Bootstrap status retrieved.')
  })

  // POST /v1/admin/bootstrap/school
  router.post('/bootstrap/school', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const data = await parseJsonBody(c, bootstrapSchoolSchema)

    const school = await bootstrapSchool({
      name: data.name,
      slug: data.slug,
      timezone: data.timezone,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, school, 'School bootstrapped successfully.', 201)
  })

  // POST /v1/admin/bootstrap/school-admin
  router.post('/bootstrap/school-admin', async (c) => {
    const providers = resolveAdminProviders(c, deps)
    const data = await parseJsonBody(c, createSchoolAdminSchema)

    const targetUserId = (data.user_id ?? data.userId)!
    const fullName = data.full_name ?? data.fullName ?? null
    const email = data.email ?? null

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
    const providers = resolveAdminProviders(c, deps)
    const data = await parseJsonBody(c, stageRosterSchema)

    const report = await validateAndStageRoster({
      rows: data.rows,
      academicPeriodId: data.academic_period_id,
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
    const providers = resolveAdminProviders(c, deps)
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
    const providers = resolveAdminProviders(c, deps)
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
    const providers = resolveAdminProviders(c, deps)
    const result = await openStudentSignup({
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })

    return successResponse(c, result, 'Student signup is now open.')
  })
}
