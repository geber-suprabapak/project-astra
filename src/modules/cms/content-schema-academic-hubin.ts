import { z } from 'zod'
import { requiredString } from './content-schema-core.js'

export const kalenderAkademikSchema = z.object({
  month: requiredString('Bulan'),
  year_label: requiredString('Tahun Ajaran'),
  events: z.array(z.unknown()).nullish(),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const kurikulumSchema = z.object({
  title: requiredString('Judul'),
  description: z.string().nullish(),
  category: z.string().default('Umum'),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const kkmSchema = z.object({
  jurusan: requiredString('Jurusan'),
  mapel: requiredString('Mata Pelajaran'),
  kkm: requiredString('Nilai KKM'),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const materiPembelajaranSchema = z.object({
  title: requiredString('Judul'),
  description: z.string().nullish(),
  file_url: z.string().nullish(),
  subject: z.string().nullish(),
  jurusan: z.string().nullish(),
  kelas: z.string().nullish(),
  mapel: z.string().nullish(),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const bankSoalSchema = z.object({
  title: requiredString('Judul'),
  description: z.string().nullish(),
  file_url: z.string().nullish(),
  subject: z.string().nullish(),
  jurusan: z.string().nullish(),
  mapel: z.string().nullish(),
  tipe: z.string().default('Umum'),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const jadwalUjianSchema = z.object({
  title: requiredString('Judul'),
  date: requiredString('Tanggal'),
  time: z.string().nullish(),
  duration: z.string().nullish(),
  room: z.string().nullish(),
  category: z.string().default('Umum'),
  type: z.string().default('Sumatif'),
  date_start: z.string().nullish(),
  date_end: z.string().nullish(),
  kelas: z.string().nullish(),
  file_url: z.string().nullish(),
  description: z.string().nullish(),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const tataTertibSchema = z.object({
  title: requiredString('Judul'),
  description: z.string().nullish(),
  category: z.string().default('Umum'),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
  content: z.string().nullish(),
})

export const poinPelanggaranSchema = z.object({
  title: z.string().nullish(),
  description: z.string().nullish(),
  poin: z.number().default(5),
  violation: z.string().nullish(),
  points: z.number().default(5),
  category: z.string().default('Ringan'),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const wakaAkademikSchema = z.object({
  title: requiredString('Judul'),
  category: z.enum(
    [
      'kurikulum',
      'kalender',
      'jadwal',
      'modul',
      'ukk',
      'lsp',
      'kkm',
      'bank_soal',
      'materi',
      'jadwal_ujian',
    ],
    { error: 'Kategori wajib dipilih' },
  ),
  description: requiredString('Deskripsi'),
  file_url: z.string().nullish(),
  is_published: z.boolean(),
})

export const wakaKesiswaanSchema = z.object({
  title: requiredString('Judul'),
  category: z.enum(['osis', 'ekskul', 'prestasi', 'tata_tertib', 'beasiswa', 'alumni'], {
    error: 'Kategori wajib dipilih',
  }),
  description: requiredString('Deskripsi'),
  image: z.string().nullish(),
  is_published: z.boolean(),
})

export const wakaHubinSchema = z.object({
  title: requiredString('Judul'),
  category: z.enum(
    ['mitra', 'mou', 'pkl', 'teaching_factory', 'guru_tamu', 'testimoni', 'tracer', 'bkk'],
    { error: 'Kategori wajib dipilih' },
  ),
  description: requiredString('Deskripsi'),
  image: z.string().nullish(),
  is_published: z.boolean(),
})

export const beasiswaSchema = z.object({
  name: requiredString('Nama'),
  provider: z.string().nullish(),
  description: z.string().nullish(),
  requirements: z.string().nullish(),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
  amount: z.string().nullish(),
  deadline: z.string().nullish(),
  link: z.string().nullish(),
})

export const alumniInspiratifSchema = z.object({
  name: requiredString('Nama'),
  graduation_year: requiredString('Tahun Lulus'),
  achievement: requiredString('Prestasi'),
  photo: z.string().nullish(),
  company: z.string().nullish(),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const mitraDudiSchema = z.object({
  name: requiredString('Nama'),
  logo: z.string().nullish(),
  category: z.string().default('Umum'),
  description: z.string().nullish(),
  website: z.string().nullish(),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const mouKerjasamaSchema = z.object({
  partner: z.string().nullish(),
  scope: z.string().nullish(),
  year: z.string().nullish(),
  document_url: z.string().nullish(),
  is_published: z.boolean(),
  partner_name: z.string().nullish(),
  type: z.string().nullish(),
  category: z.string().nullish(),
  mou_number: z.string().nullish(),
  signed_date: z.string().nullish(),
  expired_date: z.string().nullish(),
  description: z.string().nullish(),
  image: z.string().nullish(),
  mou_date: z.string().nullish(),
  valid_until: z.string().nullish(),
  sort_order: z.number().int().default(0),
})

export const guruTamuSchema = z.object({
  name: requiredString('Nama'),
  company: requiredString('Perusahaan'),
  topic: z.string().nullish(),
  date: z.string().nullish(),
  is_published: z.boolean(),
  position: z.string().nullish(),
  field: z.string().nullish(),
  description: z.string().nullish(),
  image: z.string().nullish(),
  event_date: z.string().nullish(),
  sort_order: z.number().int().default(0),
})

export const testimoniDudiSchema = z.object({
  name: requiredString('Nama'),
  company: z.string().nullish(),
  position: z.string().nullish(),
  quote: z.string().nullish(),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
  content: z.string().nullish(),
  image: z.string().nullish(),
  rating: z.number().min(1).max(5).default(5),
})

export const tracerAlumniSchema = z.object({
  year: z.string().nullish(),
  employed_percent: z.string().nullish(),
  college_percent: z.string().nullish(),
  entrepreneur_percent: z.string().nullish(),
  is_published: z.boolean(),
  name: z.string().nullish(),
  jurusan: z.string().nullish(),
  company_or_campus: z.string().nullish(),
  position: z.string().nullish(),
  salary_range: z.string().nullish(),
  graduation_year: z.number().int().nullish(),
  status: z.enum(['Bekerja', 'Kuliah', 'Wirausaha', 'Lainnya']).nullish(),
})

export const bkkLowonganSchema = z.object({
  title: requiredString('Judul'),
  company: requiredString('Perusahaan'),
  location: z.string().nullish(),
  type: z.string().nullish(),
  deadline: z.string().nullish(),
  description: z.string().nullish(),
  is_published: z.boolean(),
  requirements: z.string().nullish(),
  salary: z.string().nullish(),
  link: z.string().nullish(),
  image: z.string().nullish(),
})

export const documentSchema = z.object({
  name: requiredString('Nama Dokumen'),
  type: z.string().default('PDF'),
  size: z.string().nullish(),
  file_url: requiredString('URL File'),
  category: z.string().default('Umum'),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const downloadDokumenSchema = documentSchema.extend({
  description: z.string().nullish(),
  title: z.string().nullish(),
  file_type: z.string().nullish(),
  file_name: z.string().nullish(),
})

export const kriteriaKelulusanSchema = z.object({
  title: requiredString('Judul'),
  description: z.string().nullish(),
  points: z.array(z.object({ no: z.number().int().nullish(), text: z.string() })).nullish(),
  year_academic: z.string().nullish(),
  sort_order: z.number().int(),
  is_published: z.boolean(),
})

export const lspSchema = z.object({
  title: requiredString('Judul'),
  description: z.string().nullish(),
  category: z.string(),
  image: z.string().nullish(),
  document_url: z.string().nullish(),
  sort_order: z.number().int(),
  is_published: z.boolean(),
})

export const ukkSchema = z.object({
  title: requiredString('Judul'),
  jurusan: z.string(),
  year: z.string(),
  scheme: z.string().nullish(),
  description: z.string().nullish(),
  schedule: z.string().nullish(),
  requirements: z.string().nullish(),
  file_url: z.string().nullish(),
  sort_order: z.number().int(),
  is_published: z.boolean(),
})

export const jadwalPelajaranSchema = z.object({
  title: requiredString('Judul'),
  jurusan: z.string(),
  kelas: z.string(),
  day: z.string(),
  time_start: z.string().nullish(),
  time_end: z.string().nullish(),
  subject: z.string(),
  teacher: z.string().nullish(),
  room: z.string().nullish(),
  sort_order: z.number().int(),
  is_published: z.boolean(),
})

export const modulAjarSchema = z.object({
  title: requiredString('Judul'),
  category: z.string(),
  jurusan: z.string(),
  subject: z.string(),
  kelas: z.string().nullish(),
  description: z.string().nullish(),
  file_url: z.string().nullish(),
  sort_order: z.number().int(),
  is_published: z.boolean(),
})

export const pklAlurStepSchema = z.object({
  step: z.number().int().min(1),
  title: requiredString('Judul'),
  description: z.string().nullish(),
  is_published: z.boolean(),
  sort_order: z.number().int(),
})
