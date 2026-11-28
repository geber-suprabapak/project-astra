import { createHash } from 'node:crypto'
import { AppError } from '../../lib/errors/app-error.js'
import type {
  AcademicPeriod,
  BatchClassMappingInput,
  BatchStudentOverrideInput,
  BatchTransitionClassMappingItem,
  BatchTransitionConflict,
  BatchTransitionMode,
  BatchTransitionPreview,
  BatchTransitionPreviewItem,
  BatchTransitionSummary,
  BatchTransitionUnmappedClass,
  CalendarException,
  ClassEnrollment,
  ClassRoom,
} from '../types.js'

export function clampDateToPeriod(dateYmd: string, startDate: string, endDate: string): string {
  if (dateYmd < startDate) return startDate
  if (dateYmd > endDate) return endDate
  return dateYmd
}

export function addDaysYmd(dateYmd: string, deltaDays: number): string {
  const ms = Date.parse(`${dateYmd.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(ms)) {
    throw AppError.validationError('Invalid YYYY-MM-DD date value.')
  }
  return new Date(ms + deltaDays * 86_400_000).toISOString().slice(0, 10)
}

export function expandDateRange(startDate: string, endDate: string, maxDays = 90): string[] {
  const startMs = Date.parse(`${startDate}T00:00:00Z`)
  const endMs = Date.parse(`${endDate}T00:00:00Z`)
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || startMs > endMs) {
    throw AppError.validationError('start_date must be less than or equal to end_date.')
  }
  const dayCount = Math.floor((endMs - startMs) / 86_400_000) + 1
  if (dayCount > maxDays) {
    throw AppError.validationError(`Date range cannot exceed ${maxDays} days.`)
  }
  const dates: string[] = []
  for (let i = 0; i < dayCount; i++) {
    dates.push(new Date(startMs + i * 86_400_000).toISOString().slice(0, 10))
  }
  return dates
}

export function resolveCalendarExceptionForDate(
  exceptions: readonly CalendarException[],
  academicPeriodId: string | null | undefined,
  date: string,
): CalendarException | null {
  const dateOnly = date.slice(0, 10)
  const matching = exceptions.filter((exc) => {
    if (exc.date.slice(0, 10) !== dateOnly) return false
    if (!academicPeriodId) return true
    return exc.academic_period_id == null || exc.academic_period_id === academicPeriodId
  })
  if (matching.length === 0) return null

  matching.sort((a, b) => {
    const aSpecific = academicPeriodId
      ? a.academic_period_id === academicPeriodId
        ? 0
        : 1
      : a.academic_period_id == null
        ? 0
        : 1
    const bSpecific = academicPeriodId
      ? b.academic_period_id === academicPeriodId
        ? 0
        : 1
      : b.academic_period_id == null
        ? 0
        : 1
    if (aSpecific !== bSpecific) return aSpecific - bSpecific
    return (b.updated_at ?? '').localeCompare(a.updated_at ?? '')
  })

  return matching[0] ?? null
}

function normalizeClassName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

export interface ParsedGradeAndSuffix {
  grade: number | null
  suffix: string
}

export function parseGradeAndSuffix(
  name: string,
  explicitGrade?: number | null,
): ParsedGradeAndSuffix {
  const cleaned = name.trim().replace(/\s+/g, ' ')
  const match = /^(XII|XI|X|12|11|10)\b\s*(.*)$/i.exec(cleaned)
  if (!match) {
    return {
      grade: explicitGrade ?? null,
      suffix: normalizeClassName(cleaned),
    }
  }
  const token = match[1]!.toUpperCase()
  const parsedGrade =
    token === 'X' || token === '10'
      ? 10
      : token === 'XI' || token === '11'
        ? 11
        : token === 'XII' || token === '12'
          ? 12
          : null
  return {
    grade: explicitGrade ?? parsedGrade,
    suffix: normalizeClassName(match[2] ?? ''),
  }
}

export function computeBatchSourceHash(params: {
  fromAcademicPeriodId: string
  toAcademicPeriodId: string
  sourceRows: readonly ClassEnrollment[]
  targetActiveRows: readonly ClassEnrollment[]
}): string {
  const normalize = (rows: readonly ClassEnrollment[]) =>
    rows
      .map((r) => [
        r.id,
        r.student_id ?? null,
        r.user_id ?? null,
        r.class_id,
        r.absence_number ?? null,
        r.updated_at ?? null,
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))

  const payload = JSON.stringify({
    from_academic_period_id: params.fromAcademicPeriodId,
    to_academic_period_id: params.toAcademicPeriodId,
    source_rows: normalize(params.sourceRows),
    target_active_rows: normalize(params.targetActiveRows),
  })
  return createHash('sha256').update(payload).digest('hex')
}

export interface PlannedBatchRow {
  enrollment: ClassEnrollment
  studentKey: string
  fromClass: ClassRoom
  toClass: ClassRoom | null
  action: 'promote' | 'continue' | 'retain' | 'transfer' | 'graduate' | 'exit'
  sourceExitStatus: 'promoted' | 'graduated' | 'archived'
  resolvedAbsenceNumber: string | null
  absenceNumberCleared: boolean
  conflict: { type: string; message: string } | null
}

export interface BuiltBatchTransitionPlan {
  preview: BatchTransitionPreview
  plannedRows: PlannedBatchRow[]
  effectiveStartDate: string
  effectiveEndDate: string
}

export function buildBatchTransitionPlan(params: {
  fromPeriod: AcademicPeriod
  toPeriod: AcademicPeriod
  mode: BatchTransitionMode
  fromClasses: readonly ClassRoom[]
  toClasses: readonly ClassRoom[]
  sourceActiveEnrollments: readonly ClassEnrollment[]
  targetActiveEnrollments: readonly ClassEnrollment[]
  classMappings?: readonly BatchClassMappingInput[]
  overrides?: readonly BatchStudentOverrideInput[]
  clearConflictingAbsenceNumbers?: boolean
  effectiveDate?: string
}): BuiltBatchTransitionPlan {
  const {
    fromPeriod,
    toPeriod,
    mode,
    fromClasses,
    toClasses,
    sourceActiveEnrollments,
    targetActiveEnrollments,
    classMappings,
    overrides,
    clearConflictingAbsenceNumbers = false,
    effectiveDate,
  } = params

  const fromClassMap = new Map(fromClasses.map((c) => [c.id, c]))
  const toClassMap = new Map(toClasses.map((c) => [c.id, c]))
  const explicitMappingByFromId = new Map((classMappings ?? []).map((m) => [m.from_class_id, m]))
  const overrideByStudentKey = new Map((overrides ?? []).map((o) => [o.student_id, o]))

  const activeCountByClass = new Map<string, number>()
  for (const enrollment of sourceActiveEnrollments) {
    activeCountByClass.set(
      enrollment.class_id,
      (activeCountByClass.get(enrollment.class_id) ?? 0) + 1,
    )
  }

  const resolvedClassMappings: BatchTransitionClassMappingItem[] = []
  const unmappedClasses: BatchTransitionUnmappedClass[] = []
  const mappingByFromId = new Map<
    string,
    { toClass: ClassRoom | null; action: 'promote' | 'continue' | 'graduate' }
  >()

  for (const fromCls of fromClasses) {
    const studentCount = activeCountByClass.get(fromCls.id) ?? 0
    const explicit = explicitMappingByFromId.get(fromCls.id)
    if (explicit) {
      const target = explicit.to_class_id ? (toClassMap.get(explicit.to_class_id) ?? null) : null
      if (explicit.action !== 'graduate' && (!explicit.to_class_id || !target)) {
        if (studentCount > 0) {
          unmappedClasses.push({
            class_id: fromCls.id,
            name: fromCls.name,
            grade: fromCls.grade ?? null,
            student_count: studentCount,
          })
        }
        mappingByFromId.set(fromCls.id, { toClass: null, action: explicit.action })
        resolvedClassMappings.push({
          from_class_id: fromCls.id,
          from_class_name: fromCls.name,
          from_grade: fromCls.grade ?? null,
          to_class_id: null,
          to_class_name: null,
          action: explicit.action,
          student_count: studentCount,
        })
      } else {
        const mappedTo = explicit.action === 'graduate' ? null : target
        mappingByFromId.set(fromCls.id, { toClass: mappedTo, action: explicit.action })
        resolvedClassMappings.push({
          from_class_id: fromCls.id,
          from_class_name: fromCls.name,
          from_grade: fromCls.grade ?? null,
          to_class_id: mappedTo?.id ?? null,
          to_class_name: mappedTo?.name ?? null,
          action: explicit.action,
          student_count: studentCount,
        })
      }
      continue
    }

    if (mode === 'continue_semester') {
      const targetName = normalizeClassName(fromCls.name)
      const matches = toClasses.filter(
        (c) =>
          normalizeClassName(c.name) === targetName &&
          (fromCls.grade == null || c.grade == null || c.grade === fromCls.grade),
      )
      const matched = matches.length === 1 ? matches[0]! : null
      if (!matched && studentCount > 0) {
        unmappedClasses.push({
          class_id: fromCls.id,
          name: fromCls.name,
          grade: fromCls.grade ?? null,
          student_count: studentCount,
        })
      }
      mappingByFromId.set(fromCls.id, { toClass: matched, action: 'continue' })
      resolvedClassMappings.push({
        from_class_id: fromCls.id,
        from_class_name: fromCls.name,
        from_grade: fromCls.grade ?? null,
        to_class_id: matched?.id ?? null,
        to_class_name: matched?.name ?? null,
        action: 'continue',
        student_count: studentCount,
      })
    } else {
      const parsed = parseGradeAndSuffix(fromCls.name, fromCls.grade)
      if (parsed.grade === 12) {
        mappingByFromId.set(fromCls.id, { toClass: null, action: 'graduate' })
        resolvedClassMappings.push({
          from_class_id: fromCls.id,
          from_class_name: fromCls.name,
          from_grade: parsed.grade,
          to_class_id: null,
          to_class_name: null,
          action: 'graduate',
          student_count: studentCount,
        })
      } else if (parsed.grade === 10 || parsed.grade === 11) {
        const nextGrade = parsed.grade + 1
        const matches = toClasses.filter((c) => {
          const cand = parseGradeAndSuffix(c.name, c.grade)
          return cand.grade === nextGrade && cand.suffix === parsed.suffix
        })
        const matched = matches.length === 1 ? matches[0]! : null
        if (!matched && studentCount > 0) {
          unmappedClasses.push({
            class_id: fromCls.id,
            name: fromCls.name,
            grade: parsed.grade,
            student_count: studentCount,
          })
        }
        mappingByFromId.set(fromCls.id, { toClass: matched, action: 'promote' })
        resolvedClassMappings.push({
          from_class_id: fromCls.id,
          from_class_name: fromCls.name,
          from_grade: parsed.grade,
          to_class_id: matched?.id ?? null,
          to_class_name: matched?.name ?? null,
          action: 'promote',
          student_count: studentCount,
        })
      } else {
        if (studentCount > 0) {
          unmappedClasses.push({
            class_id: fromCls.id,
            name: fromCls.name,
            grade: parsed.grade,
            student_count: studentCount,
          })
        }
        mappingByFromId.set(fromCls.id, { toClass: null, action: 'promote' })
        resolvedClassMappings.push({
          from_class_id: fromCls.id,
          from_class_name: fromCls.name,
          from_grade: parsed.grade,
          to_class_id: null,
          to_class_name: null,
          action: 'promote',
          student_count: studentCount,
        })
      }
    }
  }

  const targetByStudentId = new Set<string>()
  const targetByUserId = new Set<string>()
  const occupiedAbsenceKeys = new Set<string>()
  for (const row of targetActiveEnrollments) {
    if (row.student_id) targetByStudentId.add(row.student_id)
    if (row.user_id) targetByUserId.add(row.user_id)
    if (row.absence_number) {
      occupiedAbsenceKeys.add(`${row.class_id}:${row.absence_number}`)
    }
  }

  const plannedRows: PlannedBatchRow[] = []
  const batchAbsenceOccurrences = new Map<string, number>()

  for (const enrollment of sourceActiveEnrollments) {
    const fromClass = fromClassMap.get(enrollment.class_id) ?? {
      id: enrollment.class_id,
      school_id: fromPeriod.school_id,
      academic_period_id: fromPeriod.id,
      name: enrollment.class_name ?? 'Unknown',
      grade: null,
    }
    const studentKey = enrollment.student_id ?? enrollment.user_id ?? enrollment.id
    const override =
      (enrollment.student_id ? overrideByStudentKey.get(enrollment.student_id) : undefined) ??
      (enrollment.user_id ? overrideByStudentKey.get(enrollment.user_id) : undefined)

    let action: PlannedBatchRow['action']
    let toClass: ClassRoom | null = null
    let sourceExitStatus: PlannedBatchRow['sourceExitStatus'] = 'promoted'
    let conflict: { type: string; message: string } | null = null

    if (override) {
      if (override.action === 'exit') {
        action = 'exit'
        sourceExitStatus = override.exit_status ?? 'archived'
      } else {
        action = override.action
        toClass = override.to_class_id ? (toClassMap.get(override.to_class_id) ?? null) : null
        if (!toClass) {
          conflict = {
            type: 'missing_target_class',
            message: 'Target class in destination period is required for override.',
          }
        }
      }
    } else {
      const mapping = mappingByFromId.get(enrollment.class_id)
      if (!mapping) {
        action = mode === 'continue_semester' ? 'continue' : 'promote'
        conflict = {
          type: 'missing_target_class',
          message: `No target class mapping found for ${fromClass.name}.`,
        }
      } else if (mapping.action === 'graduate') {
        action = 'graduate'
        sourceExitStatus = 'graduated'
      } else {
        action = mapping.action
        toClass = mapping.toClass
        if (!toClass) {
          conflict = {
            type: 'missing_target_class',
            message: `No target class mapping found for ${fromClass.name}.`,
          }
        }
      }
    }

    const alreadyInTarget =
      (enrollment.student_id ? targetByStudentId.has(enrollment.student_id) : false) ||
      (enrollment.user_id ? targetByUserId.has(enrollment.user_id) : false)

    if (!conflict && action !== 'exit' && action !== 'graduate' && alreadyInTarget) {
      conflict = {
        type: 'target_already_enrolled',
        message: 'Student already has an active enrollment in target academic period.',
      }
    }

    const hasExplicitOverrideAbsence =
      override !== undefined && override.absence_number !== undefined
    const resolvedAbsenceNumber =
      action === 'exit' || action === 'graduate'
        ? null
        : hasExplicitOverrideAbsence
          ? (override.absence_number ?? null)
          : (enrollment.absence_number ?? null)

    if (!conflict && toClass && resolvedAbsenceNumber) {
      const key = `${toClass.id}:${resolvedAbsenceNumber}`
      batchAbsenceOccurrences.set(key, (batchAbsenceOccurrences.get(key) ?? 0) + 1)
    }

    plannedRows.push({
      enrollment,
      studentKey,
      fromClass,
      toClass,
      action,
      sourceExitStatus,
      resolvedAbsenceNumber,
      absenceNumberCleared: false,
      conflict,
    })
  }

  for (const row of plannedRows) {
    if (row.conflict || !row.toClass || !row.resolvedAbsenceNumber) continue
    const key = `${row.toClass.id}:${row.resolvedAbsenceNumber}`
    const collidesExisting = occupiedAbsenceKeys.has(key)
    const collidesIntraBatch = (batchAbsenceOccurrences.get(key) ?? 0) > 1
    if (collidesExisting || collidesIntraBatch) {
      const override =
        (row.enrollment.student_id
          ? overrideByStudentKey.get(row.enrollment.student_id)
          : undefined) ??
        (row.enrollment.user_id ? overrideByStudentKey.get(row.enrollment.user_id) : undefined)
      const explicitCustomAbsence = override !== undefined && override.absence_number !== undefined
      if (clearConflictingAbsenceNumbers && !explicitCustomAbsence) {
        row.resolvedAbsenceNumber = null
        row.absenceNumberCleared = true
      } else {
        row.conflict = {
          type: 'absence_number_conflict',
          message: `Absence number ${row.resolvedAbsenceNumber} conflicts in target class ${row.toClass.name}.`,
        }
      }
    }
  }

  const summary: BatchTransitionSummary = {
    total: plannedRows.length,
    promoted: 0,
    continued: 0,
    retained: 0,
    transferred: 0,
    graduated: 0,
    exited: 0,
    conflicts: 0,
    cleared_absence_numbers: 0,
  }

  const items: BatchTransitionPreviewItem[] = []
  const conflicts: BatchTransitionConflict[] = []

  for (const row of plannedRows) {
    if (row.action === 'promote') summary.promoted++
    else if (row.action === 'continue') summary.continued++
    else if (row.action === 'retain') summary.retained++
    else if (row.action === 'transfer') summary.transferred++
    else if (row.action === 'graduate') summary.graduated++
    else if (row.action === 'exit') summary.exited++

    if (row.absenceNumberCleared) summary.cleared_absence_numbers++
    if (row.conflict) {
      summary.conflicts++
      conflicts.push({
        student_id: row.studentKey,
        nis: row.enrollment.nis ?? null,
        full_name: row.enrollment.student_name ?? null,
        type: row.conflict.type,
        message: row.conflict.message,
      })
    }

    items.push({
      student_id: row.studentKey,
      user_id: row.enrollment.user_id ?? null,
      nis: row.enrollment.nis ?? null,
      full_name: row.enrollment.student_name ?? null,
      from_class_id: row.fromClass.id,
      from_class_name: row.fromClass.name,
      to_class_id: row.toClass?.id ?? null,
      to_class_name: row.toClass?.name ?? null,
      action: row.action,
      resolved_absence_number: row.resolvedAbsenceNumber,
      absence_number_cleared: row.absenceNumberCleared,
      conflict: row.conflict,
    })
  }

  const sourceHash = computeBatchSourceHash({
    fromAcademicPeriodId: fromPeriod.id,
    toAcademicPeriodId: toPeriod.id,
    sourceRows: sourceActiveEnrollments,
    targetActiveRows: targetActiveEnrollments,
  })

  const effectiveStartDate = effectiveDate ?? toPeriod.start_date
  const effectiveEndDate = fromPeriod.end_date

  return {
    preview: {
      source_hash: sourceHash,
      from_period: fromPeriod,
      to_period: toPeriod,
      requires_lock_override: Boolean(fromPeriod.is_locked || toPeriod.is_locked),
      summary,
      class_mappings: resolvedClassMappings,
      unmapped_classes: unmappedClasses,
      items,
      conflicts,
    },
    plannedRows,
    effectiveStartDate,
    effectiveEndDate,
  }
}
