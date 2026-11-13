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
import type { PklRow, PklSupervisorAssignment } from '../../modules/pkl/resources.js'
import { assertMemoryCmsAuthority } from './cms-authority.js'
import { mutateMemoryPklRecord } from './pkl-records.js'
import { activeRows, bindingsFor, record, save, type MemoryPklState } from './pkl-state.js'

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
