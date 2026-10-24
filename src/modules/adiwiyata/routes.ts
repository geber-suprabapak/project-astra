import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { AppError } from '../../lib/errors/app-error.js'
import { ErrorCode } from '../../lib/errors/codes.js'
import { errorResponse, successResponse } from '../../lib/http/responses.js'
import { createAuthMiddleware } from '../../middleware/auth.js'
import { rateLimits } from '../../middleware/rate-limit.js'
import { defaultProviders } from '../../providers/index.js'
import type { AppProviders } from '../../providers/types.js'
import type { AppEnv } from '../../types/context.js'
import { getAdiwiyataDashboard, submitAdiwiyataStudentReport } from './service.js'
import { MAX_ADIWIYATA_INPUT_BYTES } from './image.js'

export interface AdiwiyataRouterDeps {
  providers?: AppProviders
  now?: () => Date
}

const profileRejected = () =>
  new AppError(
    ErrorCode.ADIWIYATA_NOT_ELIGIBLE,
    403,
    'Profil Astra belum disetujui untuk akses siswa. Hubungi admin sekolah untuk bantuan aktivasi.',
  )

const siteIdSchema = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i)
const multipartBodyLimit = bodyLimit({
  maxSize: MAX_ADIWIYATA_INPUT_BYTES + 64 * 1024,
  onError: (c) =>
    errorResponse(c, AppError.validationError('Multipart request exceeds the 5 MB photo limit.')),
})

export function createAdiwiyataRouter(deps: AdiwiyataRouterDeps = {}) {
  const router = new Hono<AppEnv>()

  router.use('*', createAuthMiddleware({ profileRejected }))

  router.get('/dashboard', async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    const dashboard = await getAdiwiyataDashboard(
      c.get('userId'),
      providers,
      deps.now?.() ?? new Date(),
    )
    return successResponse(c, dashboard, 'Dashboard Adiwiyata berhasil dimuat.')
  })

  router.post('/reports', rateLimits.standard, multipartBodyLimit, async (c) => {
    const providers = deps.providers ?? c.get('providers') ?? defaultProviders
    let form: FormData
    try {
      form = await c.req.formData()
    } catch {
      throw AppError.validationError('Gunakan multipart/form-data dengan site_id dan image.')
    }
    const keys = Array.from(form.keys())
    const siteFields = form.getAll('site_id')
    const imageFields = form.getAll('image')
    const siteValue = siteFields[0]
    const imageValue = imageFields[0]
    if (
      keys.length !== 2 ||
      keys.some((key) => key !== 'site_id' && key !== 'image') ||
      siteFields.length !== 1 ||
      imageFields.length !== 1 ||
      !(imageValue instanceof File)
    ) {
      throw AppError.validationError(
        'Kirim tepat satu field site_id dan satu field image tanpa caption tambahan.',
      )
    }
    const siteId = siteIdSchema.safeParse(siteValue)
    const image = imageValue
    if (!siteId.success) throw AppError.validationError('site_id harus berupa UUID.')
    if (
      image.size === 0 ||
      image.size > MAX_ADIWIYATA_INPUT_BYTES ||
      (image.type !== 'image/jpeg' && image.type !== 'image/png')
    ) {
      throw AppError.validationError('image harus berupa JPEG atau PNG berukuran maksimal 5 MB.')
    }

    const report = await submitAdiwiyataStudentReport({
      userId: c.get('userId'),
      siteId: siteId.data,
      inputImage: Buffer.from(await image.arrayBuffer()),
      declaredType: image.type,
      providers,
      now: deps.now,
    })
    return successResponse(c, { report }, 'Laporan Adiwiyata berhasil dikirim.', 201)
  })

  return router
}

export const adiwiyataRouter = createAdiwiyataRouter()
