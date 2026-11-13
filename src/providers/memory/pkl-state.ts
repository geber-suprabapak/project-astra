import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { cmsPublicFields } from '../../modules/cms/content.js'
import type { CmsProfile, CmsSession } from '../../modules/cms/schema.js'
import {
  canManagePkl,
  canReadAllPkl,
  canReadPklInternship,
  pklIndustryRoles,
  pklRosterRoles,
  pklTeacherRoles,
  type PklBindings,
} from '../../modules/pkl/policy.js'
import { projectPklRecord, type PklInput, type PklRow } from '../../modules/pkl/resources.js'

export interface MemoryPklState {
  cmsContent: Map<string, Map<string, PklRow>>
  cmsProfiles: Map<string, CmsProfile>
  pklRecords: Map<string, Map<string, PklRow>>
  pklAudit: {
    actor_id: string
    actor_role: string
    resource: string
    action: string
    before: PklRow | null
    after: PklRow | null
  }[]
}

export const keyOf = (value: PklInput[string] | undefined) => z.string().safeParse(value).data

export const activeRows = (store: MemoryPklState, resource: string) =>
  [...(store.pklRecords.get(resource)?.values() ?? [])].filter((row) => !row.deleted_at)

export function record(
  store: MemoryPklState,
  resource: string,
  id: PklInput[string] | undefined,
): PklRow | null {
  const key = keyOf(id),
    row = key ? store.pklRecords.get(resource)?.get(key) : null
  return row && !row.deleted_at ? row : null
}

export function bindingsFor(store: MemoryPklState, access: CmsSession): PklBindings {
  const accounts = activeRows(store, 'industry_accounts').filter(
    (row) => row.profile_id === access.id && row.access_enabled === true,
  )
  return {
    studentId:
      activeRows(store, 'students').find((row) => row.profile_id === access.id)?.id ?? null,
    supervisorIds: activeRows(store, 'supervisors')
      .filter((row) => row.profile_id === access.id)
      .map((row) => row.id),
    industryIds: activeRows(store, 'industries')
      .filter(
        (row) =>
          row.profile_id === access.id ||
          accounts.some((account) => account.industry_id === row.id),
      )
      .map((row) => row.id),
  }
}

export function registrationVisible(
  store: MemoryPklState,
  row: PklRow,
  access: CmsSession,
  bindings: PklBindings,
) {
  if (canReadAllPkl(access)) return true
  if (access.role === 'siswa')
    return bindings.studentId !== null && row.student_id === bindings.studentId
  if (pklIndustryRoles.has(access.role))
    return bindings.industryIds.some(
      (id) => row.industry_id === id || row.accepted_industry_id === id,
    )
  return (
    pklTeacherRoles.has(access.role) &&
    activeRows(store, 'internships').some(
      (internship) =>
        internship.student_id === row.student_id &&
        internship.academic_year_id === row.academic_year_id &&
        canReadPklInternship(internship, access, bindings),
    )
  )
}

