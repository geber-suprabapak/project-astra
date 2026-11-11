import { pklSchoolDate } from '../../src/modules/pkl/attendance.js'
import { describe, expect, it } from 'vitest'
import {
  calculateIndicatorFinalScore,
  calculateWeightedAssessmentScores,
} from '../../src/modules/pkl/assessment.js'
import { completePklWrite } from '../../src/modules/pkl/resources.js'
import type { CmsSession } from '../../src/modules/cms/schema.js'

describe('preserved SiPKL assessment calculation', () => {
  it.each([
    ['industry', 90, 80, 90],
    ['supervisor', 90, 80, 80],
    ['combined', 90, 80, 85],
    ['industry', null, 80, 80],
    ['supervisor', 90, null, 90],
    ['combined', null, null, null],
  ])('calculates %s with industry=%s school=%s', (category, industry, school, expected) => {
    expect(calculateIndicatorFinalScore(String(category), industry, school)).toBe(expected)
  })
  it('preserves indicator weights and grade thresholds', () => {
    const result = calculateWeightedAssessmentScores(
      [
        { id: 'one', name: 'One', category: 'combined', weight: 1, max_score: 100 },
        { id: 'two', name: 'Two', category: 'industry', weight: 3, max_score: 100 },
      ],
      {
        one: { score_industry: 80, score_school: 60 },
        two: { score_industry: 90, score_school: null },
      },
    )
    expect(result.final_score).toBe(85)
    expect(result.grade).toBe('B')
  })
  it('clears a score explicitly instead of restoring the previous value', () => {
    const access: CmsSession = {
      id: 'actor',
      role: 'guru',
      full_name: null,
      email: null,
      jurusan_id: null,
      jurusan_slug: null,
      authz_version: 1,
    }
    const data = { score_school: null }
    completePklWrite(
      { resource: 'assessment_scores', action: 'update', access, data },
      data,
      { id: 'score', score_school: 80, score_industry: 90 },
      { id: 'indicator', category: 'combined' },
    )
    expect(data).toMatchObject({ score_school: null, supervisor_score: null, final_score: 90 })
  })
})

it('uses the school day in Magelang across the UTC date boundary', () => {
  expect(pklSchoolDate(new Date('2026-11-04T16:59:59Z'))).toBe('2026-11-04')
  expect(pklSchoolDate(new Date('2026-11-04T17:00:00Z'))).toBe('2026-11-05')
})
