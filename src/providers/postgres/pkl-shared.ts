import postgres, { type TransactionSql } from 'postgres'
import { z } from 'zod'
import { AppError } from '../../lib/errors/app-error.js'
import type { CmsSession } from '../../modules/cms/schema.js'
import type { PklBindings } from '../../modules/pkl/policy.js'
import {
  pklRelatedResources,
  type PklInput,
  type PklMutation,
  type PklRow,
} from '../../modules/pkl/resources.js'

export async function bindingsForPkl(tx: TransactionSql, access: CmsSession): Promise<PklBindings> {
  const students = await tx<
    { id: string }[]
  >`SELECT id FROM pkl.students WHERE profile_id = ${access.id} AND deleted_at IS NULL FOR SHARE`
  const supervisors = await tx<
    { id: string }[]
  >`SELECT id FROM pkl.supervisors WHERE profile_id = ${access.id} AND deleted_at IS NULL FOR SHARE`
  const industries = await tx<
    { id: string }[]
  >`SELECT id FROM pkl.industries AS industry WHERE industry.deleted_at IS NULL AND (industry.profile_id = ${access.id} OR EXISTS (SELECT 1 FROM pkl.industry_accounts AS account WHERE account.industry_id = industry.id AND account.profile_id = ${access.id} AND account.access_enabled = true AND account.deleted_at IS NULL)) FOR SHARE`
  return {
    studentId: students[0]?.id ?? null,
    supervisorIds: supervisors.map((row) => row.id),
    industryIds: industries.map((row) => row.id),
  }
}

export async function pklRecordById(
  tx: TransactionSql,
  resource: string,
  id: string,
  lock: 'share' | 'update' = 'share',
): Promise<PklRow> {
  const locking = lock === 'update' ? tx`FOR UPDATE` : tx`FOR SHARE`
  const rows = await tx<
    { data: PklRow }[]
  >`SELECT to_jsonb(record.*) AS data FROM ${tx('pkl.' + resource)} AS record WHERE record.id = ${id} AND record.deleted_at IS NULL ${locking}`
  if (!rows[0]) throw AppError.notFound('PKL record')
  return rows[0].data
}

export function asPklId(value: PklInput[string] | undefined) {
  const parsed = z.uuid().safeParse(value)
  if (!parsed.success) throw AppError.validationError('A valid related PKL ID is required.')
  return parsed.data
}

export async function parentPklInternship(
  tx: TransactionSql,
  params: PklMutation,
  merged: PklInput,
): Promise<PklRow | null> {
  if (
    [
      'daily_journals',
      'assessment_scores',
      'certificates',
      'attendance',
      'monitoring',
      'documents',
    ].includes(params.resource) &&
    merged.internship_id
  ) {
    return pklRecordById(tx, 'internships', asPklId(merged.internship_id))
  }
  if (params.resource === 'journal_comments') {
    const journal = await pklRecordById(tx, 'daily_journals', asPklId(merged.journal_id))
    return pklRecordById(tx, 'internships', asPklId(journal.internship_id))
  }
  return null
}

export async function auditPkl(
  tx: TransactionSql,
  access: CmsSession,
  resource: string,
  action: string,
  before: PklRow | null,
  after: PklRow | null,
) {
  const id = after?.id ?? before!.id
  await tx`INSERT INTO pkl.audit(actor_id,actor_role,resource,record_id,action,before_data,after_data) VALUES (${access.id},${access.role},${resource},${id},${action},${tx.json(before)},${tx.json(after)})`
}

export function translatePklError(error: postgres.PostgresError): never {
  if (error instanceof postgres.PostgresError) {
    if (['23505', '23503', '40001', '40P01'].includes(error.code)) {
      throw AppError.conflict('PKL record conflicts with existing data or changed concurrently.')
    }
    if (['22P02', '22007', '23514', '23502'].includes(error.code)) {
      throw AppError.validationError('PKL record does not satisfy the domain schema.')
    }
  }
  throw error
}

export async function validatePklRelationships(
  tx: TransactionSql,
  params: PklMutation,
  data: PklInput,
  merged: PklInput,
  internship: PklRow | null,
) {
  for (const [field, resource] of pklRelatedResources) {
    if (data[field]) await pklRecordById(tx, resource, asPklId(data[field]))
  }
  if (internship && merged.student_id && merged.student_id !== internship.student_id) {
    throw AppError.validationError('Student does not belong to the referenced internship.')
  }
  if (params.resource === 'documents' && merged.registration_id) {
    const registration = await pklRecordById(tx, 'registrations', asPklId(merged.registration_id))
    if (registration.student_id !== merged.student_id) {
      throw AppError.validationError('Student does not own the referenced registration.')
    }
  }
  if (data.profile_id) {
    const roles =
      params.resource === 'students'
        ? ['siswa']
        : params.resource === 'supervisors'
          ? ['guru', 'pembimbing_sekolah', 'supervisor']
          : ['industri', 'pembimbing_industri', 'monitoring_sipkl']
    const profiles = await tx<
      { role: string }[]
    >`SELECT role FROM cms.profiles WHERE id = ${asPklId(data.profile_id)} FOR SHARE`
    if (!profiles[0] || !roles.includes(profiles[0].role)) {
      throw AppError.validationError('Profile role does not match this PKL binding.')
    }
  }
  const start = z.iso.date().safeParse(merged.start_date)
  const end = z.iso.date().safeParse(merged.end_date)
  if (start.success && end.success && start.data > end.data) {
    throw AppError.validationError('End date must not precede start date.')
  }
  let indicator: PklRow | null = null
  if (params.resource === 'assessment_scores') {
    indicator = await pklRecordById(tx, 'assessment_indicators', asPklId(merged.indicator_id))
    const max = z.number().positive().parse(indicator.max_score)
    for (const key of [
      'score_school',
      'supervisor_score',
      'score_industry',
      'industry_score',
    ] as const) {
      if (
        merged[key] !== null &&
        merged[key] !== undefined &&
        z.number().parse(merged[key]) > max
      ) {
        throw AppError.validationError('Assessment exceeds the indicator maximum.')
      }
    }
  }
  return indicator
}
