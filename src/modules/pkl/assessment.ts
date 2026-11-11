export interface AssessmentIndicatorItem {
  id: string
  name: string
  category: string
  max_score: number
  weight: number
}

export interface ScoreInputItem {
  score_industry: number | null
  score_school: number | null
}

export interface CalculationResult {
  nilai_dudi: number | null
  nilai_guru: number | null
  final_score: number | null
  grade: 'A' | 'B' | 'C' | 'D' | null
  predicate_label: string
}

export function calculateIndicatorFinalScore(
  category: string,
  scoreIndustry: number | null,
  scoreSchool: number | null,
): number | null {
  const hasInd = scoreIndustry !== null && !isNaN(scoreIndustry)
  const hasSch = scoreSchool !== null && !isNaN(scoreSchool)

  if (!hasInd && !hasSch) return null

  if (category === 'industry') {
    return hasInd ? scoreIndustry : scoreSchool
  }
  if (category === 'supervisor') {
    return hasSch ? scoreSchool : scoreIndustry
  }

  if (hasInd && hasSch) {
    return (scoreIndustry! + scoreSchool!) / 2
  }
  return hasInd ? scoreIndustry : scoreSchool
}

export function calculateWeightedAssessmentScores(
  indicators: AssessmentIndicatorItem[],
  scoresMap: Record<string, ScoreInputItem>,
): CalculationResult {
  let totalWeightDudi = 0
  let sumDudi = 0

  let totalWeightSchool = 0
  let sumSchool = 0

  let totalWeightFinal = 0
  let sumFinal = 0

  for (const ind of indicators) {
    const w = ind.weight || 1.0
    const scoreItem = scoresMap[ind.id] || { score_industry: null, score_school: null }
    const sInd = scoreItem.score_industry
    const sSch = scoreItem.score_school

    if (sInd !== null && !isNaN(sInd)) {
      sumDudi += sInd * w
      totalWeightDudi += w
    }

    if (sSch !== null && !isNaN(sSch)) {
      sumSchool += sSch * w
      totalWeightSchool += w
    }

    const indFinal = calculateIndicatorFinalScore(ind.category, sInd, sSch)
    if (indFinal !== null && !isNaN(indFinal)) {
      sumFinal += indFinal * w
      totalWeightFinal += w
    }
  }

  const nilai_dudi = totalWeightDudi > 0 ? Number((sumDudi / totalWeightDudi).toFixed(2)) : null
  const nilai_guru =
    totalWeightSchool > 0 ? Number((sumSchool / totalWeightSchool).toFixed(2)) : null
  const final_score = totalWeightFinal > 0 ? Number((sumFinal / totalWeightFinal).toFixed(2)) : null

  const { grade, predicate_label } = getGradePredicate(final_score)

  return {
    nilai_dudi,
    nilai_guru,
    final_score,
    grade,
    predicate_label,
  }
}

export interface GradePredicate {
  grade: 'A' | 'B' | 'C' | 'D' | null
  predicate_label: string
}
export function getGradePredicate(score: number | null): GradePredicate {
  if (score === null || isNaN(score)) {
    return { grade: null, predicate_label: 'Belum Dinilai' }
  }
  if (score >= 90) return { grade: 'A', predicate_label: 'Sangat Baik' }
  if (score >= 80) return { grade: 'B', predicate_label: 'Baik' }
  if (score >= 70) return { grade: 'C', predicate_label: 'Cukup' }
  return { grade: 'D', predicate_label: 'Kurang' }
}
