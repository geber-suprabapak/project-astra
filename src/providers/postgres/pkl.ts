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
import postgres, { type Sql, type TransactionSql } from 'postgres'
import { z } from 'zod'
import { AppError } from '../../lib/errors/app-error.js'
import { lockCmsAuthority } from './cms-authority.js'
import { pklProjection } from './pkl-projection.js'
import { pklWhere } from './pkl-query.js'
import {
  authorizePklMutation,
  authorizePklTransition,
  canManagePkl,
  canAssessPklInternship,
  pklRosterRoles,
  type PklBindings,
} from '../../modules/pkl/policy.js'
import {
  completePklWrite,
  pklRelatedResources,
  preparePklWrite,
  validatePklQuery,
  type PklInput,
  type PklImport,
  type PklList,
  type PklMutation,
  type PklRow,
  type PklTransition,
} from '../../modules/pkl/resources.js'
import type { CmsSession } from '../../modules/cms/schema.js'

export async function listPklRecords(sql: Sql, params: PklList): Promise<PklRow[]> {
  return sql.begin(async (tx) => {
    await lockCmsAuthority(tx, params.access)
    const direction = params.query.direction === 'desc' ? tx`DESC` : tx`ASC`
    const rows = await tx<
      { data: PklRow }[]
    >`SELECT ${pklProjection(tx, params.resource, 'content', params.access)} AS data FROM ${tx('pkl.' + params.resource)} AS content WHERE ${pklWhere(tx, params)} ORDER BY ${tx('content.' + params.query.sort)} ${direction} NULLS LAST, content.id ASC LIMIT ${params.query.limit + 1} OFFSET ${params.query.offset}`
    return rows.map((row) => row.data)
  })
}
export async function countPklRecords(sql: Sql, params: PklList): Promise<number> {
  return sql.begin(async (tx) => {
    await lockCmsAuthority(tx, params.access)
    const rows = await tx<
      { total: number }[]
    >`SELECT count(*)::integer AS total FROM ${tx('pkl.' + params.resource)} AS content WHERE ${pklWhere(tx, params)}`
    return rows[0]!.total
  })
}
async function bindingsFor(tx: TransactionSql, access: CmsSession): Promise<PklBindings> {
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
async function recordById(
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
function asId(value: PklInput[string] | undefined) {
  const parsed = z.uuid().safeParse(value)
  if (!parsed.success) throw AppError.validationError('A valid related PKL ID is required.')
  return parsed.data
}
async function parentInternship(
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
  )
    return recordById(tx, 'internships', asId(merged.internship_id))
  if (params.resource === 'journal_comments') {
    const journal = await recordById(tx, 'daily_journals', asId(merged.journal_id))
    return recordById(tx, 'internships', asId(journal.internship_id))
  }
  return null
}
async function audit(
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
function translateError(error: postgres.PostgresError): never {
  if (error instanceof postgres.PostgresError) {
    if (['23505', '23503', '40001', '40P01'].includes(error.code))
      throw AppError.conflict('PKL record conflicts with existing data or changed concurrently.')
    if (['22P02', '22007', '23514', '23502'].includes(error.code))
      throw AppError.validationError('PKL record does not satisfy the domain schema.')
  }
  throw error
}
async function validateRelationships(
  tx: TransactionSql,
  params: PklMutation,
  data: PklInput,
  merged: PklInput,
  internship: PklRow | null,
) {
  for (const [field, resource] of pklRelatedResources)
    if (data[field]) await recordById(tx, resource, asId(data[field]))
  if (internship && merged.student_id && merged.student_id !== internship.student_id)
    throw AppError.validationError('Student does not belong to the referenced internship.')
  if (params.resource === 'documents' && merged.registration_id) {
    const registration = await recordById(tx, 'registrations', asId(merged.registration_id))
    if (registration.student_id !== merged.student_id)
      throw AppError.validationError('Student does not own the referenced registration.')
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
    >`SELECT role FROM cms.profiles WHERE id = ${asId(data.profile_id)} FOR SHARE`
    if (!profiles[0] || !roles.includes(profiles[0].role))
      throw AppError.validationError('Profile role does not match this PKL binding.')
  }
  const start = z.iso.date().safeParse(merged.start_date),
    end = z.iso.date().safeParse(merged.end_date)
  if (start.success && end.success && start.data > end.data)
    throw AppError.validationError('End date must not precede start date.')
  let indicator: PklRow | null = null
  if (params.resource === 'assessment_scores') {
    indicator = await recordById(tx, 'assessment_indicators', asId(merged.indicator_id))
    const max = z.number().positive().parse(indicator.max_score)
    for (const key of [
      'score_school',
      'supervisor_score',
      'score_industry',
      'industry_score',
    ] as const)
      if (merged[key] !== null && merged[key] !== undefined && z.number().parse(merged[key]) > max)
        throw AppError.validationError('Assessment exceeds the indicator maximum.')
  }
  return indicator
}
export async function mutatePklRecord(sql: Sql, params: PklMutation): Promise<PklRow> {
  try {
    return await sql.begin((tx) => applyPklMutation(tx, params))
  } catch (error) {
    if (error instanceof postgres.PostgresError) translateError(error)
    throw error
  }
}
export async function transitionPklRegistration(sql: Sql, params: PklTransition): Promise<PklRow> {
  try {
    return await sql.begin(async (tx) => {
      await lockCmsAuthority(tx, params.access)
      const before = await recordById(tx, 'registrations', params.id, 'update')
      const bindings = await bindingsFor(tx, params.access)
      authorizePklTransition(params, before, bindings)
      const data: PklInput = { status: params.status }
      if (params.industry_id) {
        if (!canManagePkl(params.access) && params.access.role !== 'siswa')
          throw AppError.forbidden()
        await recordById(tx, 'industries', params.industry_id)
        data.industry_id = params.industry_id
      }
      if (params.status === 'MENUNGGU_INDUSTRI' && !(data.industry_id ?? before.industry_id))
        throw AppError.validationError('Choose an industry first.')
      if (params.status === 'MENCARI_INDUSTRI' || params.status === 'DITOLAK') {
        data.reviewed_by = params.access.id
        data.reviewed_at = new Date().toISOString()
        data.review_notes = params.notes ?? null
      }
      if (params.status === 'DITOLAK') {
        if (!params.notes?.trim()) throw AppError.validationError('Rejection reason is required.')
        data.rejection_reason = params.notes
      }
      if (params.status === 'DITERIMA') {
        data.accepted_industry_id = asId(data.industry_id ?? before.industry_id)
        data.accepted_by = params.access.id
        data.accepted_at = new Date().toISOString()
      }
      const columns = Object.keys(data)
      const rows = await tx<
        { data: PklRow }[]
      >`UPDATE pkl.registrations AS record SET (${tx(columns)}) = (SELECT ${tx(columns)} FROM jsonb_populate_record(NULL::pkl.registrations,${tx.json(data)})), updated_at = now() WHERE id = ${params.id} RETURNING to_jsonb(record.*) AS data`
      const after = rows[0]!.data
      await tx`INSERT INTO pkl.status_history(registration_id,from_status,to_status,changed_by,changed_by_role,notes) VALUES (${params.id},${String(before.status)},${params.status},${params.access.id},${params.access.role},${params.notes ?? null})`
      await audit(tx, params.access, 'registrations', 'transition', before, after)
      return after
    })
  } catch (error) {
    if (error instanceof postgres.PostgresError) translateError(error)
    throw error
  }
}

async function applyPklMutation(tx: TransactionSql, params: PklMutation): Promise<PklRow> {
  await lockCmsAuthority(tx, params.access)
  const data = preparePklWrite(params)
  let before: PklRow | null = null
  if (params.action !== 'create') {
    const id = asId(params.id)
    const query = validatePklQuery(params.resource, { id, limit: 1 })
    const rows = await tx<
      { data: PklRow }[]
    >`SELECT to_jsonb(content.*) AS data FROM ${tx('pkl.' + params.resource)} AS content WHERE ${pklWhere(tx, { resource: params.resource, query, access: params.access })} FOR UPDATE`
    before = rows[0]?.data ?? null
    if (!before) throw AppError.notFound('PKL record')
  }
  const merged: PklInput = { ...before, ...data }
  const bindings = await bindingsFor(tx, params.access)
  const internship = await parentInternship(tx, params, merged)
  authorizePklMutation(params, data, bindings, before, internship)
  if (params.action === 'delete') {
    if (params.resource === 'certificate_templates' && before!.is_active === true)
      throw AppError.conflict('Deactivate the certificate template first.')
    await tx`UPDATE ${tx('pkl.' + params.resource)} SET deleted_at = now(), updated_at = now() WHERE id = ${before!.id}`
    await audit(tx, params.access, params.resource, 'delete', before, null)
    return before!
  }
  const indicator = await validateRelationships(tx, params, data, merged, internship)
  completePklWrite(params, data, before, indicator)
  if (params.resource === 'certificate_templates' && data.is_active === true) {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended('pkl:active-certificate-template',0))`
    await tx`UPDATE pkl.certificate_templates SET is_active = false, updated_at = now() WHERE is_active = true AND deleted_at IS NULL`
  }
  const columns = Object.keys(data),
    table = tx('pkl.' + params.resource)
  const rows =
    params.action === 'create'
      ? await tx<
          { data: PklRow }[]
        >`INSERT INTO ${table} AS record (${tx(columns)}) SELECT ${tx(columns)} FROM jsonb_populate_record(NULL::${table},${tx.json(data)}) RETURNING to_jsonb(record.*) AS data`
      : await tx<
          { data: PklRow }[]
        >`UPDATE ${table} AS record SET (${tx(columns)}) = (SELECT ${tx(columns)} FROM jsonb_populate_record(NULL::${table},${tx.json(data)})), updated_at = now() WHERE id = ${before!.id} RETURNING to_jsonb(record.*) AS data`
  const after = rows[0]!.data
  await audit(tx, params.access, params.resource, params.action, before, after)
  if (
    params.resource === 'daily_journals' &&
    params.action === 'create' &&
    params.access.role === 'siswa' &&
    after.status !== 'draft'
  ) {
    await recordPklCheckIn(
      tx,
      params.access,
      internship!,
      asId(internship!.student_id),
      String(after.date),
      {},
      'Hadir (otomatis dari pengisian jurnal harian)',
    )
  }
  if (params.resource === 'registrations' && params.action === 'create')
    await tx`INSERT INTO pkl.status_history(registration_id,to_status,changed_by,changed_by_role,notes) VALUES (${after.id},${String(after.status)},${params.access.id},${params.access.role},'Initial registration')`
  return after
}

export async function importPklRecords(sql: Sql, params: PklImport): Promise<PklRow[]> {
  if (
    !canManagePkl(params.access) &&
    !(params.resource === 'roster' && pklRosterRoles.has(params.access.role))
  )
    throw AppError.forbidden()
  try {
    return await sql.begin(async (tx) => {
      const rows: PklRow[] = []
      for (const data of params.rows)
        rows.push(
          await applyPklMutation(tx, {
            resource: params.resource,
            access: params.access,
            data,
            action: 'create',
          }),
        )
      return rows
    })
  } catch (error) {
    if (error instanceof postgres.PostgresError) translateError(error)
    throw error
  }
}

async function recordPklCheckIn(
  tx: TransactionSql,
  access: CmsSession,
  internship: PklRow,
  studentId: string,
  date: string,
  location: { lat?: number; lng?: number; photo_url?: string },
  notes: string | null,
): Promise<PklRow> {
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`pkl:attendance:${studentId}:${date}`},0))`
  const existing = await tx<
    { data: PklRow }[]
  >`SELECT to_jsonb(record.*) AS data FROM pkl.attendance AS record WHERE student_id = ${studentId} AND date = ${date} AND deleted_at IS NULL FOR UPDATE`
  const before = existing[0]?.data ?? null
  if (before && before.internship_id !== internship.id)
    throw AppError.conflict('Attendance already belongs to a different internship on this date.')
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
  )
    data.check_in_lat = location.lat
  if (
    location.lng !== undefined &&
    (before?.check_in_lng === null || before?.check_in_lng === undefined)
  )
    data.check_in_lng = location.lng
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
  await audit(tx, access, 'attendance', 'check_in', before, after)
  return after
}
export async function checkInPkl(sql: Sql, params: PklCheckIn): Promise<PklRow> {
  try {
    return await sql.begin(async (tx) => {
      await lockCmsAuthority(tx, params.access)
      if (params.access.role !== 'siswa') throw AppError.forbidden()
      const bindings = await bindingsFor(tx, params.access),
        internship = await recordById(tx, 'internships', params.internship_id)
      if (!bindings.studentId || internship.student_id !== bindings.studentId)
        throw AppError.forbidden()
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
    if (error instanceof postgres.PostgresError) translateError(error)
    throw error
  }
}
export async function checkOutPkl(sql: Sql, params: PklCheckOut): Promise<PklRow> {
  try {
    return await sql.begin(async (tx) => {
      await lockCmsAuthority(tx, params.access)
      if (params.access.role !== 'siswa') throw AppError.forbidden()
      const before = await recordById(tx, 'attendance', params.id, 'update'),
        bindings = await bindingsFor(tx, params.access)
      if (!bindings.studentId || before.student_id !== bindings.studentId)
        throw AppError.forbidden()
      if (!before.check_in_at) throw AppError.conflict('Check in before checking out.')
      if (before.date !== pklSchoolDate())
        throw AppError.conflict('Only current school-day attendance can be checked out.')
      const data: PklInput = { check_out_at: before.check_out_at ?? new Date().toISOString() }
      if (params.lat !== undefined && !before.check_out_at) data.check_out_lat = params.lat
      if (params.lng !== undefined && !before.check_out_at) data.check_out_lng = params.lng
      const columns = Object.keys(data)
      const rows = await tx<
        { data: PklRow }[]
      >`UPDATE pkl.attendance AS record SET (${tx(columns)}) = (SELECT ${tx(columns)} FROM jsonb_populate_record(NULL::pkl.attendance,${tx.json(data)})),updated_at = now() WHERE id = ${before.id} RETURNING to_jsonb(record.*) AS data`
      const after = rows[0]!.data
      await audit(tx, params.access, 'attendance', 'check_out', before, after)
      return after
    })
  } catch (error) {
    if (error instanceof postgres.PostgresError) translateError(error)
    throw error
  }
}

export async function savePklAssessment(sql: Sql, input: PklAssessment): Promise<PklRow> {
  const params = parseAssessment(input)
  try {
    return await sql.begin(async (tx) => {
      await lockCmsAuthority(tx, params.access)
      const before = await recordById(tx, 'internships', params.id, 'update')
      const bindings = await bindingsFor(tx, params.access)
      if (!canAssessPklInternship(before, params.access, bindings)) throw AppError.forbidden()
      const student = await recordById(tx, 'students', asId(before.student_id))
      const indicators = await tx<
        { data: PklRow }[]
      >`SELECT to_jsonb(record.*) AS data FROM pkl.assessment_indicators AS record WHERE is_published = true AND deleted_at IS NULL FOR SHARE`
      const applicable = applicableAssessmentIndicators(
        params,
        indicators.map((row) => row.data),
        student,
      )
      for (const score of params.scores) {
        const existing = await tx<
          { data: PklRow }[]
        >`SELECT to_jsonb(record.*) AS data FROM pkl.assessment_scores AS record WHERE internship_id = ${params.id} AND indicator_id = ${score.indicator_id} AND deleted_at IS NULL FOR UPDATE`
        await applyPklMutation(tx, assessmentMutation(params, score, existing[0]?.data))
      }
      const scores = await tx<
        { data: PklRow }[]
      >`SELECT to_jsonb(record.*) AS data FROM pkl.assessment_scores AS record WHERE internship_id = ${params.id} AND deleted_at IS NULL FOR SHARE`
      const totals = assessmentTotals(
        applicable,
        scores.map((row) => row.data),
      )
      const updated = await tx<
        { data: PklRow }[]
      >`UPDATE pkl.internships AS record SET final_score = ${totals.final_score}, grade = ${totals.grade}, notes = ${
        params.notes ??
        z
          .string()
          .nullable()
          .parse(before.notes ?? null)
      }, updated_at = now() WHERE id = ${params.id} RETURNING to_jsonb(record.*) AS data`
      await audit(tx, params.access, 'internships', 'assessment', before, updated[0]!.data)
      const certificates = await tx<
        { data: PklRow }[]
      >`SELECT to_jsonb(record.*) AS data FROM pkl.certificates AS record WHERE internship_id = ${params.id} AND deleted_at IS NULL FOR UPDATE`
      for (const certificate of certificates) {
        const changed = await tx<
          { data: PklRow }[]
        >`UPDATE pkl.certificates AS record SET final_score = ${totals.final_score}, grade = ${totals.grade}, updated_at = now() WHERE id = ${certificate.data.id} RETURNING to_jsonb(record.*) AS data`
        await audit(
          tx,
          params.access,
          'certificates',
          'assessment',
          certificate.data,
          changed[0]!.data,
        )
      }
      return { id: params.id, saved: params.scores.length, ...totals }
    })
  } catch (error) {
    if (error instanceof postgres.PostgresError) translateError(error)
    throw error
  }
}

export async function verifyPklCertificate(
  sql: Sql,
  code: string,
): Promise<CertificateVerification | null> {
  if (!certificateCodeSchema.safeParse(code).success) return null
  const rows = await sql<{ data: CertificateVerification }[]>`
    SELECT jsonb_build_object(
      'id', certificate.id, 'certificate_number', certificate.certificate_number, 'issue_date', certificate.issue_date,
      'final_score', certificate.final_score, 'grade', certificate.grade,
      'internship', jsonb_build_object('start_date', internship.start_date, 'end_date', internship.end_date,
        'student', jsonb_build_object('name', student.name, 'nis', student.nis, 'jurusan', student.jurusan),
        'industry', jsonb_build_object('name', industry.name, 'city', industry.city))) AS data
    FROM pkl.certificates certificate
    JOIN pkl.internships internship ON internship.id = certificate.internship_id AND internship.deleted_at IS NULL
    JOIN pkl.students student ON student.id = internship.student_id AND student.deleted_at IS NULL
    JOIN pkl.industries industry ON industry.id = internship.industry_id AND industry.deleted_at IS NULL
    WHERE certificate.validation_code = ${code} AND certificate.status = 'issued' AND certificate.deleted_at IS NULL
    LIMIT 1
  `
  return rows[0] ? certificateVerificationSchema.parse(rows[0].data) : null
}

export async function assignPklIndustrySupervisor(
  sql: Sql,
  params: PklSupervisorAssignment,
): Promise<PklRow> {
  if (!canManagePkl(params.access)) throw AppError.forbidden()
  return sql.begin(async (tx) => {
    await lockCmsAuthority(tx, params.access)
    const before = await recordById(tx, 'industries', params.id, 'update')
    await recordById(tx, 'supervisors', params.supervisor_id)
    const updated = await tx<
      { data: PklRow }[]
    >`UPDATE pkl.industries AS record SET supervisor_id = ${params.supervisor_id}, updated_at = now() WHERE id = ${params.id} RETURNING to_jsonb(record.*) AS data`
    await audit(tx, params.access, 'industries', 'update', before, updated[0]!.data)
    const internships = await tx<
      { data: PklRow }[]
    >`SELECT to_jsonb(record.*) AS data FROM pkl.internships AS record WHERE industry_id = ${params.id} AND supervisor_id IS NULL AND supervisor_guru_id IS NULL AND deleted_at IS NULL ORDER BY id FOR UPDATE`
    for (const internship of internships) {
      const changed = await tx<
        { data: PklRow }[]
      >`UPDATE pkl.internships AS record SET supervisor_id = ${params.supervisor_id}, supervisor_guru_id = ${params.supervisor_id}, updated_at = now() WHERE id = ${internship.data.id} RETURNING to_jsonb(record.*) AS data`
      await audit(tx, params.access, 'internships', 'update', internship.data, changed[0]!.data)
    }
    return updated[0]!.data
  })
}
