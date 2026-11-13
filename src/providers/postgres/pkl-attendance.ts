import postgres, { type Sql, type TransactionSql } from 'postgres'
import { AppError } from '../../lib/errors/app-error.js'
import type { CmsSession } from '../../modules/cms/schema.js'
import { pklSchoolDate, type PklCheckIn, type PklCheckOut } from '../../modules/pkl/attendance.js'
import type { PklInput, PklRow } from '../../modules/pkl/resources.js'
import { lockCmsAuthority } from './cms-authority.js'
import { auditPkl, bindingsForPkl, pklRecordById, translatePklError } from './pkl-shared.js'

interface PklCheckInLocation {
  lat?: number
  lng?: number
  photo_url?: string
}

export async function recordPklCheckIn(
  tx: TransactionSql,
  access: CmsSession,
  internship: PklRow,
  studentId: string,
  date: string,
  location: PklCheckInLocation,
  notes: string | null,
): Promise<PklRow> {
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`pkl:attendance:${studentId}:${date}`},0))`
  const existing = await tx<
    { data: PklRow }[]
  >`SELECT to_jsonb(record.*) AS data FROM pkl.attendance AS record WHERE student_id = ${studentId} AND date = ${date} AND deleted_at IS NULL FOR UPDATE`
  const before = existing[0]?.data ?? null
  if (before && before.internship_id !== internship.id) {
    throw AppError.conflict('Attendance already belongs to a different internship on this date.')
  }
  const data: PklInput = {
    internship_id: internship.id,
    student_id: studentId,
    date,
    status: 'HADIR',
    check_in_at: before?.check_in_at ?? new Date().toISOString(),
    created_by: before?.created_by ?? access.id,
  }
  if (notes !== null) data.notes = notes
  if (
    location.lat !== undefined &&
    (before?.check_in_lat === null || before?.check_in_lat === undefined)
  ) {
    data.check_in_lat = location.lat
  }
  if (
    location.lng !== undefined &&
    (before?.check_in_lng === null || before?.check_in_lng === undefined)
  ) {
    data.check_in_lng = location.lng
  }
  if (location.photo_url !== undefined && !before?.photo_url) data.photo_url = location.photo_url
  const columns = Object.keys(data)
  const rows = before
    ? await tx<
        { data: PklRow }[]
      >`UPDATE pkl.attendance AS record SET (${tx(columns)}) = (SELECT ${tx(columns)} FROM jsonb_populate_record(NULL::pkl.attendance,${tx.json(data)})),updated_at = now() WHERE id = ${before.id} RETURNING to_jsonb(record.*) AS data`
    : await tx<
        { data: PklRow }[]
      >`INSERT INTO pkl.attendance AS record (${tx(columns)}) SELECT ${tx(columns)} FROM jsonb_populate_record(NULL::pkl.attendance,${tx.json(data)}) RETURNING to_jsonb(record.*) AS data`
  const after = rows[0]!.data
  await auditPkl(tx, access, 'attendance', 'check_in', before, after)
  return after
}

export async function checkInPkl(sql: Sql, params: PklCheckIn): Promise<PklRow> {
  try {
    return await sql.begin(async (tx) => {
      await lockCmsAuthority(tx, params.access)
      if (params.access.role !== 'siswa') throw AppError.forbidden()
      const bindings = await bindingsForPkl(tx, params.access)
      const internship = await pklRecordById(tx, 'internships', params.internship_id)
      if (!bindings.studentId || internship.student_id !== bindings.studentId) {
        throw AppError.forbidden()
      }
      return recordPklCheckIn(
        tx,
        params.access,
        internship,
        bindings.studentId,
        pklSchoolDate(),
        params,
        null,
      )
    })
  } catch (error) {
    if (error instanceof postgres.PostgresError) translatePklError(error)
    throw error
  }
}

export async function checkOutPkl(sql: Sql, params: PklCheckOut): Promise<PklRow> {
  try {
    return await sql.begin(async (tx) => {
      await lockCmsAuthority(tx, params.access)
      if (params.access.role !== 'siswa') throw AppError.forbidden()
      const before = await pklRecordById(tx, 'attendance', params.id, 'update')
      const bindings = await bindingsForPkl(tx, params.access)
      if (!bindings.studentId || before.student_id !== bindings.studentId) {
        throw AppError.forbidden()
      }
      if (!before.check_in_at) throw AppError.conflict('Check in before checking out.')
      if (before.date !== pklSchoolDate()) {
        throw AppError.conflict('Only current school-day attendance can be checked out.')
      }
      const data: PklInput = { check_out_at: before.check_out_at ?? new Date().toISOString() }
      if (params.lat !== undefined && !before.check_out_at) data.check_out_lat = params.lat
      if (params.lng !== undefined && !before.check_out_at) data.check_out_lng = params.lng
      const columns = Object.keys(data)
      const rows = await tx<
        { data: PklRow }[]
      >`UPDATE pkl.attendance AS record SET (${tx(columns)}) = (SELECT ${tx(columns)} FROM jsonb_populate_record(NULL::pkl.attendance,${tx.json(data)})),updated_at = now() WHERE id = ${before.id} RETURNING to_jsonb(record.*) AS data`
      const after = rows[0]!.data
      await auditPkl(tx, params.access, 'attendance', 'check_out', before, after)
      return after
    })
  } catch (error) {
    if (error instanceof postgres.PostgresError) translatePklError(error)
    throw error
  }
}
