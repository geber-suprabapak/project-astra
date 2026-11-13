import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { AppError } from '../../lib/errors/app-error.js'
import { cmsJurusanAliases } from '../../modules/cms/content.js'
import {
  authorizePklMutation,
  authorizePklTransition,
  canManagePkl,
  pklRosterRoles,
} from '../../modules/pkl/policy.js'
import {
  completePklWrite,
  getPklResource,
  pklRelatedResources,
  pklUniqueFields,
  preparePklWrite,
  type PklImport,
  type PklInput,
  type PklList,
  type PklMutation,
  type PklRow,
  type PklTransition,
} from '../../modules/pkl/resources.js'
import { assertMemoryCmsAuthority } from './cms-authority.js'
import { recordMemoryCheckIn } from './pkl-attendance.js'
import {
  activeRows,
  appendHistory,
  bindingsFor,
  projection,
  record,
  save,
  visible,
  type MemoryPklState,
} from './pkl-state.js'

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
