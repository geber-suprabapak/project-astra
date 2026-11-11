import type { Sql, TransactionSql } from 'postgres'
import {
  canReadAllPkl,
  pklIndustryRoles,
  pklRosterRoles,
  pklTeacherRoles,
} from '../../modules/pkl/policy.js'
import { getPklResource, type PklList } from '../../modules/pkl/resources.js'
import type { CmsSession } from '../../modules/cms/schema.js'
import { cmsJurusanAliases } from '../../modules/cms/content.js'

type Query = Sql | TransactionSql
function industryOwned(sql: Query, column: string, access: CmsSession) {
  return sql`EXISTS (SELECT 1 FROM pkl.industries binding_industry WHERE binding_industry.id = ${sql(column)} AND binding_industry.deleted_at IS NULL AND (
    binding_industry.profile_id = ${access.id} OR EXISTS (SELECT 1 FROM pkl.industry_accounts binding_account WHERE binding_account.industry_id = binding_industry.id AND binding_account.profile_id = ${access.id} AND binding_account.access_enabled = true AND binding_account.deleted_at IS NULL)))`
}
export function internshipScope(sql: Query, alias: string, access: CmsSession) {
  if (canReadAllPkl(access)) return sql`true`
  if (access.role === 'siswa')
    return sql`EXISTS (SELECT 1 FROM pkl.students binding_student WHERE binding_student.id = ${sql(alias + '.student_id')} AND binding_student.profile_id = ${access.id} AND binding_student.deleted_at IS NULL)`
  if (pklTeacherRoles.has(access.role))
    return sql`EXISTS (SELECT 1 FROM pkl.supervisors binding_supervisor WHERE binding_supervisor.profile_id = ${access.id} AND binding_supervisor.deleted_at IS NULL AND (binding_supervisor.id = ${sql(alias + '.supervisor_id')} OR binding_supervisor.id = ${sql(alias + '.supervisor_guru_id')}))`
  if (pklIndustryRoles.has(access.role)) return industryOwned(sql, alias + '.industry_id', access)
  return sql`false`
}
function registrationScope(sql: Query, alias: string, access: CmsSession) {
  if (canReadAllPkl(access)) return sql`true`
  const ownStudent =
    access.role === 'siswa'
      ? sql`EXISTS (SELECT 1 FROM pkl.students binding_student WHERE binding_student.id = ${sql(alias + '.student_id')} AND binding_student.profile_id = ${access.id} AND binding_student.deleted_at IS NULL)`
      : sql`false`
  const teacher = pklTeacherRoles.has(access.role)
    ? sql`EXISTS (SELECT 1 FROM pkl.internships related_internship WHERE related_internship.student_id = ${sql(alias + '.student_id')} AND related_internship.academic_year_id = ${sql(alias + '.academic_year_id')} AND related_internship.deleted_at IS NULL AND ${internshipScope(sql, 'related_internship', access)})`
    : sql`false`
  const industry = pklIndustryRoles.has(access.role)
    ? sql`(${industryOwned(sql, alias + '.industry_id', access)} OR ${industryOwned(sql, alias + '.accepted_industry_id', access)})`
    : sql`false`
  return sql`(${ownStudent} OR ${teacher} OR ${industry})`
}
function linkedInternship(sql: Query, column: string, access: CmsSession) {
  return sql`EXISTS (SELECT 1 FROM pkl.internships scoped_internship WHERE scoped_internship.id = ${sql(column)} AND scoped_internship.deleted_at IS NULL AND ${internshipScope(sql, 'scoped_internship', access)})`
}
export function pklScope(sql: Query, resource: string, access: CmsSession) {
  if (resource === 'roster') return pklRosterRoles.has(access.role) ? sql`true` : sql`false`
  if (resource === 'industry_accounts')
    return canReadAllPkl(access) ? sql`true` : sql`content.profile_id = ${access.id}`
  if (canReadAllPkl(access)) return sql`true`
  switch (resource) {
    case 'academic_years':
    case 'assessment_indicators':
      return sql`content.is_published = true`
    case 'industries':
      return sql`(content.is_published = true OR ${industryOwned(sql, 'content.id', access)})`
    case 'supervisors':
      return sql`(content.is_published = true OR content.profile_id = ${access.id})`
    case 'certificate_templates':
      return sql`content.is_active = true`
    case 'internships':
      return internshipScope(sql, 'content', access)
    case 'students':
      return sql`(content.profile_id = ${access.id} OR EXISTS (SELECT 1 FROM pkl.internships related_internship WHERE related_internship.student_id = content.id AND related_internship.deleted_at IS NULL AND ${internshipScope(sql, 'related_internship', access)}) OR EXISTS (SELECT 1 FROM pkl.registrations related_registration WHERE related_registration.student_id = content.id AND related_registration.deleted_at IS NULL AND ${registrationScope(sql, 'related_registration', access)}))`
    case 'registrations':
      return registrationScope(sql, 'content', access)
    case 'applications':
      return sql`EXISTS (SELECT 1 FROM pkl.students binding_student WHERE binding_student.id = content.student_id AND binding_student.profile_id = ${access.id} AND binding_student.deleted_at IS NULL)`
    case 'daily_journals':
    case 'assessment_scores':
    case 'certificates':
    case 'attendance':
    case 'monitoring':
      return linkedInternship(sql, 'content.internship_id', access)
    case 'status_history':
      return sql`EXISTS (SELECT 1 FROM pkl.registrations scoped_registration WHERE scoped_registration.id = content.registration_id AND scoped_registration.deleted_at IS NULL AND ${registrationScope(sql, 'scoped_registration', access)})`
    case 'journal_comments':
      return sql`EXISTS (SELECT 1 FROM pkl.daily_journals scoped_journal WHERE scoped_journal.id = content.journal_id AND scoped_journal.deleted_at IS NULL AND ${linkedInternship(sql, 'scoped_journal.internship_id', access)})`
    case 'documents':
      return sql`(EXISTS (SELECT 1 FROM pkl.students binding_student WHERE binding_student.id = content.student_id AND binding_student.profile_id = ${access.id} AND binding_student.deleted_at IS NULL) OR (content.internship_id IS NOT NULL AND ${linkedInternship(sql, 'content.internship_id', access)}) OR (content.registration_id IS NOT NULL AND EXISTS (SELECT 1 FROM pkl.registrations scoped_registration WHERE scoped_registration.id = content.registration_id AND scoped_registration.deleted_at IS NULL AND ${registrationScope(sql, 'scoped_registration', access)})))`
    default:
      return sql`false`
  }
}
export function pklWhere(sql: Query, params: PklList) {
  getPklResource(params.resource)
  let condition = sql`content.deleted_at IS NULL AND ${pklScope(sql, params.resource, params.access)}`
  const query = params.query
  if (query.id) condition = sql`${condition} AND content.id = ${query.id}`
  if (query.ids) condition = sql`${condition} AND content.id = ANY(${query.ids}::uuid[])`
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
    'status',
    'date',
  ] as const) {
    if (query[key] === undefined) continue
    if (
      ['student_id', 'industry_id', 'academic_year_id', 'supervisor_id'].includes(key) &&
      !getPklResource(params.resource).keyof().options.includes(key)
    ) {
      const matches =
        key === 'supervisor_id'
          ? sql`(filtered_internship.supervisor_id = ${query[key]!} OR filtered_internship.supervisor_guru_id = ${query[key]!})`
          : sql`${sql('filtered_internship.' + key)} = ${query[key]!}`
      condition = sql`${condition} AND EXISTS (SELECT 1 FROM pkl.internships filtered_internship WHERE filtered_internship.id = content.internship_id AND filtered_internship.deleted_at IS NULL AND ${matches})`
    } else condition = sql`${condition} AND ${sql('content.' + key)} = ${query[key]!}`
  }
  for (const key of ['is_published', 'is_active'] as const)
    if (query[key] !== undefined)
      condition = sql`${condition} AND ${sql('content.' + key)} = ${query[key] === 'true'}`
  if (query.internship_statuses)
    condition = sql`${condition} AND EXISTS (SELECT 1 FROM pkl.internships status_internship WHERE status_internship.id = content.internship_id AND status_internship.deleted_at IS NULL AND status_internship.status = ANY(${query.internship_statuses}::text[]))`
  if (query.statuses)
    condition = sql`${condition} AND content.status = ANY(${query.statuses}::text[])`
  if (query.jurusan)
    condition = sql`${condition} AND lower(content.jurusan) = ANY(${cmsJurusanAliases(query.jurusan)}::text[])`
  if (query.unlinked)
    condition =
      query.unlinked === 'true'
        ? sql`${condition} AND content.profile_id IS NULL`
        : sql`${condition} AND content.profile_id IS NOT NULL`
  if (query.date_from) condition = sql`${condition} AND content.date >= ${query.date_from}`
  if (query.date_to) condition = sql`${condition} AND content.date <= ${query.date_to}`
  if (query.search) {
    const term =
      '%' +
      query.search.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_') +
      '%'
    const hasNis = getPklResource(params.resource).keyof().options.includes('nis')
    condition = hasNis
      ? sql`${condition} AND (content.name ILIKE ${term} OR content.nis ILIKE ${term})`
      : sql`${condition} AND content.name ILIKE ${term}`
  }
  return condition
}
