import type { PklSupervisorAssignment } from '../../modules/pkl/resources.js'
import {
  certificateCodeSchema,
  certificateVerificationSchema,
  type CertificateVerification,
} from '../../modules/pkl/certificates.js'
import {
  applicableAssessmentIndicators,
  assessmentMutation,
  assessmentTotals,
  parseAssessment,
  type PklAssessment,
} from '../../modules/pkl/assessment-command.js'
import { pklSchoolDate, type PklCheckIn, type PklCheckOut } from '../../modules/pkl/attendance.js'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { AppError } from '../../lib/errors/app-error.js'
import { assertMemoryCmsAuthority } from './cms-authority.js'
import { cmsJurusanAliases, cmsPublicFields } from '../../modules/cms/content.js'
import {
  authorizePklMutation,
  authorizePklTransition,
  canManagePkl,
  canAssessPklInternship,
  canReadAllPkl,
  canReadPklInternship,
  pklIndustryRoles,
  pklRosterRoles,
  pklTeacherRoles,
  type PklBindings,
} from '../../modules/pkl/policy.js'
import {
  completePklWrite,
  getPklResource,
  pklRelatedResources,
  pklUniqueFields,
  preparePklWrite,
  projectPklRecord,
  type PklInput,
  type PklImport,
  type PklList,
  type PklMutation,
  type PklRow,
  type PklTransition,
} from '../../modules/pkl/resources.js'
import type { CmsProfile, CmsSession } from '../../modules/cms/schema.js'

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
const keyOf = (value: PklInput[string] | undefined) => z.string().safeParse(value).data
const activeRows = (store: MemoryPklState, resource: string) =>
  [...(store.pklRecords.get(resource)?.values() ?? [])].filter((row) => !row.deleted_at)
