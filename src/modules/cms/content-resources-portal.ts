import { z } from 'zod'
import * as S from './content-schema.js'
import type { ResourceDefinition } from './content-types.js'

export const portalContentDefinitions: [string, ResourceDefinition][] = [
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
