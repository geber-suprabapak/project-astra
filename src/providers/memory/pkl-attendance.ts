import { randomUUID } from 'node:crypto'
import { AppError } from '../../lib/errors/app-error.js'
import type { CmsSession } from '../../modules/cms/schema.js'
import { pklSchoolDate, type PklCheckIn, type PklCheckOut } from '../../modules/pkl/attendance.js'
import type { PklRow } from '../../modules/pkl/resources.js'
import { assertMemoryCmsAuthority } from './cms-authority.js'
import { activeRows, bindingsFor, record, save, type MemoryPklState } from './pkl-state.js'

export function recordMemoryCheckIn(
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
