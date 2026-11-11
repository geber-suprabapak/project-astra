import { AppError } from '../../lib/errors/app-error.js'
import type { CmsSession } from '../cms/schema.js'
import type { PklInput, PklMutation, PklRow, PklTransition } from './resources.js'
import type { RegistrationStatus } from './schema.js'

export const pklAdminRoles = new Set([
  'super_admin',
  'admin',
  'admin_hubin',
  'wks_4',
  'waka_hubin',
  'waka_humas',
  'waka_hubin_humas',
])
export const pklTeacherRoles = new Set(['guru', 'pembimbing_sekolah', 'supervisor'])
export const pklIndustryRoles = new Set(['industri', 'pembimbing_industri'])
export const pklReadAllRoles = new Set(['admin_monitoring', 'monitoring_sipkl'])
export const pklRosterRoles = new Set([...pklAdminRoles, 'waka_kesiswaan', 'wks_2'])
export interface PklBindings {
  studentId: string | null
  supervisorIds: string[]
  industryIds: string[]
}
export function canManagePkl(access: CmsSession) {
  return pklAdminRoles.has(access.role)
}
export function canReadAllPkl(access: CmsSession) {
  return canManagePkl(access) || pklReadAllRoles.has(access.role)
}
export function canReadPklInternship(
  row: PklRow,
  access: CmsSession,
  bindings: PklBindings,
): boolean {
  if (canReadAllPkl(access)) return true
  if (access.role === 'siswa')
    return row.student_id === bindings.studentId && bindings.studentId !== null
  if (pklTeacherRoles.has(access.role))
    return bindings.supervisorIds.some(
      (id) => row.supervisor_id === id || row.supervisor_guru_id === id,
    )
  if (pklIndustryRoles.has(access.role))
    return bindings.industryIds.some((id) => row.industry_id === id)
  return false
}
export function canAssessPklInternship(
  row: PklRow,
  access: CmsSession,
  bindings: PklBindings,
): boolean {
  return (
    (canManagePkl(access) ||
      pklTeacherRoles.has(access.role) ||
      pklIndustryRoles.has(access.role)) &&
    canReadPklInternship(row, access, bindings)
  )
}
function onlyFields(input: PklInput, allowed: readonly string[]) {
  const fields = new Set(allowed)
  if (Object.keys(input).some((field) => !fields.has(field)))
    throw AppError.forbidden('PKL field is protected.')
}
export function authorizePklMutation(
  params: PklMutation,
  data: PklInput,
  bindings: PklBindings,
  before: PklRow | null,
  internship: PklRow | null,
) {
  if (params.resource === 'status_history')
    throw AppError.forbidden('Status history is append-only and server-owned.')
  if (
    params.resource === 'registrations' &&
    params.action === 'update' &&
    data.status !== undefined &&
    before &&
    data.status !== before.status
  )
    throw AppError.conflict('Use the registration transition endpoint to change status.')
  if (canManagePkl(params.access)) return
  if (params.resource === 'roster' && pklRosterRoles.has(params.access.role)) return
  const student = params.access.role === 'siswa'
  const ownStudent =
    bindings.studentId !== null && (before?.student_id ?? data.student_id) === bindings.studentId
  if (
    params.resource === 'students' &&
    student &&
    params.action === 'update' &&
    before?.id === bindings.studentId
  ) {
    onlyFields(data, [
      'phone',
      'parent_name',
      'parent_phone',
      'gender',
      'birth_date',
      'birth_place',
      'address',
      'profile_completed',
    ])
    return
  }
  if (
    student &&
    ['registrations', 'applications'].includes(params.resource) &&
    ownStudent &&
    params.action !== 'delete'
  ) {
    if (
      before &&
      !['BELUM_DAFTAR', 'PENDING_APPROVAL', 'MENCARI_INDUSTRI', 'pending'].includes(
        String(before.status),
      )
    )
      throw AppError.conflict('Application can no longer be edited.')
    if (before)
      onlyFields(data, [
        'industry_id',
        'is_self_proposed',
        'proposed_industry_name',
        'proposed_industry_address',
        'proposed_industry_contact',
        'proposed_industry_phone',
        'proposed_industry_email',
        'proposed_acceptance_letter',
        'motivation',
        'preferred_industry_name',
        'preferred_supervisor_name',
        'start_date_preferred',
      ])
    return
  }
  if (params.resource === 'documents' && student && ownStudent) {
    if (before) onlyFields(data, ['doc_type', 'title', 'file_url', 'file_size', 'mime_type'])
    return
  }
  if (
    params.resource === 'daily_journals' &&
    internship &&
    canReadPklInternship(internship, params.access, bindings)
  ) {
    if (student) {
      if (
        before &&
        !['draft', 'pending', 'submitted', 'rejected', 'revision'].includes(String(before.status))
      )
        throw AppError.conflict('Approved journal cannot be edited.')
      onlyFields(
        data,
        params.action === 'create'
          ? [
              'internship_id',
              'date',
              'description',
              'activities',
              'activity',
              'documentation_url',
              'photo_url',
              'status',
              'status_attendance',
              'verification_status',
            ]
          : [
              'date',
              'description',
              'activities',
              'activity',
              'documentation_url',
              'photo_url',
              'status',
              'status_attendance',
            ],
      )
      if (
        data.status !== undefined &&
        !['draft', 'pending', 'submitted'].includes(String(data.status))
      )
        throw AppError.forbidden('Students cannot approve journals.')
      if (data.verification_status !== undefined && data.verification_status !== 'pending')
        throw AppError.forbidden()
      return
    }
    if (params.action === 'update' && canAssessPklInternship(internship, params.access, bindings)) {
      onlyFields(data, ['status', 'supervisor_notes', 'verification_status'])
      if (data.verification_status !== undefined && data.status === undefined)
        throw AppError.validationError('Review status is required with verification status.')
      if (
        data.status !== undefined &&
        !['approved', 'rejected', 'revision', 'submitted'].includes(String(data.status))
      )
        throw AppError.forbidden()
      return
    }
  }
  if (
    params.resource === 'assessment_scores' &&
    internship &&
    canAssessPklInternship(internship, params.access, bindings) &&
    params.action !== 'delete'
  ) {
    const scores = pklTeacherRoles.has(params.access.role)
      ? ['supervisor_score', 'score_school']
      : ['industry_score', 'score_industry']
    onlyFields(
      data,
      params.action === 'create'
        ? ['internship_id', 'indicator_id', 'notes', ...scores]
        : ['notes', ...scores],
    )
    return
  }
  if (
    params.resource === 'journal_comments' &&
    params.action === 'create' &&
    internship &&
    canAssessPklInternship(internship, params.access, bindings)
  )
    return
  if (
    params.resource === 'monitoring' &&
    pklTeacherRoles.has(params.access.role) &&
    internship &&
    canReadPklInternship(internship, params.access, bindings) &&
    params.action !== 'delete'
  ) {
    if (!bindings.supervisorIds.some((id) => (before?.supervisor_id ?? data.supervisor_id) === id))
      throw AppError.forbidden()
    if (before)
      onlyFields(data, [
        'scheduled_date',
        'visit_date',
        'notes',
        'visit_notes',
        'evaluation',
        'photo_urls',
        'status',
      ])
    return
  }
  throw AppError.forbidden('PKL operation is not permitted.')
}
const transitions = new Map<RegistrationStatus, readonly RegistrationStatus[]>([
  ['BELUM_DAFTAR', ['PENDING_APPROVAL', 'DIBATALKAN']],
  ['PENDING_APPROVAL', ['MENCARI_INDUSTRI', 'DITOLAK', 'DIBATALKAN']],
  ['MENCARI_INDUSTRI', ['MENUNGGU_INDUSTRI', 'DIBATALKAN']],
  ['MENUNGGU_INDUSTRI', ['DITERIMA', 'DITOLAK', 'DIBATALKAN']],
  ['DITERIMA', ['PKL_BERJALAN', 'DIBATALKAN']],
  ['PKL_BERJALAN', ['SELESAI', 'DIBATALKAN']],
  ['DITOLAK', ['BELUM_DAFTAR', 'PENDING_APPROVAL']],
  ['DIBATALKAN', ['BELUM_DAFTAR']],
  ['SELESAI', []],
])
export function authorizePklTransition(
  params: PklTransition,
  before: PklRow,
  bindings: PklBindings,
) {
  if (before.status !== params.expected_status)
    throw AppError.conflict('Registration status has changed; reload before retrying.')
  if (!transitions.get(params.expected_status)?.includes(params.status))
    throw AppError.conflict('Invalid PKL state transition.')
  if (canManagePkl(params.access)) return
  if (
    params.access.role === 'siswa' &&
    before.student_id === bindings.studentId &&
    bindings.studentId !== null
  ) {
    if (
      (['BELUM_DAFTAR', 'DITOLAK'].includes(params.expected_status) &&
        params.status === 'PENDING_APPROVAL') ||
      (['DITOLAK', 'DIBATALKAN'].includes(params.expected_status) &&
        params.status === 'BELUM_DAFTAR') ||
      (params.expected_status === 'MENCARI_INDUSTRI' && params.status === 'MENUNGGU_INDUSTRI') ||
      (['BELUM_DAFTAR', 'PENDING_APPROVAL', 'MENCARI_INDUSTRI', 'MENUNGGU_INDUSTRI'].includes(
        params.expected_status,
      ) &&
        params.status === 'DIBATALKAN')
    )
      return
  }
  if (
    pklIndustryRoles.has(params.access.role) &&
    params.expected_status === 'MENUNGGU_INDUSTRI' &&
    ['DITERIMA', 'DITOLAK'].includes(params.status) &&
    bindings.industryIds.some((id) => before.industry_id === id)
  )
    return
  throw AppError.forbidden('PKL transition is not permitted.')
}
