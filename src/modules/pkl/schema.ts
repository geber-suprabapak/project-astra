import { z } from 'zod'
const requiredString = (label: string) => z.string().trim().min(1, `${label} wajib diisi`)

export const pklAcademicYearSchema = z.object({
  name: requiredString('Nama'),
  start_date: z.iso.date().nullish(),
  end_date: z.iso.date().nullish(),
  is_active: z.boolean(),
  is_published: z.boolean().default(true),
})

export const pklIndustrySchema = z.object({
  name: requiredString('Nama'),
  address: z.string().nullish(),
  city: z.string().nullish(),
  province: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().email().nullish().or(z.literal('')),
  website: z.string().nullish(),
  contact_person: z.string().nullish(),
  contact_phone: z.string().nullish(),
  contact_email: z.string().email().nullish().or(z.literal('')),
  industry_type: z.string().default('Umum'),
  quota: z.number().default(0),
  description: z.string().nullish(),
  logo: z.string().nullish(),
  is_published: z.boolean().default(true),
})

export const pklStudentSchema = z.object({
  nis: requiredString('NIS'),
  nisn: z.string().nullish(),
  name: requiredString('Nama'),
  class: z.string().nullish(),
  jurusan: requiredString('Jurusan'),
  phone: z.string().nullish(),
  parent_name: z.string().nullish(),
  parent_phone: z.string().nullish(),
  email: z.string().email().nullish().or(z.literal('')),
  is_published: z.boolean().default(false),
})

export const pklSupervisorSchema = z.object({
  name: requiredString('Nama'),
  nip: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().email().nullish().or(z.literal('')),
  jurusan: z.string().nullish(),
  max_students: z.number().default(10),
  is_published: z.boolean().default(true),
})

export const pklInternshipSchema = z.object({
  academic_year_id: z.uuid(),
  student_id: z.uuid(),
  industry_id: z.uuid(),
  supervisor_id: z.uuid().nullish(),
  start_date: z.iso.date().nullish(),
  end_date: z.iso.date().nullish(),
  status: z.enum(['pending', 'active', 'completed', 'cancelled', 'withdrawn']).default('pending'),
  notes: z.string().nullish(),
})

export const pklDailyJournalSchema = z.object({
  internship_id: z.uuid(),
  date: z.iso.date(),
  description: z.string().nullish(),
  activities: z.string().nullish(),
  status: z
    .enum(['draft', 'pending', 'submitted', 'approved', 'rejected', 'revision'])
    .default('draft'),
  supervisor_notes: z.string().nullish(),
})

export const pklAssessmentIndicatorSchema = z.object({
  name: requiredString('Nama'),
  description: z.string().nullish(),
  max_score: z.number().default(100),
  category: z.enum(['combined', 'supervisor', 'industry']).default('combined'),
  weight: z.number().default(1.0),
  sort_order: z.number(),
  is_published: z.boolean().default(true),
})

export const pklAssessmentScoreSchema = z.object({
  internship_id: z.uuid(),
  indicator_id: z.uuid(),
  supervisor_score: z.number().min(0).max(100).nullish(),
  industry_score: z.number().min(0).max(100).nullish(),
  final_score: z.number().min(0).max(100).nullish(),
  notes: z.string().nullish(),
})

export const pklCertificateSchema = z.object({
  internship_id: z.uuid(),
  certificate_number: requiredString('Nomor Sertifikat'),
  issue_date: z.iso.date(),
  signed_by: z.string().nullish(),
  signed_title: z.string().nullish(),
  notes: z.string().nullish(),
})

export const registrationStatusSchema = z.enum([
  'BELUM_DAFTAR',
  'PENDING_APPROVAL',
  'MENCARI_INDUSTRI',
  'MENUNGGU_INDUSTRI',
  'DITERIMA',
  'PKL_BERJALAN',
  'SELESAI',
  'DITOLAK',
  'DIBATALKAN',
])
export type RegistrationStatus = z.infer<typeof registrationStatusSchema>
export const pklRegistrationSchema = z.object({
  student_id: z.uuid(),
  academic_year_id: z.uuid(),
  industry_id: z.uuid().nullish(),
  is_self_proposed: z.boolean().default(false),
  proposed_industry_name: z.string().nullish(),
  proposed_industry_address: z.string().nullish(),
  proposed_industry_contact: z.string().nullish(),
  proposed_industry_phone: z.string().nullish(),
  proposed_industry_email: z.string().nullish(),
  proposed_acceptance_letter: z.string().nullish(),
  motivation: z.string().nullish(),
  preferred_supervisor_name: z.string().nullish(),
  start_date_preferred: z.iso.date().nullish(),
})
export const pklApplicationSchema = z.object({
  student_id: z.uuid(),
  academic_year_id: z.uuid(),
  industry_id: z.uuid().nullish(),
  preferred_industry_name: z.string().nullish(),
  preferred_supervisor_name: z.string().nullish(),
  motivation: z.string().nullish(),
  start_date_preferred: z.iso.date().nullish(),
})
export const pklAttendanceSchema = z.object({
  internship_id: z.uuid(),
  student_id: z.uuid(),
  date: z.iso.date(),
  check_in_lat: z.number().min(-90).max(90).nullish(),
  check_in_lng: z.number().min(-180).max(180).nullish(),
  check_out_lat: z.number().min(-90).max(90).nullish(),
  check_out_lng: z.number().min(-180).max(180).nullish(),
  status: z.enum(['HADIR', 'IZIN', 'SAKIT', 'ALPA', 'LIBUR']).default('HADIR'),
  notes: z.string().nullish(),
  photo_url: z.string().nullish(),
})
export const pklMonitoringSchema = z.object({
  internship_id: z.uuid(),
  supervisor_id: z.uuid(),
  scheduled_date: z.iso.date(),
  visit_date: z.iso.date().nullish(),
  notes: z.string().nullish(),
  visit_notes: z.string().nullish(),
  evaluation: z.string().nullish(),
  photo_urls: z.array(z.string()).default([]),
  status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']).default('scheduled'),
})
export const pklDocumentSchema = z.object({
  student_id: z.uuid(),
  internship_id: z.uuid().nullish(),
  registration_id: z.uuid().nullish(),
  doc_type: z.enum(['surat_penerimaan', 'laporan', 'cv', 'lainnya']),
  title: requiredString('Judul'),
  file_url: requiredString('File'),
  file_size: z.number().int().nonnegative().nullish(),
  mime_type: z.string().nullish(),
})
export const pklCommentSchema = z.object({
  journal_id: z.uuid(),
  comment: requiredString('Komentar'),
})
export const pklHistorySchema = z.object({ registration_id: z.uuid() })
export const pklIndustryAccountSchema = z.object({
  industry_id: z.uuid(),
  profile_id: z.uuid(),
  access_enabled: z.boolean().default(true),
})
export const pklCertificateTemplateSchema = z.object({
  name: requiredString('Nama'),
  is_active: z.boolean().default(false),
  image_url: requiredString('Gambar'),
  template_data: z.json().optional(),
})
export const pklRosterSchema = z.object({
  nis: requiredString('NIS'),
  nisn: z.string().nullish(),
  name: requiredString('Nama'),
  jurusan: requiredString('Jurusan'),
  class: z.string().nullish(),
  phone: z.string().nullish(),
  address: z.string().nullish(),
  gender: z.enum(['L', 'P']).nullish(),
  birth_date: z.iso.date().nullish(),
  birth_place: z.string().nullish(),
  is_active: z.boolean().default(true),
})
