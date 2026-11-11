import { z } from 'zod'

// CMS/PKL roles are separate from the mobile/attendance identity roles.
export const cmsRoleSchema = z.enum([
  'super_admin',
  'admin',
  'admin_jurusan',
  'admin_hubin',
  'siswa',
  'guru',
  'industri',
  'pembimbing_sekolah',
  'pembimbing_industri',
  'supervisor',
  'monitoring_sipkl',
  'admin_monitoring',
  'jurnalistik',
  'bkk',
  'wks_1',
  'wks_2',
  'wks_3',
  'wks_4',
  'waka_akademik',
  'waka_kesiswaan',
  'waka_sarpras',
  'waka_hubin',
  'waka_humas',
  'waka_hubin_humas',
  'waka_kurikulum',
])

export const cmsProfileSchema = z.object({
  id: z.uuid(),
  logto_subject: z.string().min(1),
  full_name: z.string().nullable(),
  created_at: z.iso.datetime({ offset: true }).nullable().optional(),
  email: z.string().nullable(),
  role: cmsRoleSchema,
  jurusan_id: z.uuid().nullable(),
  jurusan_slug: z.string().min(1).nullable(),
  authz_version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  access_enabled: z.boolean(),
  session_valid_after: z.string().datetime({ offset: true }).nullable(),
})

export type CmsProfile = z.infer<typeof cmsProfileSchema>

export type CmsSession = Pick<
  CmsProfile,
  'id' | 'full_name' | 'email' | 'role' | 'jurusan_id' | 'jurusan_slug' | 'authz_version'
>
