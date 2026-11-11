import { certificateCodeSchema } from './certificates.js'
import { pklAssessmentSchema } from './assessment-command.js'
import { pklCheckInSchema, pklCheckOutSchema } from './attendance.js'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { AppError } from '../../lib/errors/app-error.js'
import { successResponse } from '../../lib/http/responses.js'
import { defaultProviders } from '../../providers/index.js'
import type { AppProviders } from '../../providers/types.js'
import type { AppEnv } from '../../types/context.js'
import { getCmsSession } from '../cms/service.js'
import { getPklResource, pklInputSchema, projectPklRecord, validatePklQuery } from './resources.js'
import { registrationStatusSchema } from './schema.js'

export function createPklRouter(deps: { providers?: AppProviders } = {}) {
  const router = new Hono<AppEnv>()
  router.get('/certificates/verify/:code', async (c) => {
    c.header('Cache-Control', 'no-store')
    const parsed = certificateCodeSchema.safeParse(c.req.param('code'))
    if (!parsed.success) throw AppError.notFound('PKL certificate')
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const certificate = await providers.domainStore.verifyPklCertificate(parsed.data)
    if (!certificate) throw AppError.notFound('PKL certificate')
    return successResponse(c, certificate, 'PKL certificate verified.')
  })
  async function sessionFor(c: Context<AppEnv>) {
    c.header('Cache-Control', 'no-store')
    const authorization = c.req.header('Authorization')
    if (!authorization?.startsWith('Bearer ') || !authorization.slice(7).trim())
      throw AppError.authRequired()
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    return { providers, access: await getCmsSession(providers, authorization.slice(7)) }
  }
  const parseId = (id: string) => {
    const parsed = z.uuid().safeParse(id)
    if (!parsed.success) throw AppError.validationError('Invalid PKL ID.')
    return parsed.data
  }
  router.post('/industries/:id/supervisor', async (c) => {
    const { providers, access } = await sessionFor(c)
    const parsed = z
      .object({ supervisor_id: z.uuid() })
      .strict()
      .safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw AppError.validationError(parsed.error.flatten())
    const result = await providers.domainStore.assignPklIndustrySupervisor({
      id: parseId(c.req.param('id')),
      supervisor_id: parsed.data.supervisor_id,
      access,
    })
    return successResponse(c, projectPklRecord('industries', result), 'PKL supervisor assigned.')
  })
  router.post('/internships/:id/assessment', async (c) => {
    const { providers, access } = await sessionFor(c)
    const parsed = pklAssessmentSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw AppError.validationError(parsed.error.flatten())
    return successResponse(
      c,
      await providers.domainStore.savePklAssessment({
        ...parsed.data,
        id: parseId(c.req.param('id')),
        access,
      }),
      'PKL assessment saved.',
    )
  })
  router.post('/attendance/check-in', async (c) => {
    const { providers, access } = await sessionFor(c)
    const parsed = pklCheckInSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw AppError.validationError(parsed.error.flatten())
    const row = await providers.domainStore.checkInPkl({ ...parsed.data, access })
    return successResponse(c, projectPklRecord('attendance', row), 'PKL attendance recorded.')
  })
  router.post('/attendance/:id/check-out', async (c) => {
    const { providers, access } = await sessionFor(c)
    const parsed = pklCheckOutSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw AppError.validationError(parsed.error.flatten())
    const row = await providers.domainStore.checkOutPkl({
      id: parseId(c.req.param('id')),
      ...parsed.data,
      access,
    })
    return successResponse(c, projectPklRecord('attendance', row), 'PKL attendance checked out.')
  })
  router.get('/:resource', async (c) => {
    const { providers, access } = await sessionFor(c)
    const resource = c.req.param('resource'),
      query = validatePklQuery(resource, c.req.query())
    const rows = await providers.domainStore.listPklRecords({ resource, query, access })
    return successResponse(c, rows.slice(0, query.limit), 'PKL records.', 200, {
      pagination: { limit: query.limit, offset: query.offset, has_more: rows.length > query.limit },
    })
  })
  router.get('/:resource/count', async (c) => {
    const { providers, access } = await sessionFor(c)
    const resource = c.req.param('resource'),
      query = validatePklQuery(resource, c.req.query())
    return successResponse(
      c,
      { total: await providers.domainStore.countPklRecords({ resource, query, access }) },
      'PKL record count.',
    )
  })
  router.post('/registrations/:id/transition', async (c) => {
    const { providers, access } = await sessionFor(c)
    const body = await c.req.json().catch(() => null)
    const parsed = z
      .object({
        expected_status: registrationStatusSchema,
        status: registrationStatusSchema,
        notes: z.string().max(5000).optional(),
        industry_id: z.uuid().optional(),
      })
      .strict()
      .safeParse(body)
    if (!parsed.success) throw AppError.validationError(parsed.error.flatten())
    const row = await providers.domainStore.transitionPklRegistration({
      id: parseId(c.req.param('id')),
      access,
      ...parsed.data,
    })
    return successResponse(c, projectPklRecord('registrations', row), 'PKL status updated.')
  })
  router.post('/:resource/import', async (c) => {
    const { providers, access } = await sessionFor(c)
    const resource = c.req.param('resource')
    getPklResource(resource)
    const parsed = z
      .object({ rows: z.array(pklInputSchema).min(1).max(500) })
      .strict()
      .safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw AppError.validationError(parsed.error.flatten())
    const rows = await providers.domainStore.importPklRecords({
      resource,
      rows: parsed.data.rows,
      access,
    })
    return successResponse(
      c,
      rows.map((row) => projectPklRecord(resource, row)),
      'PKL records imported.',
      201,
    )
  })
  router.get('/:resource/:id', async (c) => {
    const { providers, access } = await sessionFor(c)
    const resource = c.req.param('resource'),
      query = validatePklQuery(resource, { id: parseId(c.req.param('id')), limit: 1 })
    const rows = await providers.domainStore.listPklRecords({ resource, query, access })
    if (!rows[0]) throw AppError.notFound('PKL record')
    return successResponse(c, rows[0], 'PKL record.')
  })
  for (const [method, action] of [
    ['post', 'create'],
    ['patch', 'update'],
    ['delete', 'delete'],
  ] as const) {
    router[method](action === 'create' ? '/:resource' : '/:resource/:id', async (c) => {
      const { providers, access } = await sessionFor(c)
      const resource = c.req.param('resource')!
      getPklResource(resource)
      const parsed = pklInputSchema.safeParse(
        action === 'delete' ? {} : await c.req.json().catch(() => null),
      )
      if (!parsed.success) throw AppError.validationError(parsed.error.flatten())
      const row = await providers.domainStore.mutatePklRecord({
        resource,
        action,
        access,
        data: parsed.data,
        id: action === 'create' ? undefined : parseId(c.req.param('id')!),
      })
      return successResponse(
        c,
        projectPklRecord(resource, row),
        'PKL record saved.',
        action === 'create' ? 201 : 200,
      )
    })
  }
  return router
}
