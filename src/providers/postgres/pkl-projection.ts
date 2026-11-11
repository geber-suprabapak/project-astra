import type { Sql, TransactionSql } from 'postgres'
import { cmsPublicFields } from '../../modules/cms/content.js'
import { canManagePkl } from '../../modules/pkl/policy.js'
import { pklReadFields } from '../../modules/pkl/resources.js'
import type { CmsSession } from '../../modules/cms/schema.js'

type Query = Sql | TransactionSql
export function pklProjection(
  sql: Query,
  resource: string,
  alias: string,
  access: CmsSession,
  relations = true,
) {
  const fields = pklReadFields(resource).filter(
    (field) => resource !== 'industries' || canManagePkl(access) || field !== 'partnership_history',
  )
  let projection = sql`(SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(${sql(alias)}.*)) WHERE key = ANY(${fields}::text[]))`
  if (resource === 'industries')
    projection = sql`${projection} || jsonb_build_object('active_students_count', (SELECT count(*) FROM pkl.internships industry_internship WHERE industry_internship.industry_id = ${sql(alias + '.id')} AND industry_internship.status = 'active' AND industry_internship.deleted_at IS NULL))`
  if (resource === 'supervisors') {
    const fields = cmsPublicFields('guru_staff')
    if (canManagePkl(access)) fields.push('nip')
    projection = sql`${projection} || jsonb_build_object('guru_staff', (SELECT (SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(staff.*)) WHERE key = ANY(${fields}::text[])) FROM cms.guru_staff AS staff WHERE staff.id = ${sql(alias + '.guru_staff_id')}))`
  }
  if (!relations) return projection
  const nested = (target: string, key: string, foreignKey: string, includeRelations = false) => {
    const nestedAlias = 'relation_' + key
    const record = pklProjection(sql, target, nestedAlias, access, includeRelations)
    projection = sql`${projection} || jsonb_build_object(${key}::text, (SELECT ${record} FROM ${sql('pkl.' + target)} AS ${sql(nestedAlias)} WHERE ${sql(nestedAlias + '.id')} = ${sql(alias + '.' + foreignKey)} AND ${sql(nestedAlias + '.deleted_at')} IS NULL))`
  }
  if (['internships', 'registrations', 'applications'].includes(resource)) {
    nested('students', 'student', 'student_id')
    nested('industries', 'industry', 'industry_id')
    nested('academic_years', 'academic_year', 'academic_year_id')
  }
  if (resource === 'internships') {
    const score = pklProjection(sql, 'assessment_scores', 'assessment', access, false)
    const indicator = pklProjection(sql, 'assessment_indicators', 'indicator', access, false)
    projection = sql`${projection} || jsonb_build_object('scores', (SELECT COALESCE(jsonb_agg(${score} || jsonb_build_object('indicator', ${indicator}) ORDER BY assessment.indicator_id, assessment.id), '[]'::jsonb) FROM pkl.assessment_scores assessment JOIN pkl.assessment_indicators indicator ON indicator.id = assessment.indicator_id AND indicator.deleted_at IS NULL WHERE assessment.internship_id = ${sql(alias + '.id')} AND assessment.deleted_at IS NULL))`
  }
  if (resource === 'internships') {
    nested('supervisors', 'supervisor', 'supervisor_id')
    nested('supervisors', 'supervisor_guru', 'supervisor_guru_id')
  }
  if (resource === 'registrations')
    nested('industries', 'accepted_industry', 'accepted_industry_id')
  if (
    [
      'daily_journals',
      'assessment_scores',
      'certificates',
      'attendance',
      'monitoring',
      'documents',
    ].includes(resource)
  )
    nested('internships', 'internship', 'internship_id', true)
  if (resource === 'assessment_scores') nested('assessment_indicators', 'indicator', 'indicator_id')
  if (resource === 'monitoring') nested('supervisors', 'supervisor', 'supervisor_id')
  if (['attendance', 'documents'].includes(resource)) nested('students', 'student', 'student_id')
  return projection
}
