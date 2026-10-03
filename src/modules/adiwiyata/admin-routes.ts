import { Hono } from 'hono'
import { z } from 'zod'
import { AppError } from '../../lib/errors/app-error.js'
import { successResponse } from '../../lib/http/responses.js'
import { defaultProviders } from '../../providers/index.js'
import type { AppProviders } from '../../providers/types.js'
import type { AppEnv } from '../../types/context.js'
import {
  createAdiwiyataAdminSite,
  deactivateAdiwiyataAdminSite,
  grantAdiwiyataEligibility,
  listAdiwiyataAdminReports,
  listAdiwiyataAdminEligibility,
  revokeAdiwiyataEligibility,
  listAdiwiyataAdminSites,
  setAdiwiyataAdminReportVerification,
  updateAdiwiyataAdminSite,
} from './service.js'

const uuidSchema = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i)
const realDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    if (value.startsWith('0000-')) return false
    const parsed = new Date(`${value}T00:00:00.000Z`)
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  })
const reportsQuerySchema = z
  .object({
    date: realDateSchema.optional(),
    class_id: uuidSchema.optional(),
    site_id: uuidSchema.optional(),
  })
  .strict()

const eligibilityIdSchema = z.string().uuid()
const eligibilityUserIdSchema = z.string().trim().min(1).max(255)
const eligibilityGrantSchema = z.object({ user_id: eligibilityUserIdSchema }).strict()
const siteIdSchema = z.string().uuid()
const siteNameSchema = z.string().trim().min(1).max(120)
const siteCategorySchema = z.enum(['tanaman', 'lele'])
const siteClassIdSchema = z.string().uuid().nullable()
const siteSortOrderSchema = z.number().finite().int().min(0).max(2_147_483_647)

const createSiteSchema = z
  .object({
    name: siteNameSchema,
    category: siteCategorySchema,
    class_id: siteClassIdSchema.optional(),
    sort_order: siteSortOrderSchema.default(0),
  })
  .strict()

const updateSiteSchema = z
  .object({
    name: siteNameSchema.optional(),
    category: siteCategorySchema.optional(),
    class_id: siteClassIdSchema.optional(),
    sort_order: siteSortOrderSchema.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one Site field must be supplied.',
  })

export interface AdiwiyataAdminRouterDeps {
  providers?: AppProviders
  now?: () => Date
}

export function createAdiwiyataAdminRouter(deps: AdiwiyataAdminRouterDeps = {}) {
  const router = new Hono<AppEnv>()

  router.get('/reports', async (c) => {
    const parsed = reportsQuerySchema.safeParse(c.req.query())
    if (!parsed.success) throw AppError.validationError(parsed.error.flatten())
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const result = await listAdiwiyataAdminReports({
      actorRole: c.get('profileRole'),
      userScopes: c.get('identityUser').scopes,
      date: parsed.data.date,
      classId: parsed.data.class_id,
      siteId: parsed.data.site_id,
      providers,
      now: deps.now?.(),
    })
    return successResponse(c, result, 'Laporan Adiwiyata berhasil dimuat.')
  })

  router.post('/reports/:id/verify', async (c) => {
    const id = uuidSchema.safeParse(c.req.param('id'))
    if (!id.success)
      throw AppError.validationError({ fieldErrors: { id: ['ID laporan tidak valid.'] } })
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const result = await setAdiwiyataAdminReportVerification({
      reportId: id.data,
      verified: true,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
      now: deps.now,
    })
    return successResponse(c, result, 'Foto Adiwiyata berhasil diverifikasi.')
  })

  router.post('/reports/:id/unverify', async (c) => {
    const id = uuidSchema.safeParse(c.req.param('id'))
    if (!id.success)
      throw AppError.validationError({ fieldErrors: { id: ['ID laporan tidak valid.'] } })
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const result = await setAdiwiyataAdminReportVerification({
      reportId: id.data,
      verified: false,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
      now: deps.now,
    })
    return successResponse(c, result, 'Verifikasi foto Adiwiyata dibatalkan.')
  })

  router.get('/eligibility', async (c) => {
    const query = z
      .string()
      .trim()
      .max(200)
      .safeParse(c.req.query('q') ?? '')
    if (!query.success)
      throw AppError.validationError('Search query must be 200 characters or less.')
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const result = await listAdiwiyataAdminEligibility({
      actorRole: c.get('profileRole'),
      query: query.data,
      providers,
    })
    return successResponse(c, result, 'Adiwiyata eligibility berhasil dimuat.')
  })

  router.post('/eligibility', async (c) => {
    const parsed = eligibilityGrantSchema.safeParse(await c.req.json())
    if (!parsed.success) throw AppError.validationError(parsed.error.flatten())
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const eligibility = await grantAdiwiyataEligibility({
      userId: parsed.data.user_id,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, eligibility, 'Akses Adiwiyata siswa berhasil diaktifkan.', 201)
  })

  router.delete('/eligibility/:id', async (c) => {
    const id = eligibilityIdSchema.safeParse(c.req.param('id'))
    if (!id.success)
      throw AppError.validationError({ fieldErrors: { id: ['ID akses siswa tidak valid.'] } })
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const eligibility = await revokeAdiwiyataEligibility({
      id: id.data,
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, eligibility, 'Akses Adiwiyata siswa dinonaktifkan.')
  })

  router.get('/sites', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const result = await listAdiwiyataAdminSites({
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, result, 'Adiwiyata Sites berhasil dimuat.')
  })

  router.post('/sites', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const parsed = createSiteSchema.safeParse(await c.req.json())
    if (!parsed.success) throw AppError.validationError(parsed.error.flatten())
    const site = await createAdiwiyataAdminSite({
      name: parsed.data.name,
      category: parsed.data.category,
      classId: parsed.data.class_id,
      sortOrder: parsed.data.sort_order,
      actorId: c.get('userId'),
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, site, 'Adiwiyata Site berhasil dibuat.', 201)
  })

  router.patch('/sites/:id', async (c) => {
    const id = siteIdSchema.safeParse(c.req.param('id'))
    if (!id.success)
      throw AppError.validationError({ fieldErrors: { id: ['ID Site tidak valid.'] } })
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const parsed = updateSiteSchema.safeParse(await c.req.json())
    if (!parsed.success) throw AppError.validationError(parsed.error.flatten())
    const site = await updateAdiwiyataAdminSite({
      id: id.data,
      name: parsed.data.name,
      category: parsed.data.category,
      classId: parsed.data.class_id,
      sortOrder: parsed.data.sort_order,
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, site, 'Adiwiyata Site berhasil diperbarui.')
  })

  router.delete('/sites/:id', async (c) => {
    const id = siteIdSchema.safeParse(c.req.param('id'))
    if (!id.success)
      throw AppError.validationError({ fieldErrors: { id: ['ID Site tidak valid.'] } })
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const site = await deactivateAdiwiyataAdminSite({
      id: id.data,
      actorRole: c.get('profileRole'),
      providers,
    })
    return successResponse(c, site, 'Adiwiyata Site dinonaktifkan.')
  })

  return router
}