function record(
  store: MemoryPklState,
  resource: string,
  id: PklInput[string] | undefined,
): PklRow | null {
  const key = keyOf(id),
    row = key ? store.pklRecords.get(resource)?.get(key) : null
  return row && !row.deleted_at ? row : null
}
function bindingsFor(store: MemoryPklState, access: CmsSession): PklBindings {
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
function registrationVisible(
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
function visible(
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
function projection(
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
  return result
}
export function listMemoryPklRecords(store: MemoryPklState, params: PklList): PklRow[] {
  assertMemoryCmsAuthority(store, params.access)
  const bindings = bindingsFor(store, params.access),
    query = params.query
  const rows = activeRows(store, params.resource).filter((row) => {
    if (!visible(store, params.resource, row, params.access, bindings)) return false
    if ((query.id && row.id !== query.id) || (query.ids && !query.ids.includes(row.id)))
      return false
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
    ] as const)
      if (query[key] !== undefined && row[key] !== query[key]) {
        if (
          !['student_id', 'industry_id', 'academic_year_id', 'supervisor_id'].includes(key) ||
          getPklResource(params.resource).keyof().options.includes(key)
        )
          return false
        const parent = record(store, 'internships', row.internship_id)
        if (
          !parent ||
          (parent[key] !== query[key] &&
            !(key === 'supervisor_id' && parent.supervisor_guru_id === query[key]))
        )
          return false
      }
    for (const key of ['is_published', 'is_active'] as const)
      if (query[key] !== undefined && row[key] !== (query[key] === 'true')) return false
    if (
      query.jurusan &&
      !cmsJurusanAliases(query.jurusan).includes(String(row.jurusan).toLowerCase())
    )
      return false
    if (query.unlinked !== undefined && !row.profile_id !== (query.unlinked === 'true'))
      return false
    if (
      (query.date_from && String(row.date) < query.date_from) ||
      (query.date_to && String(row.date) > query.date_to)
    )
      return false
    if (
      query.search &&
      !String(row.name).toLowerCase().includes(query.search.toLowerCase()) &&
      !String(row.nis ?? '')
        .toLowerCase()
        .includes(query.search.toLowerCase())
    )
      return false
    return true
  })
  rows.sort((a, b) => {
    const left = a[query.sort],
      right = b[query.sort]
    if (left === null || left === undefined)
      return right === null || right === undefined ? a.id.localeCompare(b.id) : 1
    if (right === null || right === undefined) return -1
    const leftNumber = z.number().safeParse(left),
      rightNumber = z.number().safeParse(right)
    const order =
      leftNumber.success && rightNumber.success
        ? leftNumber.data - rightNumber.data
        : String(left).localeCompare(String(right))
    return (query.direction === 'desc' ? -order : order) || a.id.localeCompare(b.id)
  })
  return rows
    .slice(query.offset, query.offset + query.limit + 1)
    .map((row) => structuredClone(projection(store, params.resource, row, params.access)))
}
function save(store: MemoryPklState, resource: string, row: PklRow) {
  let table = store.pklRecords.get(resource)
  if (!table) {
    table = new Map()
    store.pklRecords.set(resource, table)
  }
  table.set(row.id, row)
}
function appendHistory(
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
export function mutateMemoryPklRecord(store: MemoryPklState, params: PklMutation): PklRow {
  assertMemoryCmsAuthority(store, params.access)
  const data = preparePklWrite(params),
    bindings = bindingsFor(store, params.access)
  const before = params.id ? record(store, params.resource, params.id) : null
  if (
    params.action !== 'create' &&
    (!before || !visible(store, params.resource, before, params.access, bindings))
  )
    throw AppError.notFound('PKL record')
  const merged: PklInput = { ...before, ...data }
  let internship = record(store, 'internships', merged.internship_id)
  if (params.resource === 'journal_comments') {
    const journal = record(store, 'daily_journals', merged.journal_id)
    internship = journal ? record(store, 'internships', journal.internship_id) : null
  }
  authorizePklMutation(params, data, bindings, before, internship)
  if (params.action !== 'delete') {
    for (const [field, target] of pklRelatedResources)
      if (merged[field] && !record(store, target, merged[field]))
        throw AppError.validationError('Related PKL record is unavailable.')
    for (const fields of pklUniqueFields.get(params.resource) ?? []) {
      if (fields.some((field) => merged[field] === null || merged[field] === undefined)) continue
      if (
        activeRows(store, params.resource).some(
          (row) => row.id !== before?.id && fields.every((field) => row[field] === merged[field]),
        )
      )
        throw AppError.conflict('PKL record already exists.')
    }
    if (internship && merged.student_id && merged.student_id !== internship.student_id)
      throw AppError.validationError('Student does not own the internship.')
    if (
      params.resource === 'documents' &&
      merged.registration_id &&
      record(store, 'registrations', merged.registration_id)?.student_id !== merged.student_id
    )
      throw AppError.validationError('Student does not own the registration.')
    if (data.profile_id) {
      const profile = [...store.cmsProfiles.values()].find((row) => row.id === data.profile_id)
      const roles =
        params.resource === 'students'
          ? ['siswa']
          : params.resource === 'supervisors'
            ? ['guru', 'pembimbing_sekolah', 'supervisor']
            : ['industri', 'pembimbing_industri', 'monitoring_sipkl']
      if (!profile || !roles.includes(profile.role))
        throw AppError.validationError('Profile role does not match the binding.')
    }
    if (merged.start_date && merged.end_date && String(merged.start_date) > String(merged.end_date))
      throw AppError.validationError('End date precedes start date.')
    let indicator: PklRow | null = null
    if (params.resource === 'assessment_scores') {
      indicator = record(store, 'assessment_indicators', merged.indicator_id)
      if (!indicator) throw AppError.notFound('Assessment indicator')
      for (const key of [
        'score_school',
        'supervisor_score',
        'score_industry',
        'industry_score',
      ] as const)
        if (
          merged[key] !== undefined &&
          merged[key] !== null &&
          z.number().parse(merged[key]) > z.number().parse(indicator.max_score)
        )
          throw AppError.validationError('Score exceeds indicator maximum.')
    }
    completePklWrite(params, data, before, indicator)
  }
  const now = new Date().toISOString()
  const row: PklRow = before
    ? { ...before, ...data, updated_at: now }
    : { ...data, id: randomUUID(), created_at: now, updated_at: now }
  if (params.action === 'create' && params.resource === 'registrations') row.status = 'BELUM_DAFTAR'
  if (params.action === 'create' && params.resource === 'applications') row.status = 'pending'
  if (params.action === 'delete') {
    if (params.resource === 'certificate_templates' && before!.is_active === true)
      throw AppError.conflict('Deactivate the template first.')
    row.deleted_at = now
  }
  if (params.resource === 'certificate_templates' && row.is_active === true)
    for (const template of activeRows(store, 'certificate_templates')) template.is_active = false
  if (
    params.resource === 'daily_journals' &&
    params.action === 'create' &&
    params.access.role === 'siswa' &&
    row.status !== 'draft'
  ) {
    const existing = activeRows(store, 'attendance').find(
      (attendance) =>
        attendance.student_id === internship!.student_id && attendance.date === row.date,
    )
    if (existing && existing.internship_id !== internship!.id)
      throw AppError.conflict('Attendance belongs to a different internship on this date.')
  }
  save(store, params.resource, row)
  store.pklAudit.push({
    actor_id: params.access.id,
    actor_role: params.access.role,
    resource: params.resource,
    action: params.action,
    before: before ? structuredClone(before) : null,
    after: params.action === 'delete' ? null : structuredClone(row),
  })
  if (
    params.resource === 'daily_journals' &&
    params.action === 'create' &&
    params.access.role === 'siswa' &&
    row.status !== 'draft'
  ) {
    recordMemoryCheckIn(
      store,
      params.access,
      internship!,
      String(internship!.student_id),
      String(row.date),
      {},
      'Hadir (otomatis dari pengisian jurnal harian)',
    )
  }
  if (params.resource === 'registrations' && params.action === 'create')
    appendHistory(store, row, null, params.access, 'Initial registration')
  return structuredClone(row)
}
export function transitionMemoryPklRegistration(
  store: MemoryPklState,
  params: PklTransition,
): PklRow {
  assertMemoryCmsAuthority(store, params.access)
  const before = record(store, 'registrations', params.id)
  if (!before) throw AppError.notFound('PKL registration')
  authorizePklTransition(params, before, bindingsFor(store, params.access))
  const row: PklRow = { ...before, status: params.status, updated_at: new Date().toISOString() }
  if (params.industry_id) {
    if (!canManagePkl(params.access) && params.access.role !== 'siswa') throw AppError.forbidden()
    if (!record(store, 'industries', params.industry_id)) throw AppError.notFound('PKL industry')
    row.industry_id = params.industry_id
  }
  if (params.status === 'MENUNGGU_INDUSTRI' && !row.industry_id)
    throw AppError.validationError('Choose an industry first.')
  if (params.status === 'MENCARI_INDUSTRI' || params.status === 'DITOLAK') {
    row.reviewed_by = params.access.id
    row.reviewed_at = row.updated_at!
    row.review_notes = params.notes ?? null
  }
  if (params.status === 'DITOLAK') {
    if (!params.notes?.trim()) throw AppError.validationError('Rejection reason is required.')
    row.rejection_reason = params.notes
  }
  if (params.status === 'DITERIMA') {
    if (!row.industry_id) throw AppError.validationError('Industry is required.')
    row.accepted_industry_id = row.industry_id
    row.accepted_by = params.access.id
    row.accepted_at = row.updated_at!
  }
  save(store, 'registrations', row)
  appendHistory(store, row, before.status ?? null, params.access, params.notes ?? null)
  store.pklAudit.push({
    actor_id: params.access.id,
    actor_role: params.access.role,
    resource: 'registrations',
    action: 'transition',
    before: structuredClone(before),
    after: structuredClone(row),
  })
  return structuredClone(row)
}

export function importMemoryPklRecords(store: MemoryPklState, params: PklImport): PklRow[] {
  if (
    !canManagePkl(params.access) &&
    !(params.resource === 'roster' && pklRosterRoles.has(params.access.role))
  )
    throw AppError.forbidden()
  const records = structuredClone(store.pklRecords),
    auditLength = store.pklAudit.length
  try {
    return params.rows.map((data) =>
      mutateMemoryPklRecord(store, {
        resource: params.resource,
        access: params.access,
        data,
        action: 'create',
      }),
    )
  } catch (error) {
    store.pklRecords = records
    store.pklAudit.length = auditLength
    throw error
  }
}

function recordMemoryCheckIn(
  store: MemoryPklState,
  access: CmsSession,
  internship: PklRow,
  studentId: string,
  date: string,
  location: { lat?: number; lng?: number; photo_url?: string },
  notes: string | null,
): PklRow {
  const before =
    activeRows(store, 'attendance').find(
      (row) => row.student_id === studentId && row.date === date,
    ) ?? null
  if (before && before.internship_id !== internship.id)
    throw AppError.conflict('Attendance belongs to a different internship on this date.')
  const now = new Date().toISOString()
  const row: PklRow = {
    ...before,
    id: before?.id ?? randomUUID(),
    internship_id: internship.id,
    student_id: studentId,
    date,
    status: 'HADIR',
    check_in_at: before?.check_in_at ?? now,
    created_by: before?.created_by ?? access.id,
    created_at: before?.created_at ?? now,
    updated_at: now,
  }
  if (notes !== null) row.notes = notes
  if (location.lat !== undefined && (row.check_in_lat === null || row.check_in_lat === undefined))
    row.check_in_lat = location.lat
  if (location.lng !== undefined && (row.check_in_lng === null || row.check_in_lng === undefined))
    row.check_in_lng = location.lng
  if (location.photo_url !== undefined && !row.photo_url) row.photo_url = location.photo_url
  save(store, 'attendance', row)
  store.pklAudit.push({
    actor_id: access.id,
    actor_role: access.role,
    resource: 'attendance',
    action: 'check_in',
    before: before ? structuredClone(before) : null,
    after: structuredClone(row),
  })
  return structuredClone(row)
}
export function checkInMemoryPkl(store: MemoryPklState, params: PklCheckIn): PklRow {
  assertMemoryCmsAuthority(store, params.access)
  if (params.access.role !== 'siswa') throw AppError.forbidden()
  const bindings = bindingsFor(store, params.access),
    internship = record(store, 'internships', params.internship_id)
  if (!internship || !bindings.studentId || internship.student_id !== bindings.studentId)
    throw AppError.forbidden()
  return recordMemoryCheckIn(
    store,
    params.access,
    internship,
    bindings.studentId,
    pklSchoolDate(),
    params,
    null,
  )
}
export function checkOutMemoryPkl(store: MemoryPklState, params: PklCheckOut): PklRow {
  assertMemoryCmsAuthority(store, params.access)
  const before = record(store, 'attendance', params.id),
    bindings = bindingsFor(store, params.access)
  if (
    params.access.role !== 'siswa' ||
    !before ||
    !bindings.studentId ||
    before.student_id !== bindings.studentId
  )
    throw AppError.forbidden()
  if (!before.check_in_at) throw AppError.conflict('Check in first.')
  if (before.date !== pklSchoolDate())
    throw AppError.conflict('Only current school-day attendance can be checked out.')
  const now = new Date().toISOString(),
    row: PklRow = { ...before, check_out_at: before.check_out_at ?? now, updated_at: now }
  if (params.lat !== undefined && !before.check_out_at) row.check_out_lat = params.lat
  if (params.lng !== undefined && !before.check_out_at) row.check_out_lng = params.lng
  save(store, 'attendance', row)
  store.pklAudit.push({
    actor_id: params.access.id,
    actor_role: params.access.role,
    resource: 'attendance',
    action: 'check_out',
    before: structuredClone(before),
    after: structuredClone(row),
  })
  return structuredClone(row)
}

export function saveMemoryPklAssessment(store: MemoryPklState, input: PklAssessment): PklRow {
  const params = parseAssessment(input)
  assertMemoryCmsAuthority(store, params.access)
  const before = record(store, 'internships', params.id)
  if (!before) throw AppError.notFound('PKL internship')
  if (!canAssessPklInternship(before, params.access, bindingsFor(store, params.access)))
    throw AppError.forbidden()
  const student = record(store, 'students', before.student_id)
  if (!student) throw AppError.notFound('PKL student')
  const applicable = applicableAssessmentIndicators(
    params,
    activeRows(store, 'assessment_indicators'),
    student,
  )
  const records = structuredClone(store.pklRecords),
    auditLength = store.pklAudit.length
  try {
    for (const score of params.scores) {
      const existing = activeRows(store, 'assessment_scores').find(
        (row) => row.internship_id === params.id && row.indicator_id === score.indicator_id,
      )
      mutateMemoryPklRecord(store, assessmentMutation(params, score, existing))
    }
    const totals = assessmentTotals(
      applicable,
      activeRows(store, 'assessment_scores').filter((row) => row.internship_id === params.id),
    )
    for (const [resource, rows] of new Map([
      ['internships', [before]],
      [
        'certificates',
        activeRows(store, 'certificates').filter((row) => row.internship_id === params.id),
      ],
    ])) {
      for (const row of rows) {
        const updated: PklRow = { ...row, ...totals, updated_at: new Date().toISOString() }
        if (resource === 'internships' && params.notes !== undefined) updated.notes = params.notes
        save(store, resource, updated)
        store.pklAudit.push({
          actor_id: params.access.id,
          actor_role: params.access.role,
          resource,
          action: 'assessment',
          before: structuredClone(row),
          after: structuredClone(updated),
        })
      }
    }
    return { id: params.id, saved: params.scores.length, ...totals }
  } catch (error) {
    store.pklRecords = records
    store.pklAudit.length = auditLength
    throw error
  }
}

export function verifyMemoryPklCertificate(
  store: MemoryPklState,
  code: string,
): CertificateVerification | null {
  if (!certificateCodeSchema.safeParse(code).success) return null
  const certificate = activeRows(store, 'certificates').find(
    (row) => row.validation_code === code && row.status === 'issued',
  )
  const internship = certificate ? record(store, 'internships', certificate.internship_id) : null
  const student = internship ? record(store, 'students', internship.student_id) : null
  const industry = internship ? record(store, 'industries', internship.industry_id) : null
  if (!certificate || !internship || !student || !industry) return null
  return certificateVerificationSchema.parse({
    id: certificate.id,
    certificate_number: certificate.certificate_number,
    issue_date: certificate.issue_date,
    final_score: certificate.final_score ?? null,
    grade: certificate.grade ?? null,
    internship: {
      start_date: internship.start_date ?? null,
      end_date: internship.end_date ?? null,
      student,
      industry: { ...industry, city: industry.city ?? null },
    },
  })
}

export function assignMemoryPklIndustrySupervisor(
  store: MemoryPklState,
  params: PklSupervisorAssignment,
): PklRow {
  assertMemoryCmsAuthority(store, params.access)
  if (!canManagePkl(params.access)) throw AppError.forbidden()
  const industry = record(store, 'industries', params.id)
  if (!industry || !record(store, 'supervisors', params.supervisor_id))
    throw AppError.notFound('PKL industry or supervisor')
  const updated = {
    ...industry,
    supervisor_id: params.supervisor_id,
    updated_at: new Date().toISOString(),
  }
  save(store, 'industries', updated)
  store.pklAudit.push({
    actor_id: params.access.id,
    actor_role: params.access.role,
    resource: 'industries',
    action: 'update',
    before: structuredClone(industry),
    after: structuredClone(updated),
  })
  for (const row of activeRows(store, 'internships').filter(
    (row) => row.industry_id === params.id && !row.supervisor_id && !row.supervisor_guru_id,
  )) {
    const changed = {
      ...row,
      supervisor_id: params.supervisor_id,
      supervisor_guru_id: params.supervisor_id,
      updated_at: new Date().toISOString(),
    }
    save(store, 'internships', changed)
    store.pklAudit.push({
      actor_id: params.access.id,
      actor_role: params.access.role,
      resource: 'internships',
      action: 'update',
      before: structuredClone(row),
      after: structuredClone(changed),
    })
  }
  return structuredClone(updated)
}
