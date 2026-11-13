import { z } from 'zod'

// CMS write validation also runs at the Astra trust boundary.
export const requiredString = (label: string) => z.string().min(1, `${label} wajib diisi`)

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
