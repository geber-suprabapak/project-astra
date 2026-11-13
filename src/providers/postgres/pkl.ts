import postgres, { type Sql } from 'postgres'
import { z } from 'zod'
import { AppError } from '../../lib/errors/app-error.js'
import {
  applicableAssessmentIndicators,
  assessmentMutation,
  assessmentTotals,
  parseAssessment,
  type PklAssessment,
} from '../../modules/pkl/assessment-command.js'
import {
  certificateCodeSchema,
  certificateVerificationSchema,
  type CertificateVerification,
} from '../../modules/pkl/certificates.js'
import { canAssessPklInternship, canManagePkl } from '../../modules/pkl/policy.js'
import type { PklList, PklRow, PklSupervisorAssignment } from '../../modules/pkl/resources.js'
import { lockCmsAuthority } from './cms-authority.js'
import { applyPklMutation } from './pkl-mutations.js'
import { pklProjection } from './pkl-projection.js'
import { pklWhere } from './pkl-query.js'
import {
  asPklId,
  auditPkl,
  bindingsForPkl,
  pklRecordById,
  translatePklError,
} from './pkl-shared.js'

export { checkInPkl, checkOutPkl } from './pkl-attendance.js'
export { importPklRecords, mutatePklRecord, transitionPklRegistration } from './pkl-mutations.js'

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

export async function savePklAssessment(sql: Sql, input: PklAssessment): Promise<PklRow> {
  const params = parseAssessment(input)
  try {
    return await sql.begin(async (tx) => {
      await lockCmsAuthority(tx, params.access)
      const before = await pklRecordById(tx, 'internships', params.id, 'update')
      const bindings = await bindingsForPkl(tx, params.access)
      if (!canAssessPklInternship(before, params.access, bindings)) throw AppError.forbidden()
      const student = await pklRecordById(tx, 'students', asPklId(before.student_id))
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
      await auditPkl(tx, params.access, 'internships', 'assessment', before, updated[0]!.data)
      const certificates = await tx<
        { data: PklRow }[]
      >`SELECT to_jsonb(record.*) AS data FROM pkl.certificates AS record WHERE internship_id = ${params.id} AND deleted_at IS NULL FOR UPDATE`
      for (const certificate of certificates) {
        const changed = await tx<
          { data: PklRow }[]
        >`UPDATE pkl.certificates AS record SET final_score = ${totals.final_score}, grade = ${totals.grade}, updated_at = now() WHERE id = ${certificate.data.id} RETURNING to_jsonb(record.*) AS data`
        await auditPkl(
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
    if (error instanceof postgres.PostgresError) translatePklError(error)
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
    const before = await pklRecordById(tx, 'industries', params.id, 'update')
    await pklRecordById(tx, 'supervisors', params.supervisor_id)
    const updated = await tx<
      { data: PklRow }[]
    >`UPDATE pkl.industries AS record SET supervisor_id = ${params.supervisor_id}, updated_at = now() WHERE id = ${params.id} RETURNING to_jsonb(record.*) AS data`
    await auditPkl(tx, params.access, 'industries', 'update', before, updated[0]!.data)
    const internships = await tx<
      { data: PklRow }[]
    >`SELECT to_jsonb(record.*) AS data FROM pkl.internships AS record WHERE industry_id = ${params.id} AND supervisor_id IS NULL AND supervisor_guru_id IS NULL AND deleted_at IS NULL ORDER BY id FOR UPDATE`
    for (const internship of internships) {
      const changed = await tx<
        { data: PklRow }[]
      >`UPDATE pkl.internships AS record SET supervisor_id = ${params.supervisor_id}, supervisor_guru_id = ${params.supervisor_id}, updated_at = now() WHERE id = ${internship.data.id} RETURNING to_jsonb(record.*) AS data`
      await auditPkl(tx, params.access, 'internships', 'update', internship.data, changed[0]!.data)
    }
    return updated[0]!.data
  })
}
