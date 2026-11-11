import { z } from 'zod'

// CMS write validation also runs at the Astra trust boundary.
const requiredString = (label: string) => z.string().min(1, `${label} wajib diisi`)

export const schoolInfoSchema = z.object({
  school_name: z.string().min(1),
  school_tagline: z.string().nullish(),
  npsn: z.string().nullish(),
  nss: z.string().nullish(),
  principal_name: z.string().nullish(),
  principal_title: z.string().nullish(),
  principal_photo: z.string().nullish(),
  principal_greeting: z.string().nullish(),
  principal_greeting_title: z.string().nullish(),
  address: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().email('Email tidak valid').nullish().or(z.literal('')),
  whatsapp: z.string().nullish(),
  operating_hours: z.string().nullish(),
  maps_embed_url: z.string().nullish(),
  maps_link: z.string().nullish(),
  instagram_url: z.string().nullish(),
  youtube_url: z.string().nullish(),
  facebook_url: z.string().nullish(),
  tiktok_url: z.string().nullish(),
  stat_founded: z.string().nullish(),
  stat_students: z.string().nullish(),
  stat_teachers: z.string().nullish(),
  stat_programs: z.string().nullish(),
  stat_graduation_rate: z.string().nullish(),
  stat_dudi_partners: z.string().nullish(),
})

