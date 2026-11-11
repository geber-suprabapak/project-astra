import { z } from 'zod'
import { AppError } from '../../lib/errors/app-error.js'
import * as S from './content-schema.js'
import type { CmsSession } from './schema.js'

export const cmsContentInputSchema = z.record(z.string(), z.json())
export type CmsContentInput = z.infer<typeof cmsContentInputSchema>
export type CmsContentRow = CmsContentInput & { id: string }

interface ResourceDefinition {
  schema: z.ZodObject
  roles: string[]
  readRoles?: string[]
  scope: 'id' | 'jurusan' | null
  singleton: boolean
}

const definitions: [string, ResourceDefinition][] = [
  [
    'documents',
    {
      schema: S.documentSchema,
      roles: ['super_admin', 'admin', 'waka_akademik', 'waka_kurikulum', 'wks_1'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'modul_ajar',
    {
      schema: S.modulAjarSchema,
      roles: ['super_admin', 'admin', 'waka_akademik', 'waka_kurikulum', 'wks_1'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'pkl_alur_steps',
    {
      schema: S.pklAlurStepSchema,
      roles: [
        'super_admin',
        'admin',
        'admin_hubin',
        'waka_hubin',
        'waka_hubin_humas',
        'wks_4',
        'wks_1',
        'waka_akademik',
      ],
      scope: null,
      singleton: false,
    },
  ],

  [
    'school_info',
    {
      schema: S.schoolInfoSchema.extend({
        nss: z.string().optional(),
        principal_greeting: z.string().optional(),
        maps_link: z.string().optional(),
      }),
      roles: ['super_admin', 'admin', 'waka_sarpras', 'wks_3'],
      scope: null,
      singleton: true,
    },
  ],
  [
    'hero_slides',
    {
      schema: S.heroSlideSchema.extend({ page: z.string().optional() }),
      roles: ['super_admin', 'admin', 'jurnalistik'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'school_stats',
    {
      schema: S.schoolStatSchema.extend({ order: z.number().int().optional() }),
      roles: ['super_admin', 'admin'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'guru_staff',
    {
      schema: S.guruStaffSchema.extend({ page: z.string().optional() }),
      readRoles: ['admin_hubin', 'wks_4', 'waka_hubin', 'waka_humas', 'waka_hubin_humas'],
      roles: ['super_admin', 'admin', 'waka_sarpras', 'wks_3'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'jurusan',
    {
      schema: S.jurusanSchema,
      roles: ['super_admin', 'admin', 'admin_jurusan'],
      scope: 'id',
      singleton: false,
    },
  ],
  [
    'berita',
    {
      schema: S.beritaSchema.extend({ page: z.string().optional() }),
      roles: ['super_admin', 'admin', 'jurnalistik'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'galeri',
    {
      schema: S.galeriSchema.extend({ page: z.string().optional() }),
      roles: ['super_admin', 'admin', 'jurnalistik'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'sarpras',
    {
      schema: S.sarprasSchema.extend({ page: z.string().optional() }),
      roles: ['super_admin', 'admin', 'waka_sarpras', 'wks_3'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'prestasi',
    {
      schema: S.prestasiSchema.extend({ page: z.string().optional() }),
      roles: ['super_admin', 'admin', 'jurnalistik', 'waka_kesiswaan', 'wks_2'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'agenda',
    {
      schema: S.agendaSchema.extend({ page: z.string().optional() }),
      roles: ['super_admin', 'admin', 'jurnalistik'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'keunggulan',
    {
      schema: S.keunggulanSchema.extend({ page: z.string().optional() }),
      roles: ['super_admin', 'admin'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'layanan',
    {
      schema: S.layananSchema,
      roles: ['super_admin', 'admin', 'jurnalistik'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'sejarah',
    { schema: S.sejarahSchema, roles: ['super_admin', 'admin'], scope: null, singleton: false },
  ],
  [
    'struktur_organisasi',
    {
      schema: S.strukturOrganisasiSchema.extend({
        guru_staff_id: z.uuid().nullable().optional(),
        sort_order: z.number().int().optional(),
      }),
      roles: ['super_admin', 'admin'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'akreditasi',
    { schema: S.akreditasiSchema, roles: ['super_admin', 'admin'], scope: null, singleton: false },
  ],
  [
    'visi_misi',
    { schema: S.visiMisiSchema, roles: ['super_admin', 'admin'], scope: null, singleton: true },
  ],
  [
    'jurusan_berita',
    {
      schema: S.jurusanBeritaSchema.extend({ jurusan_id: z.uuid().nullable().optional() }),
      roles: ['super_admin', 'admin', 'admin_jurusan'],
      scope: 'jurusan',
      singleton: false,
    },
  ],
  [
    'jurusan_produk',
    {
      schema: S.jurusanProdukSchema.extend({ jurusan_id: z.uuid().nullable().optional() }),
      roles: ['super_admin', 'admin', 'admin_jurusan'],
      scope: 'jurusan',
      singleton: false,
    },
  ],
  [
    'guru_produktif',
    {
      schema: S.guruProduktifSchema.extend({ jurusan_id: z.uuid().nullable().optional() }),
      roles: ['super_admin', 'admin', 'admin_jurusan'],
      scope: 'jurusan',
      singleton: false,
    },
  ],
  [
    'mitra_industri_jurusan',
    {
      schema: S.mitraIndustriJurusanSchema.extend({ jurusan_id: z.uuid().nullable().optional() }),
      roles: ['super_admin', 'admin', 'admin_jurusan'],
      scope: 'jurusan',
      singleton: false,
    },
  ],
  [
    'fasilitas_praktik',
    {
      schema: S.fasilitasPraktikSchema.extend({ jurusan_id: z.uuid().nullable().optional() }),
      roles: ['super_admin', 'admin', 'admin_jurusan'],
      scope: 'jurusan',
      singleton: false,
    },
  ],
  [
    'prestasi_jurusan',
    {
      schema: S.prestasiJurusanSchema.extend({ jurusan_id: z.uuid().nullable().optional() }),
      roles: ['super_admin', 'admin', 'admin_jurusan'],
      scope: 'jurusan',
      singleton: false,
    },
  ],
  [
    'sertifikasi_jurusan',
    {
      schema: S.sertifikasiJurusanSchema.extend({ jurusan_id: z.uuid().nullable().optional() }),
      roles: ['super_admin', 'admin', 'admin_jurusan'],
      scope: 'jurusan',
      singleton: false,
    },
  ],
  [
    'teaching_factory',
    {
      schema: S.teachingFactorySchema.extend({ jurusan_id: z.uuid().nullable().optional() }),
      roles: [
        'super_admin',
        'admin',
        'admin_hubin',
        'waka_hubin',
        'waka_humas',
        'waka_hubin_humas',
        'wks_4',
        'admin_jurusan',
      ],
      scope: 'jurusan',
      singleton: false,
    },
  ],
  [
    'organisasi',
    {
      schema: S.organisasiSchema.extend({
        page: z.string().optional(),
        sort_order: z.number().int().optional(),
      }),
      roles: ['super_admin', 'admin', 'waka_kesiswaan', 'wks_2'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'ekstrakurikuler',
    {
      schema: S.ekstrakurikulerSchema,
      roles: ['super_admin', 'admin', 'waka_kesiswaan', 'wks_2'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'spmb_timeline',
    {
      schema: S.spmbTimelineSchema,
      roles: ['super_admin', 'admin'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'spmb_persyaratan',
    {
      schema: S.spmbPersyaratanSchema,
      roles: ['super_admin', 'admin'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'spmb_jadwal',
    { schema: S.spmbJadwalSchema, roles: ['super_admin', 'admin'], scope: null, singleton: false },
  ],
  [
    'spmb_biaya',
    { schema: S.spmbBiayaSchema, roles: ['super_admin', 'admin'], scope: null, singleton: false },
  ],
  [
    'spmb_faq',
    { schema: S.spmbFaqSchema, roles: ['super_admin', 'admin'], scope: null, singleton: false },
  ],
  [
    'spmb_pengumuman',
    {
      schema: S.spmbPengumumanSchema,
      roles: ['super_admin', 'admin'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'spmb_settings',
    { schema: S.spmbSettingsSchema, roles: ['super_admin', 'admin'], scope: null, singleton: true },
  ],
  [
    'kalender_akademik',
    {
      schema: S.kalenderAkademikSchema,
      roles: ['super_admin', 'admin', 'waka_akademik', 'waka_kurikulum', 'wks_1'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'kurikulum',
    {
      schema: S.kurikulumSchema,
      roles: ['super_admin', 'admin', 'waka_akademik', 'waka_kurikulum', 'wks_1'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'kkm',
    {
      schema: S.kkmSchema.extend({
        subject: z.string().optional(),
        grade_level: z.string().optional(),
        kkm_value: z.number().optional(),
        year: z.string().optional(),
      }),
      roles: ['super_admin', 'admin', 'waka_akademik', 'waka_kurikulum', 'wks_1'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'materi_pembelajaran',
    {
      schema: S.materiPembelajaranSchema,
      roles: ['super_admin', 'admin', 'waka_akademik', 'waka_kurikulum', 'wks_1'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'bank_soal',
    {
      schema: S.bankSoalSchema,
      roles: ['super_admin', 'admin', 'waka_akademik', 'waka_kurikulum', 'wks_1'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'jadwal_ujian',
    {
      schema: S.jadwalUjianSchema,
      roles: ['super_admin', 'admin', 'waka_akademik', 'waka_kurikulum', 'wks_1'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'tata_tertib',
    {
      schema: S.tataTertibSchema,
      roles: ['super_admin', 'admin', 'waka_kesiswaan', 'wks_2'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'poin_pelanggaran',
    {
      schema: S.poinPelanggaranSchema,
      roles: ['super_admin', 'admin', 'waka_kesiswaan', 'wks_2'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'waka_akademik',
    {
      schema: S.wakaAkademikSchema,
      roles: ['super_admin', 'admin', 'waka_akademik', 'waka_kurikulum', 'wks_1'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'waka_kesiswaan',
    {
      schema: S.wakaKesiswaanSchema,
      roles: ['super_admin', 'admin', 'waka_kesiswaan', 'wks_2'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'waka_hubin',
    {
      schema: S.wakaHubinSchema,
      roles: [
        'super_admin',
        'admin',
        'admin_hubin',
        'waka_hubin',
        'waka_humas',
        'waka_hubin_humas',
        'wks_4',
      ],
      scope: null,
      singleton: false,
    },
  ],
  [
    'beasiswa',
    {
      schema: S.beasiswaSchema,
      roles: ['super_admin', 'admin', 'waka_kesiswaan', 'wks_2'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'alumni_inspiratif',
    {
      schema: S.alumniInspiratifSchema,
      roles: ['super_admin', 'admin', 'waka_kesiswaan', 'wks_2', 'bkk'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'mitra_dudi',
    {
      schema: S.mitraDudiSchema,
      roles: [
        'super_admin',
        'admin',
        'admin_hubin',
        'waka_hubin',
        'waka_humas',
        'waka_hubin_humas',
        'wks_4',
      ],
      scope: null,
      singleton: false,
    },
  ],
  [
    'mou_kerjasama',
    {
      schema: S.mouKerjasamaSchema,
      roles: [
        'super_admin',
        'admin',
        'admin_hubin',
        'waka_hubin',
        'waka_humas',
        'waka_hubin_humas',
        'wks_4',
      ],
      scope: null,
      singleton: false,
    },
  ],
  [
    'guru_tamu',
    {
      schema: S.guruTamuSchema,
      roles: [
        'super_admin',
        'admin',
        'admin_hubin',
        'waka_hubin',
        'waka_humas',
        'waka_hubin_humas',
        'wks_4',
      ],
      scope: null,
      singleton: false,
    },
  ],
  [
    'testimoni_dudi',
    {
      schema: S.testimoniDudiSchema,
      roles: [
        'super_admin',
        'admin',
        'admin_hubin',
        'waka_hubin',
        'waka_humas',
        'waka_hubin_humas',
        'wks_4',
      ],
      scope: null,
      singleton: false,
    },
  ],
  [
    'tracer_alumni',
    {
      schema: S.tracerAlumniSchema,
      roles: [
        'super_admin',
        'admin',
        'admin_hubin',
        'waka_hubin',
        'waka_humas',
        'waka_hubin_humas',
        'wks_4',
        'bkk',
      ],
      scope: null,
      singleton: false,
    },
  ],
  [
    'bkk_lowongan',
    {
      schema: S.bkkLowonganSchema,
      roles: [
        'super_admin',
        'admin',
        'admin_hubin',
        'waka_hubin',
        'waka_humas',
        'waka_hubin_humas',
        'wks_4',
        'bkk',
      ],
      scope: null,
      singleton: false,
    },
  ],
  [
    'download_dokumen',
    {
      schema: S.downloadDokumenSchema,
      roles: ['super_admin', 'admin', 'jurnalistik'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'keunggulan_sekolah',
    {
      schema: S.keunggulanSekolahSchema,
      roles: ['super_admin', 'admin'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'tujuan_sekolah',
    {
      schema: S.tujuanSekolahSchema,
      roles: ['super_admin', 'admin'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'kriteria_kelulusan',
    {
      schema: S.kriteriaKelulusanSchema,
      roles: ['super_admin', 'admin', 'waka_akademik', 'waka_kurikulum', 'wks_1'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'lsp',
    {
      schema: S.lspSchema,
      roles: ['super_admin', 'admin', 'waka_akademik', 'waka_kurikulum', 'wks_1'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'ukk',
    {
      schema: S.ukkSchema,
      roles: ['super_admin', 'admin', 'waka_akademik', 'waka_kurikulum', 'wks_1'],
      scope: null,
      singleton: false,
    },
  ],
  [
    'jadwal_pelajaran',
    {
      schema: S.jadwalPelajaranSchema,
      roles: ['super_admin', 'admin', 'waka_akademik', 'waka_kurikulum', 'wks_1'],
      scope: null,
      singleton: false,
    },
  ],
]

// Only these declared domain resources can reach SQL; no client table/column SQL is accepted.
export const cmsContentResources = new Map(
  definitions.map(
    ([name, definition]) => [name, { ...definition, schema: definition.schema.strict() }] as const,
  ),
)

export function getCmsContentResource(name: string) {
  const resource = cmsContentResources.get(name)
  if (!resource) throw AppError.notFound('CMS resource')
  return resource
}

export function cmsPublicFields(name: string): string[] {
  const fields = getCmsContentResource(name).schema.keyof().options
  const hidden = new Set(
    name === 'guru_staff'
      ? ['nip', 'phone', 'email']
      : name === 'tracer_alumni'
        ? [
            'name',
            'graduation_year',
            'jurusan',
            'status',
            'company_or_campus',
            'position',
            'salary_range',
          ]
        : [],
  )
  return ['id', 'created_at', 'updated_at', ...fields.filter((field) => !hidden.has(field))]
}

export const cmsContentQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(100),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
    sort: z
      .string()
      .regex(/^[a-z_]+$/)
      .default('created_at'),
    direction: z.enum(['asc', 'desc']).default('asc'),
    id: z.uuid().optional(),
    slug: z.string().min(1).max(200).optional(),
    search: z.string().trim().min(2).max(100).optional(),
    jurusan: z.string().min(1).max(100).optional(),
    category: z.string().max(200).optional(),
    page: z.string().max(100).optional(),
    year_label: z.string().max(100).optional(),
    is_published: z.enum(['true', 'false']).optional(),
  })
  .strict()
export type CmsContentQueryInput = z.input<typeof cmsContentQuerySchema>
export type CmsContentQuery = z.infer<typeof cmsContentQuerySchema>
export interface CmsContentList {
  resource: string
  query: CmsContentQuery
  access: CmsSession | null
}
export interface CmsContentMutation {
  resource: string
  action: 'create' | 'update' | 'delete'
  id?: string
  data: CmsContentInput
  access: CmsSession
}

export function cmsJurusanAliases(slug: string): string[] {
  const value = slug.trim().toLowerCase()
  if (['pplg', 'rpl'].includes(value)) return ['pplg', 'rpl']
  if (['pm', 'pemasaran', 'bdp'].includes(value)) return ['pm', 'pemasaran', 'bdp']
  if (['ak', 'akl'].includes(value)) return ['ak', 'akl']
  if (['mplb', 'otkp'].includes(value)) return ['mplb', 'otkp']
  return [value]
}

export function assertCmsContentAccess(name: string, access: CmsSession) {
  const resource = getCmsContentResource(name)
  if (!resource.roles.includes(access.role)) throw AppError.forbidden()
  if (
    access.role === 'admin_jurusan' &&
    (!resource.scope || !access.jurusan_id || !access.jurusan_slug)
  ) {
    throw AppError.forbidden()
  }
}

export function validateCmsContentQuery(
  name: string,
  input: CmsContentQueryInput,
): CmsContentQuery {
  const result = cmsContentQuerySchema.safeParse(input)
  if (!result.success) throw AppError.validationError(result.error.flatten())
  const columns = new Set([
    'id',
    'created_at',
    'updated_at',
    ...getCmsContentResource(name).schema.keyof().options,
  ])
  if (!columns.has(result.data.sort)) throw AppError.validationError('Unsupported sort field.')
  for (const field of [
    'slug',
    'jurusan',
    'category',
    'page',
    'year_label',
    'is_published',
  ] as const) {
    if (result.data[field] !== undefined && !columns.has(field))
      throw AppError.validationError('Unsupported content filter.')
  }
  if (result.data.search && !columns.has('name'))
    throw AppError.validationError('Resource has no name search.')
  return result.data
}

export function prepareCmsContentWrite(params: CmsContentMutation): CmsContentInput {
  assertCmsContentAccess(params.resource, params.access)
  const resource = getCmsContentResource(params.resource)
  if (
    params.access.role === 'admin_jurusan' &&
    resource.scope === 'id' &&
    params.action !== 'update'
  )
    throw AppError.forbidden()
  if (params.action === 'delete') return {}
  const input = { ...params.data }
  const aliases = new Map<string, [string, string][]>(
    Object.entries({
      download_dokumen: [
        ['name', 'title'],
        ['type', 'file_type'],
      ],
      mou_kerjasama: [
        ['partner', 'partner_name'],
        ['scope', 'description'],
        ['signed_date', 'mou_date'],
        ['expired_date', 'valid_until'],
      ],
      guru_tamu: [['date', 'event_date']],
      tata_tertib: [['description', 'content']],
      testimoni_dudi: [['quote', 'content']],
      poin_pelanggaran: [
        ['title', 'violation'],
        ['poin', 'points'],
      ],
    }),
  )
  for (const [canonical, alias] of aliases.get(params.resource) ?? []) {
    if (
      input[canonical] !== undefined &&
      input[alias] !== undefined &&
      input[canonical] !== input[alias]
    )
      throw AppError.validationError('Conflicting content aliases.')
    if (input[canonical] !== undefined) input[alias] = input[canonical]
    else if (input[alias] !== undefined) input[canonical] = input[alias]
  }
  if (params.access.role === 'admin_jurusan' && resource.scope === 'id') {
    const slug = z.string().safeParse(input.slug)
    if (
      input.slug !== undefined &&
      (!slug.success ||
        !cmsJurusanAliases(params.access.jurusan_slug!).includes(slug.data.toLowerCase()))
    )
      throw AppError.forbidden()
  }
  if (params.access.role === 'admin_jurusan' && resource.scope === 'jurusan') {
    const slug = z.string().safeParse(input.jurusan)
    if (
      (input.jurusan !== undefined &&
        (!slug.success ||
          !cmsJurusanAliases(params.access.jurusan_slug!).includes(slug.data.toLowerCase()))) ||
      (input.jurusan_id !== undefined && input.jurusan_id !== params.access.jurusan_id)
    )
      throw AppError.forbidden()
    if (
      params.action === 'create' ||
      input.jurusan !== undefined ||
      input.jurusan_id !== undefined
    ) {
      input.jurusan_id = params.access.jurusan_id
      input.jurusan = slug.success ? slug.data : params.access.jurusan_slug
    }
  }
  if (
    params.access.role === 'jurnalistik' &&
    params.resource === 'berita' &&
    input.page !== undefined &&
    input.page !== null &&
    input.page !== '' &&
    input.page !== 'umum'
  )
    throw AppError.forbidden()
  const validator = params.action === 'create' ? resource.schema : resource.schema.partial()
  const result = validator.safeParse(input)
  if (!result.success) throw AppError.validationError(result.error.flatten())
  const data = cmsContentInputSchema.parse(result.data)
  if (params.action === 'update') {
    for (const key of Object.keys(data)) if (!Object.hasOwn(input, key)) delete data[key]
  }
  if (Object.keys(data).length === 0) throw AppError.validationError('Empty content mutation.')
  if (
    resource.schema.keyof().options.includes('order') &&
    resource.schema.keyof().options.includes('sort_order')
  ) {
    if (data.order !== undefined) data.sort_order = data.order
    else if (data.sort_order !== undefined) data.order = data.sort_order
  }
  return data
}

export function validateCmsContentRecord(resource: string, row: CmsContentInput) {
  const nonempty = (key: string) => z.string().trim().min(1).safeParse(row[key]).success
  const required = new Map([
    ['download_dokumen', 'name'],
    ['mou_kerjasama', 'partner'],
    ['poin_pelanggaran', 'title'],
  ])
  const field = required.get(resource)
  if (field && !nonempty(field)) throw AppError.validationError(`${field} is required.`)
  if (
    resource === 'tracer_alumni' &&
    !(nonempty('name') && nonempty('status')) &&
    !['year', 'employed_percent', 'college_percent', 'entrepreneur_percent'].every(nonempty)
  )
    throw AppError.validationError(
      'Tracer requires an individual outcome or complete yearly statistics.',
    )
}

export interface CmsContentImport {
  upsert_by_slug?: boolean
  resource: string
  data: CmsContentInput[]
  access: CmsSession
}

export function canReadCmsContent(name: string, access: CmsSession): boolean {
  const resource = getCmsContentResource(name)
  return resource.roles.includes(access.role) || !!resource.readRoles?.includes(access.role)
}
export function assertCmsContentReadAccess(name: string, access: CmsSession) {
  if (!canReadCmsContent(name, access)) throw AppError.forbidden()
  if (access.role === 'admin_jurusan') assertCmsContentAccess(name, access)
}
