import { z } from 'zod'
import { requiredString } from './content-schema-core.js'

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