export function visible(
  store: MemoryPklState,
  resource: string,
  row: PklRow,
  access: CmsSession,
  bindings: PklBindings,
): boolean {
  if (resource === 'roster') return pklRosterRoles.has(access.role)
  if (canReadAllPkl(access)) return true
  const internshipVisible = (id: PklInput[string] | undefined) => {
    const internship = record(store, 'internships', id)
    return !!internship && canReadPklInternship(internship, access, bindings)
  }
  switch (resource) {
    case 'academic_years':
    case 'assessment_indicators':
      return row.is_published === true
    case 'industries':
      return row.is_published === true || bindings.industryIds.includes(row.id)
    case 'supervisors':
      return row.is_published === true || row.profile_id === access.id
    case 'certificate_templates':
      return row.is_active === true
    case 'industry_accounts':
      return row.profile_id === access.id
    case 'internships':
      return canReadPklInternship(row, access, bindings)
    case 'students':
      return (
        row.profile_id === access.id ||
        activeRows(store, 'internships').some(
          (internship) =>
            internship.student_id === row.id && canReadPklInternship(internship, access, bindings),
        ) ||
        activeRows(store, 'registrations').some(
          (registration) =>
            registration.student_id === row.id &&
            registrationVisible(store, registration, access, bindings),
        )
      )
    case 'registrations':
      return registrationVisible(store, row, access, bindings)
    case 'applications':
      return (
        bindings.studentId !== null &&
        row.student_id === bindings.studentId &&
        access.role === 'siswa'
      )
    case 'daily_journals':
    case 'assessment_scores':
    case 'certificates':
    case 'attendance':
    case 'monitoring':
      return internshipVisible(row.internship_id)
    case 'status_history': {
      const registration = record(store, 'registrations', row.registration_id)
      return !!registration && registrationVisible(store, registration, access, bindings)
    }
    case 'journal_comments': {
      const journal = record(store, 'daily_journals', row.journal_id)
      return !!journal && internshipVisible(journal.internship_id)
    }
    case 'documents': {
      const registration = record(store, 'registrations', row.registration_id)
      return (
        (bindings.studentId !== null &&
          access.role === 'siswa' &&
          row.student_id === bindings.studentId) ||
        internshipVisible(row.internship_id) ||
        (!!registration && registrationVisible(store, registration, access, bindings))
      )
    }
    default:
      return false
  }
}

export function projection(
  store: MemoryPklState,
  resource: string,
  row: PklRow,
  access: CmsSession,
  relations = true,
): PklRow {
  const result = projectPklRecord(resource, row)
  if (resource === 'industries') {
    if (!canManagePkl(access)) delete result.partnership_history
    result.active_students_count = activeRows(store, 'internships').filter(
      (internship) => internship.industry_id === row.id && internship.status === 'active',
    ).length
  }
  if (resource === 'supervisors') {
    const id = keyOf(row.guru_staff_id),
      staff = id ? store.cmsContent.get('guru_staff')?.get(id) : null
    const fields = cmsPublicFields('guru_staff')
    if (canManagePkl(access)) fields.push('nip')
    result.guru_staff = staff
      ? Object.fromEntries(Object.entries(staff).filter(([key]) => fields.includes(key)))
      : null
  }
  if (!relations) return result
  const nested = (target: string, key: string, foreignKey: string, includeRelations = false) => {
    const related = record(store, target, row[foreignKey])
    result[key] = related ? projection(store, target, related, access, includeRelations) : null
  }
  if (['internships', 'registrations', 'applications'].includes(resource)) {
    nested('students', 'student', 'student_id')
    nested('industries', 'industry', 'industry_id')
    nested('academic_years', 'academic_year', 'academic_year_id')
  }
  if (resource === 'internships') {
    result.scores = activeRows(store, 'assessment_scores')
      .filter(
        (score) =>
          score.internship_id === row.id &&
          record(store, 'assessment_indicators', score.indicator_id),
      )
      .sort(
        (a, b) =>
          String(a.indicator_id).localeCompare(String(b.indicator_id)) || a.id.localeCompare(b.id),
      )
      .map((score) => ({
        ...projection(store, 'assessment_scores', score, access, false),
        indicator: projection(
          store,
          'assessment_indicators',
          record(store, 'assessment_indicators', score.indicator_id)!,
          access,
          false,
        ),
      }))
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
  return result
}

export function save(store: MemoryPklState, resource: string, row: PklRow) {
  let table = store.pklRecords.get(resource)
  if (!table) {
    table = new Map()
    store.pklRecords.set(resource, table)
  }
  table.set(row.id, row)
}

export function appendHistory(
  store: MemoryPklState,
  registration: PklRow,
  from: PklInput[string],
  access: CmsSession,
  notes: string | null,
) {
  const now = new Date().toISOString()
  save(store, 'status_history', {
    id: randomUUID(),
    registration_id: registration.id,
    from_status: from,
    to_status: registration.status!,
    changed_by: access.id,
    changed_by_role: access.role,
    notes,
    changed_at: now,
    created_at: now,
    updated_at: now,
  })
}
