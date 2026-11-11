import { randomUUID } from 'node:crypto'
import { calculateIndicatorFinalScore } from './assessment.js'
import { z } from 'zod'
import { AppError } from '../../lib/errors/app-error.js'
import type { CmsSession } from '../cms/schema.js'
import * as S from './schema.js'

const studentSchema = S.pklStudentSchema.extend({
  is_active: z.boolean().default(true),
  profile_id: z.uuid().nullish(),
  siswa_id: z.uuid().nullish(),
  address: z.string().nullish(),
  gender: z.enum(['L', 'P']).nullish(),
  birth_date: z.iso.date().nullish(),
  birth_place: z.string().nullish(),
  profile_completed: z.boolean().default(false),
})
const industrySchema = S.pklIndustrySchema.extend({
  supervisor_id: z.uuid().nullish(),
  profile_id: z.uuid().nullish(),
  bidang_usaha: z.string().nullish(),
  is_active: z.boolean().default(true),
  partnership_since: z.iso.date().nullish(),
  partnership_history: z
    .array(
      z
        .object({
          type: z.string(),
          date: z.string().nullish(),
          description: z.string().nullish(),
          notes: z.string().nullish(),
        })
        .strict(),
    )
    .default([]),
})
const supervisorSchema = S.pklSupervisorSchema.extend({
  employee_id: z.string().nullish(),
  specialization: z.string().nullish(),
  profile_id: z.uuid().nullish(),
  guru_staff_id: z.uuid().nullish(),
  is_active: z.boolean().default(true),
})
const internshipSchema = S.pklInternshipSchema.extend({
  supervisor_guru_id: z.uuid().nullish(),
  instructor_dudi: z.string().nullish(),
  final_score: z.number().min(0).max(100).nullish(),
  grade: z.string().nullish(),
})
const journalSchema = S.pklDailyJournalSchema.extend({
  notes: z.string().nullish(),
  activity: z.string().nullish(),
  documentation_url: z.string().nullish(),
  photo_url: z.string().nullish(),
  status_attendance: z.enum(['hadir', 'izin', 'sakit', 'alpa', 'libur']).default('hadir'),
  verification_status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
})
const scoreSchema = S.pklAssessmentScoreSchema.extend({
  score_school: z.number().min(0).max(100).nullish(),
  score_industry: z.number().min(0).max(100).nullish(),
})
const certificateSchema = S.pklCertificateSchema.extend({
  issued_date: z.iso.date().nullish(),
  status: z.enum(['draft', 'issued', 'revoked']).default('draft'),
  final_score: z.number().min(0).max(100).nullish(),
  grade: z.string().nullish(),
  scan_pdf_url: z.string().nullish(),
})

export const pklResources = new Map<string, z.ZodObject>([
  ['academic_years', S.pklAcademicYearSchema.strict()],
  ['industries', industrySchema.strict()],
  ['students', studentSchema.strict()],
  ['supervisors', supervisorSchema.strict()],
  ['internships', internshipSchema.strict()],
  ['daily_journals', journalSchema.strict()],
  [
    'assessment_indicators',
    S.pklAssessmentIndicatorSchema.extend({ jurusan: z.string().nullish() }).strict(),
  ],
  ['assessment_scores', scoreSchema.strict()],
  ['certificates', certificateSchema.strict()],
  ['registrations', S.pklRegistrationSchema.strict()],
  ['applications', S.pklApplicationSchema.strict()],
  ['attendance', S.pklAttendanceSchema.strict()],
  ['monitoring', S.pklMonitoringSchema.strict()],
  ['documents', S.pklDocumentSchema.strict()],
  ['journal_comments', S.pklCommentSchema.strict()],
  ['status_history', S.pklHistorySchema.strict()],
  ['industry_accounts', S.pklIndustryAccountSchema.strict()],
  ['certificate_templates', S.pklCertificateTemplateSchema.strict()],
  ['roster', S.pklRosterSchema.strict()],
])
export function getPklResource(resource: string) {
  const schema = pklResources.get(resource)
  if (!schema) throw AppError.notFound('PKL resource')
  return schema
}
export const pklInputSchema = z.record(z.string(), z.json())
export type PklInput = z.infer<typeof pklInputSchema>
export type PklRow = PklInput & { id: string }

