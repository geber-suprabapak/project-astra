import { z } from 'zod'
import * as S from './content-schema.js'
import type { ResourceDefinition } from './content-types.js'

export const generalContentDefinitions: [string, ResourceDefinition][] = [
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
]