export const heroSlideSchema = z.object({
  title: requiredString('Judul'),
  subtitle: z.string().nullish(),
  image: requiredString('URL Gambar'),
  cta_label: z.string().nullish(),
  cta_href: z.string().nullish(),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const schoolStatSchema = z.object({
  label: requiredString('Label'),
  value: requiredString('Nilai'),
  suffix: z.string().nullish(),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const guruStaffSchema = z.object({
  name: requiredString('Nama'),
  role: z.string().min(1, 'Jabatan wajib diisi'),
  nip: z.string().nullish().or(z.literal('')),
  image: z.string().nullish(),
  email: z.string().email().nullish().or(z.literal('')),
  phone: z.string().nullish(),
  category: z.string().min(1, 'Kategori wajib diisi'),
  jurusan: z.string().nullish(),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const jurusanSchema = z.object({
  name: requiredString('Nama'),
  slug: requiredString('Slug'),
  short_name: requiredString('Nama singkat'),
  description: z.string().min(1, 'Deskripsi wajib diisi'),
  image: z.string().nullish(),
  icon: z.string().nullish(),
  highlights: z.union([z.array(z.string()), z.string()]).nullish(),
  careers: z.union([z.array(z.string()), z.string()]).nullish(),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const beritaSchema = z.object({
  title: requiredString('Judul'),
  slug: requiredString('Slug'),
  excerpt: z.string().min(1, 'Ringkasan wajib diisi'),
  content: z.string().min(1, 'Konten wajib diisi'),
  image: z.string().nullish(),
  category: z.string().min(1, 'Kategori wajib diisi'),
  author: z.string().min(1, 'Penulis wajib diisi'),
  is_published: z.boolean(),
  published_at: z.string().nullish(),
})

export const galeriSchema = z.object({
  title: requiredString('Judul'),
  image: requiredString('URL Media'),
  category: z.string().min(1, 'Kategori wajib diisi'),
  description: z.string().nullish(),
  date: z.string().nullish(),
  jurusan: z.string().nullish(),
  media_type: z.string().default('gambar'),
  is_published: z.boolean(),
})

export const sarprasSchema = z.object({
  title: requiredString('Nama'),
  description: z.string().min(1, 'Deskripsi wajib diisi'),
  image: z.string().nullish(),
  capacity: z.string().nullish(),
  category: z.string().default('Umum'),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const prestasiSchema = z.object({
  title: requiredString('Judul'),
  level: z.string().min(1, 'Tingkat wajib diisi'),
  year: requiredString('Tahun'),
  category: z.string().min(1, 'Kategori wajib diisi'),
  description: z.string().nullish(),
  image: z.string().nullish(),
  is_published: z.boolean(),
})

export const agendaSchema = z.object({
  title: requiredString('Judul'),
  description: z.string().min(1, 'Deskripsi wajib diisi'),
  date: requiredString('Tanggal'),
  time: z.string().min(1, 'Waktu wajib diisi'),
  location: z.string().min(1, 'Lokasi wajib diisi'),
  category: z.string().min(1, 'Kategori wajib diisi'),
  image: z.string().nullish(),
  is_published: z.boolean(),
})

export const keunggulanSchema = z.object({
  title: requiredString('Judul'),
  description: z.string().min(1, 'Deskripsi wajib diisi'),
  icon: z.string().min(1, 'Icon wajib diisi'),
  image: z.string().nullish(),
  stat: z.string().nullish(),
  href: z.string().nullish(),
  category: z.enum(['card', 'highlight']).default('card'),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const layananSchema = z.object({
  name: requiredString('Nama'),
  label: z.string().nullish(),
  description: z.string().nullish(),
  href: requiredString('URL'),
  image: z.string().nullish(),
  image_position: z.string().nullish(),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const sejarahSchema = z.object({
  year: requiredString('Tahun'),
  title: requiredString('Judul'),
  description: z.string().nullish(),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const strukturOrganisasiSchema = z.object({
  name: requiredString('Nama'),
  role: requiredString('Jabatan'),
  abbr: z.string().nullish(),
  image: z.string().nullish(),
  category: requiredString('Kategori'),
  order: z.number(),
  is_published: z.boolean(),
})

export const akreditasiSchema = z.object({
  title: requiredString('Judul'),
  issuer: z.string().nullish(),
  year: z.string().nullish(),
  grade: z.string().nullish(),
  description: z.string().nullish(),
  document_url: z.string().nullish(),
  image: z.string().nullish(),
  is_published: z.boolean(),
})

export const visiMisiSchema = z.object({
  visi: z.string().nullish(),
  misi: z.array(z.string()).nullish(),
  tujuan: z.array(z.string()).nullish(),
})

export const jurusanBeritaSchema = z.object({
  jurusan: requiredString('Jurusan'),
  title: requiredString('Judul'),
  description: z.string().nullish(),
  image: z.string().nullish(),
  tag: z.string().nullish(),
  date: requiredString('Tanggal'),
  is_published: z.boolean(),
})

export const jurusanProdukSchema = z.object({
  jurusan: requiredString('Jurusan'),
  title: requiredString('Judul'),
  description: z.string().nullish(),
  image: z.string().nullish(),
  tech: z.string().nullish(),
  made_by: z.string().nullish(),
  is_published: z.boolean(),
})

export const guruProduktifSchema = z.object({
  jurusan: requiredString('Jurusan'),
  name: requiredString('Nama'),
  title: z.string().nullish(),
  photo: z.string().nullish(),
  subjects: z.string().nullish(),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const mitraIndustriJurusanSchema = z.object({
  jurusan: requiredString('Jurusan'),
  name: requiredString('Nama'),
  logo: z.string().nullish(),
  category: z.string().default('Umum'),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const fasilitasPraktikSchema = z.object({
  jurusan: requiredString('Jurusan'),
  name: requiredString('Nama'),
  description: z.string().nullish(),
  image: z.string().nullish(),
  capacity: z.string().nullish(),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const prestasiJurusanSchema = z.object({
  jurusan: requiredString('Jurusan'),
  title: requiredString('Judul'),
  level: z.string().default('Sekolah'),
  year: requiredString('Tahun'),
  category: z.string().default('Akademik'),
  description: z.string().nullish(),
  image: z.string().nullish(),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const sertifikasiJurusanSchema = z.object({
  jurusan: requiredString('Jurusan'),
  name: requiredString('Nama'),
  issuer: z.string().nullish(),
  description: z.string().nullish(),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const teachingFactorySchema = z.object({
  jurusan: requiredString('Jurusan'),
  name: requiredString('Nama'),
  description: z.string().nullish(),
  image: z.string().nullish(),
  products: z.string().nullish(),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const organisasiSchema = z.object({
  name: requiredString('Nama'),
  description: z.string().min(1, 'Deskripsi wajib diisi'),
  category: z.enum(['organisasi', 'sub_organisasi', 'ekstrakurikuler'], {
    message: 'Kategori wajib dipilih',
  }),
  image: z.string().nullish(),
  ketua: z.string().nullish(),
  pembina: z.string().nullish(),
  order: z.number(),
  is_published: z.boolean(),
})

export const ekstrakurikulerSchema = z.object({
  name: requiredString('Nama'),
  category: z.string().default('Umum'),
  description: z.string().nullish(),
  image: z.string().nullish(),
  pembina: z.string().nullish(),
  schedule: z.string().nullish(),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const spmbTimelineSchema = z.object({
  step: z.number().min(1, 'Step wajib diisi'),
  title: requiredString('Judul'),
  date: requiredString('Tanggal'),
  description: z.string().nullish(),
  is_published: z.boolean(),
})

export const spmbPersyaratanSchema = z.object({
  text: requiredString('Persyaratan'),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const spmbJadwalSchema = z.object({
  title: requiredString('Judul'),
  date: requiredString('Tanggal'),
  description: z.string().nullish(),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const spmbBiayaSchema = z.object({
  item: requiredString('Item'),
  amount: requiredString('Biaya'),
  description: z.string().nullish(),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
  category: z.string().default('Umum'),
})

export const spmbFaqSchema = z.object({
  question: requiredString('Pertanyaan'),
  answer: requiredString('Jawaban'),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const spmbPengumumanSchema = z.object({
  title: requiredString('Judul'),
  content: z.string().nullish(),
  file_url: z.string().nullish(),
  date: z.string().nullish(),
  is_published: z.boolean(),
})

export const spmbSettingsSchema = z.object({
  title: z.string().nullish(),
  description: z.string().nullish(),
  tahun_ajaran: z.string().nullish(),
  tanggal_buka: z.string().nullish(),
  tanggal_tutup: z.string().nullish(),
  kuota: z.string().nullish(),
  form_url: z.string().nullish(),
  upload_url: z.string().nullish(),
  form_description: z.string().nullish(),
  berkas_description: z.string().nullish(),
  contact_name: z.string().nullish(),
  contact_whatsapp: z.string().nullish(),
  contact_email: z.string().email().nullish().or(z.literal('')),
  contact_phone: z.string().nullish(),
  contact_address: z.string().nullish(),
  pengumuman_link: z.string().nullish(),
  pengumuman_description: z.string().nullish(),
  pengumuman_date: z.string().nullish(),
  registration_open: z.boolean(),
})

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

export const keunggulanSekolahSchema = z.object({
  title: requiredString('Judul'),
  description: z.string().nullish(),
  badge: z.string().nullish(),
  icon: z.string().default('Star'),
  color: z.string().default('blue'),
  href: z.string().nullish(),
  highlights: z.array(z.string()).nullish(),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
})

export const tujuanSekolahSchema = z.object({
  title: requiredString('Judul'),
  description: z.string().nullish(),
  sort_order: z.number().default(0),
  is_published: z.boolean(),
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