export const pklQuerySchema = z
  .object({
    id: z.uuid().optional(),
    ids: z
      .string()
      .transform((value) => value.split(','))
      .pipe(z.array(z.uuid()).min(1).max(100))
      .optional(),
    nis: z.string().trim().min(1).max(100).optional(),
    student_id: z.uuid().optional(),
    profile_id: z.uuid().optional(),
    internship_id: z.uuid().optional(),
    industry_id: z.uuid().optional(),
    academic_year_id: z.uuid().optional(),
    supervisor_id: z.uuid().optional(),
    registration_id: z.uuid().optional(),
    journal_id: z.uuid().optional(),
    indicator_id: z.uuid().optional(),
    jurusan: z.string().min(1).max(30).optional(),
    status: z.string().min(1).max(40).optional(),
    statuses: z
      .string()
      .transform((value) => value.split(','))
      .pipe(z.array(z.string().min(1).max(40)).min(1).max(10))
      .optional(),
    internship_statuses: z
      .string()
      .transform((value) => value.split(','))
      .pipe(
        z
          .array(z.enum(['pending', 'active', 'completed', 'cancelled', 'withdrawn']))
          .min(1)
          .max(5),
      )
      .optional(),
    date: z.iso.date().optional(),
    date_from: z.iso.date().optional(),
    date_to: z.iso.date().optional(),
    is_published: z.enum(['true', 'false']).optional(),
    is_active: z.enum(['true', 'false']).optional(),
    unlinked: z.enum(['true', 'false']).optional(),
    search: z.string().trim().min(2).max(100).optional(),
    sort: z
      .string()
      .regex(/^[a-z_]+$/)
      .default('created_at'),
    direction: z.enum(['asc', 'desc']).default('desc'),
    limit: z.coerce.number().int().min(1).max(100).default(100),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .strict()
export type PklQueryInput = z.input<typeof pklQuerySchema>
export type PklQuery = z.infer<typeof pklQuerySchema>
export interface PklList {
  resource: string
  query: PklQuery
  access: CmsSession
}
export interface PklMutation {
  resource: string
  action: 'create' | 'update' | 'delete'
  id?: string
  data: PklInput
  access: CmsSession
}
export interface PklTransition {
  id: string
  expected_status: S.RegistrationStatus
  status: S.RegistrationStatus
  notes?: string
  industry_id?: string
  access: CmsSession
}
export function validatePklQuery(resource: string, input: PklQueryInput): PklQuery {
  const parsed = pklQuerySchema.safeParse(input)
  if (!parsed.success) throw AppError.validationError(parsed.error.flatten())
  const columns = new Set([
    'id',
    'created_at',
    'updated_at',
    ...getPklResource(resource).keyof().options,
  ])
  if (resource === 'status_history') columns.add('changed_at')
  if (resource === 'applications' || resource === 'registrations') columns.add('status')
  if (!columns.has(parsed.data.sort)) throw AppError.validationError('Unsupported PKL sort field.')
  for (const key of [
    'nis',
    'student_id',
    'profile_id',
    'internship_id',
    'industry_id',
    'academic_year_id',
    'supervisor_id',
    'registration_id',
    'journal_id',
    'indicator_id',
    'jurusan',
    'status',
    'date',
    'is_published',
    'is_active',
  ] as const) {
    if (
      parsed.data[key] !== undefined &&
      !columns.has(key) &&
      !(
        pklInternshipResources.has(resource) &&
        ['student_id', 'industry_id', 'academic_year_id', 'supervisor_id'].includes(key)
      )
    )
      throw AppError.validationError('Unsupported PKL filter.')
  }
  if (parsed.data.internship_statuses && !pklInternshipResources.has(resource))
    throw AppError.validationError('Resource has no internship filter.')
  if (parsed.data.statuses && !columns.has('status'))
    throw AppError.validationError('Resource has no status filter.')
  if ((parsed.data.date_from || parsed.data.date_to) && !columns.has('date'))
    throw AppError.validationError('Resource has no date filter.')
  if (parsed.data.unlinked !== undefined && !columns.has('profile_id'))
    throw AppError.validationError('Resource has no profile binding.')
  if (parsed.data.search && !columns.has('name'))
    throw AppError.validationError('Resource is not searchable.')
  return parsed.data
}
export function preparePklWrite(params: PklMutation): PklInput {
  if (params.action === 'delete') return {}
  const schema = getPklResource(params.resource)
  const input = { ...params.data }
  for (const key of Object.keys(input)) {
    if (
      input[key] === '' &&
      (key.endsWith('_id') ||
        key.endsWith('_date') ||
        key === 'date' ||
        key === 'start_date_preferred' ||
        key === 'partnership_since')
    )
      input[key] = null
  }
  const result = (params.action === 'create' ? schema : schema.partial()).safeParse(input)
  if (!result.success) throw AppError.validationError(result.error.flatten())
  const data = pklInputSchema.parse(result.data)
  if (params.action === 'update')
    for (const key of Object.keys(data)) if (!Object.hasOwn(input, key)) delete data[key]
  if (!Object.keys(data).length) throw AppError.validationError('Empty PKL mutation.')
  return data
}

const pklMetadataFields = new Map([
  [
    'registrations',
    [
      'status',
      'accepted_industry_id',
      'accepted_at',
      'accepted_by',
      'reviewed_by',
      'reviewed_at',
      'review_notes',
      'rejection_reason',
    ],
  ],
  ['applications', ['status', 'reviewed_by', 'reviewed_at', 'review_notes']],
  ['documents', ['uploaded_by']],
  ['daily_journals', ['created_by']],
  ['assessment_scores', ['score', 'assessor_type']],
  ['attendance', ['created_by', 'check_in_at', 'check_out_at']],
  ['certificates', ['validation_code', 'email_sent_at', 'email_message_id', 'scan_uploaded_at']],
  ['journal_comments', ['commenter_id', 'commenter_role']],
  [
    'status_history',
    ['from_status', 'to_status', 'changed_by', 'changed_by_role', 'notes', 'changed_at'],
  ],
])

export function pklReadFields(resource: string): string[] {
  return [
    'id',
    'created_at',
    'updated_at',
    ...getPklResource(resource).keyof().options,
    ...(pklMetadataFields.get(resource) ?? []),
  ]
}
export function projectPklRecord(resource: string, row: PklRow): PklRow {
  const result: PklRow = { id: row.id }
  for (const field of pklReadFields(resource))
    if (row[field] !== undefined) result[field] = row[field]
  return result
}

export function completePklWrite(
  params: PklMutation,
  data: PklInput,
  before: PklRow | null,
  indicator: PklRow | null = null,
) {
  if (params.resource === 'certificates' && params.action === 'create')
    data.validation_code = randomUUID()
  if (params.resource === 'daily_journals') {
    if (params.action === 'create') data.created_by = params.access.id
    if (data.status !== undefined)
      data.verification_status =
        data.status === 'approved'
          ? 'approved'
          : ['rejected', 'revision'].includes(String(data.status))
            ? 'rejected'
            : 'pending'
  }
  if (params.resource === 'documents' && params.action === 'create')
    data.uploaded_by = params.access.id
  if (params.resource === 'journal_comments') {
    data.commenter_id = params.access.id
    data.commenter_role = params.access.role
  }
  if (params.resource === 'assessment_scores') {
    for (const [canonical, alias] of [
      ['score_school', 'supervisor_score'],
      ['score_industry', 'industry_score'],
    ] as const) {
      if (
        data[canonical] !== undefined &&
        data[alias] !== undefined &&
        data[canonical] !== data[alias]
      )
        throw AppError.validationError('Conflicting score aliases.')
      if (data[canonical] !== undefined) data[alias] = data[canonical]
      else if (data[alias] !== undefined) data[canonical] = data[alias]
    }
    const school = z
      .number()
      .safeParse(Object.hasOwn(data, 'score_school') ? data.score_school : before?.score_school)
    const industry = z
      .number()
      .safeParse(
        Object.hasOwn(data, 'score_industry') ? data.score_industry : before?.score_industry,
      )
    if (!indicator) throw AppError.notFound('Assessment indicator')
    const final = calculateIndicatorFinalScore(
      String(indicator.category),
      industry.success ? industry.data : null,
      school.success ? school.data : null,
    )
    data.final_score = final === null ? null : Math.round(final * 100) / 100
    data.score = data.final_score
    data.assessor_type = ['industri', 'pembimbing_industri'].includes(params.access.role)
      ? 'industry'
      : 'school'
  }
}

export const pklRelatedResources = new Map([
  ['siswa_id', 'roster'],
  ['academic_year_id', 'academic_years'],
  ['student_id', 'students'],
  ['industry_id', 'industries'],
  ['supervisor_id', 'supervisors'],
  ['supervisor_guru_id', 'supervisors'],
  ['internship_id', 'internships'],
  ['indicator_id', 'assessment_indicators'],
  ['registration_id', 'registrations'],
  ['journal_id', 'daily_journals'],
])
export const pklUniqueFields = new Map<string, string[][]>([
  ['students', [['nis'], ['profile_id']]],
  ['supervisors', [['profile_id']]],
  ['roster', [['nis']]],
  ['internships', [['student_id', 'academic_year_id']]],
  ['assessment_scores', [['internship_id', 'indicator_id']]],
  ['attendance', [['student_id', 'date']]],
  ['industry_accounts', [['industry_id', 'profile_id']]],
  ['certificates', [['certificate_number']]],
])

export interface PklImport {
  resource: string
  rows: PklInput[]
  access: CmsSession
}

export const pklInternshipResources = new Set([
  'daily_journals',
  'assessment_scores',
  'certificates',
  'attendance',
  'monitoring',
  'documents',
])

export interface PklSupervisorAssignment {
  id: string
  supervisor_id: string
  access: CmsSession
}
