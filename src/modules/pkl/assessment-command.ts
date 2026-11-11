import { z } from 'zod'
import { AppError } from '../../lib/errors/app-error.js'
import type { CmsSession } from '../cms/schema.js'
import {
  calculateWeightedAssessmentScores,
  type AssessmentIndicatorItem,
  type ScoreInputItem,
} from './assessment.js'
import type { PklInput, PklMutation, PklRow } from './resources.js'

export const pklAssessmentSchema = z
  .object({
    scores: z
      .array(
        z
          .object({
            indicator_id: z.uuid(),
            score_school: z.number().min(0).max(100).nullable().optional(),
            score_industry: z.number().min(0).max(100).nullable().optional(),
            notes: z.string().max(5000).nullable().optional(),
          })
          .strict()
          .refine(
            (row) => row.score_school !== undefined || row.score_industry !== undefined,
            'An assessor score is required.',
          ),
      )
      .min(1)
      .max(500),
    notes: z.string().max(10000).optional(),
  })
  .strict()
  .refine(
    (command) =>
      new Set(command.scores.map((row) => row.indicator_id)).size === command.scores.length,
    'Duplicate assessment indicators.',
  )
export type PklAssessmentInput = z.infer<typeof pklAssessmentSchema>
export type PklAssessment = PklAssessmentInput & { id: string; access: CmsSession }

export function assessmentMutation(
  params: PklAssessment,
  score: PklAssessmentInput['scores'][number],
  existing: PklRow | undefined,
): PklMutation {
  const data: PklInput = {}
  if (!existing) {
    data.internship_id = params.id
    data.indicator_id = score.indicator_id
  }
  if (score.score_school !== undefined) data.score_school = score.score_school
  if (score.score_industry !== undefined) data.score_industry = score.score_industry
  if (score.notes !== undefined) data.notes = score.notes
  return {
    resource: 'assessment_scores',
    action: existing ? 'update' : 'create',
    id: existing?.id,
    data,
    access: params.access,
  }
}
export function assessmentTotals(indicators: PklRow[], scores: PklRow[]) {
  const definitions: AssessmentIndicatorItem[] = indicators.map((row) => ({
    id: row.id,
    name: z.string().parse(row.name),
    category: z.string().parse(row.category),
    weight: z.number().parse(row.weight),
    max_score: z.number().parse(row.max_score),
  }))
  const values: Record<string, ScoreInputItem> = Object.create(null)
  for (const row of scores) {
    const id = z.uuid().parse(row.indicator_id)
    values[id] = {
      score_school: z
        .number()
        .nullable()
        .parse(row.score_school ?? null),
      score_industry: z
        .number()
        .nullable()
        .parse(row.score_industry ?? null),
    }
  }
  const result = calculateWeightedAssessmentScores(definitions, values)
  return { final_score: result.final_score, grade: result.grade }
}
export function parseAssessment(params: PklAssessment): PklAssessment {
  const parsed = pklAssessmentSchema.safeParse({ scores: params.scores, notes: params.notes })
  if (!parsed.success) throw AppError.validationError(parsed.error.flatten())
  return { ...parsed.data, id: z.uuid().parse(params.id), access: params.access }
}

export function applicableAssessmentIndicators(
  params: PklAssessment,
  indicators: PklRow[],
  student: PklRow,
): PklRow[] {
  const applicable = indicators.filter(
    (row) => row.is_published === true && (!row.jurusan || row.jurusan === student.jurusan),
  )
  const ids = new Set(applicable.map((row) => row.id))
  if (params.scores.some((score) => !ids.has(score.indicator_id)))
    throw AppError.validationError('Assessment indicator is not applicable to this student.')
  return applicable
}
