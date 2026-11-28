import { randomUUID } from 'node:crypto'
import { AppError } from '../../lib/errors/app-error.js'
import {
  addDaysYmd,
  buildBatchTransitionPlan,
  clampDateToPeriod,
} from '../shared/academic-batch.js'
import {
  type AcademicPeriod,
  type BatchTransitionCommitParams,
  type BatchTransitionCommitResult,
  type BatchTransitionPreview,
  type BatchTransitionPreviewParams,
  type ClassEnrollment,
  type ClassEnrollmentStatus,
  type ClassRoom,
  type CreateAcademicPeriodParams,
  type CreateClassParams,
  type EnrollStudentParams,
  type ExitStudentEnrollmentParams,
  type LockAcademicPeriodParams,
  type PromoteStudentEnrollmentParams,
  type TransferStudentEnrollmentParams,
  type UnlockAcademicPeriodParams,
  type UpdateAcademicPeriodParams,
  type UpdateClassParams,
} from '../types.js'
import type { MemoryDomainState } from './domain-state.js'

function todayWib(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function assertPeriodUnlocked(
  period: AcademicPeriod,
  overrideLocked?: boolean,
  reason?: string,
): void {
  if (!period.is_locked) return
  if (overrideLocked === true && (reason?.trim().length ?? 0) >= 3) return
  throw AppError.conflict('Academic period is locked.', {
    reason_code: 'PERIOD_LOCKED',
    academic_period_id: period.id,
  })
}

function validateAbsenceNumber(
  absenceNumber: string | null | undefined,
): string | null | undefined {
  if (absenceNumber === undefined || absenceNumber === null) return absenceNumber
  const trimmed = absenceNumber.trim()
  if (!/^[1-9][0-9]*$/.test(trimmed)) {
    throw AppError.validationError('absence_number must be a positive integer string.')
  }
  return trimmed
}

function assertMemoryPeriodReadyForActivation(
  store: MemoryDomainState,
  schoolId: string,
  targetPeriodId: string | null,
  isLocked: boolean,
): void {
  if (isLocked && targetPeriodId) {
    throw AppError.conflict('Locked academic period cannot be activated.', {
      reason_code: 'PERIOD_LOCKED',
      academic_period_id: targetPeriodId,
    })
  }

  const schoolPeriodIds = new Set(
    store.academicPeriods.filter((p) => p.school_id === schoolId).map((p) => p.id),
  )
  const hasAnyEnrollment = store.classEnrollments.some((e) =>
    schoolPeriodIds.has(e.academic_period_id),
  )
  const hasAcceptedRoster = Array.from(store.rosterReports.values()).some(
    (r) => r.status === 'accepted' && (!r.school_id || r.school_id === schoolId),
  )
  const isNonBootstrap = hasAnyEnrollment || hasAcceptedRoster
  if (!isNonBootstrap) return

  const activeEnrollments = targetPeriodId
    ? store.classEnrollments.filter(
        (e) => e.academic_period_id === targetPeriodId && e.status === 'active',
      ).length
    : 0
  const activeSchedules = targetPeriodId
    ? Array.from(store.schedules.values()).filter(
        (s) =>
          s.is_active &&
          (!s.school_id || s.school_id === schoolId) &&
          (!s.academic_period_id || s.academic_period_id === targetPeriodId),
      ).length
    : 0

  if (activeEnrollments === 0 || activeSchedules === 0) {
    throw AppError.conflict('Target academic period is not ready for activation.', {
      reason_code: 'PERIOD_NOT_READY_FOR_ACTIVATION',
      target_period_id: targetPeriodId ?? 'new',
      active_enrollments: activeEnrollments,
      active_schedules: activeSchedules,
    })
  }
}

function syncMemoryProfilesForActivePeriod(store: MemoryDomainState, activePeriodId: string): void {
  const activeByUser = new Map<string, string>()
  for (const e of store.classEnrollments) {
    if (e.academic_period_id === activePeriodId && e.status === 'active' && e.user_id) {
      const cls = store.classes.find((c) => c.id === e.class_id)
      if (cls) activeByUser.set(e.user_id, cls.name)
    }
  }
  for (const [userId, profile] of store.profiles.entries()) {
    const className = activeByUser.get(userId)
    if (className !== undefined) {
      profile.class_name = className
      store.profiles.set(userId, profile)
    } else if (profile.role === 'student' && profile.class_name != null) {
      profile.class_name = null
      store.profiles.set(userId, profile)
    }
  }
}

interface ResolvedMemoryIdentity {
  studentId: string | null
  userId: string | null
}

function resolveMemoryIdentity(
  store: MemoryDomainState,
  input: { studentId?: string; userId?: string },
): ResolvedMemoryIdentity {
  if (input.studentId) {
    const student = store.students.get(input.studentId)
    if (!student) throw AppError.notFound('Student')
    let boundUserId: string | null = input.userId ?? null
    if (!boundUserId) {
      for (const binding of store.studentBindings.values()) {
        if (binding.student_id === input.studentId) {
          boundUserId = binding.user_id
          break
        }
      }
    }
    return { studentId: input.studentId, userId: boundUserId }
  }

  if (input.userId) {
    for (const binding of store.studentBindings.values()) {
      if (binding.user_id === input.userId) {
        return { studentId: binding.student_id, userId: input.userId }
      }
    }
    const existing = store.classEnrollments.find(
      (e) => e.user_id === input.userId && e.student_id != null,
    )
    return { studentId: existing?.student_id ?? null, userId: input.userId }
  }

  throw AppError.validationError('Either student_id or user_id is required.')
}

function assertMemoryAbsenceAvailable(
  store: MemoryDomainState,
  classId: string,
  academicPeriodId: string,
  absenceNumber: string | null | undefined,
): void {
  if (!absenceNumber) return
  const duplicate = store.classEnrollments.find(
    (e) =>
      e.class_id === classId &&
      e.academic_period_id === academicPeriodId &&
      e.status === 'active' &&
      e.absence_number === absenceNumber,
  )
  if (duplicate) {
    throw AppError.conflict('Absence number is already used in this class and academic period.', {
      reason_code: 'ABSENCE_NUMBER_CONFLICT',
      class_id: classId,
      academic_period_id: academicPeriodId,
      absence_number: absenceNumber,
    })
  }
}

export function listMemoryAcademicPeriods(
  store: MemoryDomainState,
  filter?: { isActive?: boolean },
): AcademicPeriod[] {
  let list = [...store.academicPeriods]
  if (filter?.isActive !== undefined) {
    list = list.filter((p) => p.is_active === filter.isActive)
  }
  return list.map((p) => ({ ...p }))
}

export function getMemoryAcademicPeriod(
  store: MemoryDomainState,
  id: string,
): AcademicPeriod | null {
  const p = store.academicPeriods.find((item) => item.id === id)
  return p ? { ...p } : null
}

export function getMemoryActiveAcademicPeriod(store: MemoryDomainState): AcademicPeriod | null {
  const period = store.academicPeriods.find((p) => p.is_active)
  if (!period) return null
  return { ...period }
}

export function createMemoryAcademicPeriod(
  store: MemoryDomainState,
  params: CreateAcademicPeriodParams,
): AcademicPeriod {
  if (params.startDate > params.endDate) {
    throw AppError.validationError('start_date must be less than or equal to end_date.')
  }
  const now = new Date().toISOString()
  const school = store.schools[0]
  const schoolId =
    params.schoolId ??
    school?.id ??
    store.academicPeriods[0]?.school_id ??
    '11111111-1111-1111-1111-111111111111'
  const isActive = params.isActive ?? false
  if (isActive) {
    assertMemoryPeriodReadyForActivation(store, schoolId, null, false)
    for (const p of store.academicPeriods) {
      if (p.school_id === schoolId || store.schools.length === 0) p.is_active = false
    }
  }
  const period: AcademicPeriod = {
    id: `period-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    school_id: schoolId,
    name: params.name,
    start_date: params.startDate,
    end_date: params.endDate,
    is_active: isActive,
    is_locked: false,
    locked_at: null,
    locked_by: null,
    lock_reason: null,
    created_at: now,
    updated_at: now,
  }
  store.academicPeriods.push(period)
  return { ...period }
}

export function updateMemoryAcademicPeriod(
  store: MemoryDomainState,
  id: string,
  params: UpdateAcademicPeriodParams,
): AcademicPeriod {
  const period = store.academicPeriods.find((p) => p.id === id)
  if (!period) throw AppError.notFound('Academic period')

  const effectiveStart = params.startDate ?? period.start_date
  const effectiveEnd = params.endDate ?? period.end_date
  if (effectiveStart > effectiveEnd) {
    throw AppError.validationError('start_date must be less than or equal to end_date.')
  }

  const modifiesCore =
    params.name !== undefined || params.startDate !== undefined || params.endDate !== undefined
  if (period.is_locked && modifiesCore) {
    assertPeriodUnlocked(period, params.overrideLocked, params.reason)
  }

  if (params.isActive === false && period.is_active) {
    throw AppError.conflict('Cannot deactivate the currently active academic period.', {
      reason_code: 'CANNOT_DEACTIVATE_ACTIVE_PERIOD',
      academic_period_id: id,
    })
  }

  if (params.isActive === true && !period.is_active) {
    assertMemoryPeriodReadyForActivation(
      store,
      period.school_id,
      period.id,
      Boolean(period.is_locked),
    )
    for (const p of store.academicPeriods) {
      if (p.school_id === period.school_id) p.is_active = false
    }
  }
  if (params.name !== undefined) period.name = params.name
  if (params.startDate !== undefined) period.start_date = params.startDate
  if (params.endDate !== undefined) period.end_date = params.endDate
  if (params.isActive !== undefined) period.is_active = params.isActive
  period.updated_at = new Date().toISOString()

  if (params.isActive === true) {
    syncMemoryProfilesForActivePeriod(store, period.id)
  }
  return { ...period }
}

export function setMemoryActiveAcademicPeriod(
  store: MemoryDomainState,
  id: string,
): AcademicPeriod {
  const period = store.academicPeriods.find((p) => p.id === id)
  if (!period) throw AppError.notFound('Academic period')

  assertMemoryPeriodReadyForActivation(
    store,
    period.school_id,
    period.id,
    Boolean(period.is_locked),
  )

  const now = new Date().toISOString()
  for (const p of store.academicPeriods) {
    if (p.school_id === period.school_id) {
      p.is_active = p.id === id
      p.updated_at = now
    }
  }
  syncMemoryProfilesForActivePeriod(store, period.id)
  return { ...period }
}

export function lockMemoryAcademicPeriod(
  store: MemoryDomainState,
  params: LockAcademicPeriodParams,
): AcademicPeriod {
  const period = store.academicPeriods.find((p) => p.id === params.id)
  if (!period) throw AppError.notFound('Academic period')
  if (period.is_locked) {
    throw AppError.conflict('Academic period is already locked.', {
      reason_code: 'PERIOD_ALREADY_LOCKED',
      academic_period_id: params.id,
    })
  }
  const now = new Date().toISOString()
  period.is_locked = true
  period.locked_at = now
  period.locked_by = params.lockedBy
  period.lock_reason = params.reason
  period.updated_at = now
  return { ...period }
}

export function unlockMemoryAcademicPeriod(
  store: MemoryDomainState,
  params: UnlockAcademicPeriodParams,
): AcademicPeriod {
  const period = store.academicPeriods.find((p) => p.id === params.id)
  if (!period) throw AppError.notFound('Academic period')
  if (!period.is_locked) {
    throw AppError.conflict('Academic period is not locked.', {
      reason_code: 'PERIOD_NOT_LOCKED',
      academic_period_id: params.id,
    })
  }
  period.is_locked = false
  period.locked_at = null
  period.locked_by = null
  period.lock_reason = null
  period.updated_at = new Date().toISOString()
  return { ...period }
}

export function getMemoryClasses(
  store: MemoryDomainState,
  schoolId?: string,
  academicPeriodId?: string,
): ClassRoom[] {
  let list = [...store.classes]
  if (schoolId) list = list.filter((c) => c.school_id === schoolId)
  if (academicPeriodId) list = list.filter((c) => c.academic_period_id === academicPeriodId)
  return list.map((c) => ({ ...c }))
}

export function getMemoryClassById(store: MemoryDomainState, id: string): ClassRoom | null {
  const cls = store.classes.find((c) => c.id === id)
  return cls ? { ...cls } : null
}

export function createMemoryClass(store: MemoryDomainState, params: CreateClassParams): ClassRoom {
  const now = new Date().toISOString()
  const school = store.schools[0]
  const schoolId =
    params.schoolId ??
    school?.id ??
    store.academicPeriods[0]?.school_id ??
    '11111111-1111-1111-1111-111111111111'
  const cls: ClassRoom = {
    id: `class-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    school_id: schoolId,
    academic_period_id: params.academicPeriodId ?? null,
    name: params.name,
    grade: params.grade ?? null,
    created_at: now,
    updated_at: now,
  }
  store.classes.push(cls)
  return { ...cls }
}

export function updateMemoryClass(
  store: MemoryDomainState,
  id: string,
  params: UpdateClassParams,
): ClassRoom {
  const cls = store.classes.find((c) => c.id === id)
  if (!cls) throw AppError.notFound('Class')
  if (params.name !== undefined) cls.name = params.name
  if (params.grade !== undefined) cls.grade = params.grade
  if (params.academicPeriodId !== undefined) cls.academic_period_id = params.academicPeriodId
  cls.updated_at = new Date().toISOString()
  return { ...cls }
}

export function deleteMemoryClass(
  store: MemoryDomainState,
  id: string,
  options?: { overrideLocked?: boolean; reason?: string },
): void {
  const idx = store.classes.findIndex((c) => c.id === id)
  if (idx === -1) throw AppError.notFound('Class')
  const cls = store.classes[idx]!
  if (cls.academic_period_id) {
    const period = store.academicPeriods.find((p) => p.id === cls.academic_period_id)
    if (period) {
      assertPeriodUnlocked(period, options?.overrideLocked, options?.reason)
    }
  }
  const hasEnrollment = store.classEnrollments.some((e) => e.class_id === id)
  const hasSchedule = Array.from(store.schedules.values()).some((s) => s.class_id === id)
  const hasSite = Array.from(store.adiwiyataSites.values()).some((s) => s.class_id === id)
  if (hasEnrollment || hasSchedule || hasSite) {
    throw AppError.conflict('Class is still referenced by enrollments, schedules, or sites.', {
      reason_code: 'CLASS_IN_USE',
      class_id: id,
    })
  }
  store.classes.splice(idx, 1)
}

function hydrateEnrollment(store: MemoryDomainState, enrollment: ClassEnrollment): ClassEnrollment {
  const cls = store.classes.find((c) => c.id === enrollment.class_id)
  const prof = enrollment.user_id ? store.profiles.get(enrollment.user_id) : null
  const student = enrollment.student_id ? store.students.get(enrollment.student_id) : null
  const period = store.academicPeriods.find((p) => p.id === enrollment.academic_period_id)
  return {
    ...enrollment,
    effective_start_date: enrollment.effective_start_date ?? null,
    effective_end_date: enrollment.effective_end_date ?? null,
    class_name: cls?.name ?? null,
    student_name: student?.full_name ?? prof?.full_name ?? null,
    nis: student?.nis ?? prof?.nis ?? null,
    absence_number: enrollment.absence_number ?? prof?.absence_number ?? null,
    period_name: period?.name ?? null,
  }
}

export function listMemoryClassEnrollments(
  store: MemoryDomainState,
  filter?: {
    studentId?: string
    userId?: string
    classId?: string
    academicPeriodId?: string
    status?: ClassEnrollmentStatus
  },
): ClassEnrollment[] {
  let list = [...store.classEnrollments]
  if (filter?.studentId) list = list.filter((e) => e.student_id === filter.studentId)
  if (filter?.userId) list = list.filter((e) => e.user_id === filter.userId)
  if (filter?.classId) list = list.filter((e) => e.class_id === filter.classId)
  if (filter?.academicPeriodId)
    list = list.filter((e) => e.academic_period_id === filter.academicPeriodId)
  if (filter?.status) list = list.filter((e) => e.status === filter.status)

  return list.map((e) => hydrateEnrollment(store, e))
}

export function getMemoryActiveClassEnrollment(
  store: MemoryDomainState,
  userId: string,
  academicPeriodId?: string,
): ClassEnrollment | null {
  const periodId = academicPeriodId ?? store.academicPeriods.find((p) => p.is_active)?.id
  if (!periodId) return null
  const enrollment = store.classEnrollments.find(
    (e) => e.user_id === userId && e.academic_period_id === periodId && e.status === 'active',
  )
  if (!enrollment) return null
  return hydrateEnrollment(store, enrollment)
}

export function enrollMemoryStudentInClass(
  store: MemoryDomainState,
  params: EnrollStudentParams,
): ClassEnrollment {
  const absenceNumber = validateAbsenceNumber(params.absenceNumber)
  const cls = store.classes.find((c) => c.id === params.classId)
  if (!cls) throw AppError.notFound('Class')
  const period = store.academicPeriods.find((p) => p.id === params.academicPeriodId)
  if (!period) throw AppError.notFound('Academic period')
  assertPeriodUnlocked(period, params.overrideLocked, params.reason)

  const identity = resolveMemoryIdentity(store, {
    studentId: params.studentId,
    userId: params.userId,
  })

  const existingActive = store.classEnrollments.find(
    (e) =>
      e.academic_period_id === params.academicPeriodId &&
      e.status === 'active' &&
      ((identity.studentId && e.student_id === identity.studentId) ||
        (identity.userId && e.user_id === identity.userId)),
  )
  if (existingActive) {
    throw AppError.conflict(
      'Student already has an active class enrollment in this academic period.',
    )
  }

  assertMemoryAbsenceAvailable(store, params.classId, params.academicPeriodId, absenceNumber)

  const now = new Date().toISOString()
  const effectiveStart =
    params.effectiveDate ?? clampDateToPeriod(todayWib(), period.start_date, period.end_date)

  const enrollment: ClassEnrollment = {
    id: `enrollment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    student_id: identity.studentId,
    user_id: identity.userId,
    class_id: params.classId,
    academic_period_id: params.academicPeriodId,
    absence_number: absenceNumber ?? null,
    status: 'active',
    effective_start_date: effectiveStart,
    effective_end_date: null,
    created_at: now,
    updated_at: now,
  }
  store.classEnrollments.push(enrollment)

  if (identity.userId && period.is_active) {
    const profile = store.profiles.get(identity.userId)
    if (profile) {
      profile.class_name = cls.name
      store.profiles.set(identity.userId, profile)
    }
  }

  return hydrateEnrollment(store, enrollment)
}

export function transferMemoryStudentEnrollment(
  store: MemoryDomainState,
  params: TransferStudentEnrollmentParams,
) {
  const requestedAbsence = validateAbsenceNumber(params.absenceNumber)
  const targetClass = store.classes.find((c) => c.id === params.toClassId)
  if (!targetClass) throw AppError.notFound('Target class')
  const period = store.academicPeriods.find((p) => p.id === params.academicPeriodId)
  if (!period) throw AppError.notFound('Academic period')
  assertPeriodUnlocked(period, params.overrideLocked, params.reason)

  const identity = resolveMemoryIdentity(store, {
    studentId: params.studentId,
    userId: params.userId,
  })

  const currentActive = store.classEnrollments.find(
    (e) =>
      e.academic_period_id === params.academicPeriodId &&
      e.status === 'active' &&
      ((identity.studentId && e.student_id === identity.studentId) ||
        (identity.userId && e.user_id === identity.userId)),
  )
  if (!currentActive) {
    throw AppError.notFound('Active class enrollment in this academic period')
  }
  if (currentActive.class_id === params.toClassId) {
    throw AppError.validationError('Target class must be different from current class.')
  }

  const nextAbsenceNumber =
    requestedAbsence !== undefined ? requestedAbsence : (currentActive.absence_number ?? null)
  assertMemoryAbsenceAvailable(store, params.toClassId, params.academicPeriodId, nextAbsenceNumber)

  const effectiveDate = params.effectiveDate ?? todayWib()
  const prevStart = currentActive.effective_start_date ?? period.start_date
  const candidateEnd = addDaysYmd(effectiveDate, -1)
  const prevEnd = candidateEnd > prevStart ? candidateEnd : prevStart

  const now = new Date().toISOString()
  currentActive.status = 'transferred'
  currentActive.effective_end_date = prevEnd
  currentActive.updated_at = now

  const resolvedUserId = currentActive.user_id ?? identity.userId ?? null
  const resolvedStudentId = currentActive.student_id ?? identity.studentId ?? null

  const newEnrollment: ClassEnrollment = {
    id: `enrollment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    student_id: resolvedStudentId,
    user_id: resolvedUserId,
    class_id: params.toClassId,
    academic_period_id: params.academicPeriodId,
    absence_number: nextAbsenceNumber,
    status: 'active',
    effective_start_date: effectiveDate,
    effective_end_date: null,
    created_at: now,
    updated_at: now,
  }
  store.classEnrollments.push(newEnrollment)

  if (resolvedUserId && period.is_active) {
    const profile = store.profiles.get(resolvedUserId)
    if (profile) {
      profile.class_name = targetClass.name
      store.profiles.set(resolvedUserId, profile)
    }
  }

  return {
    previous: { ...currentActive },
    current: hydrateEnrollment(store, newEnrollment),
  }
}

export function promoteMemoryStudentEnrollment(
  store: MemoryDomainState,
  params: PromoteStudentEnrollmentParams,
) {
  const requestedAbsence = validateAbsenceNumber(params.absenceNumber)
  const targetClass = store.classes.find((c) => c.id === params.toClassId)
  if (!targetClass) throw AppError.notFound('Target class')
  const fromPeriod = store.academicPeriods.find((p) => p.id === params.fromAcademicPeriodId)
  if (!fromPeriod) throw AppError.notFound('Source academic period')
  const targetPeriod = store.academicPeriods.find((p) => p.id === params.toAcademicPeriodId)
  if (!targetPeriod) throw AppError.notFound('Target academic period')

  assertPeriodUnlocked(fromPeriod, params.overrideLocked, params.reason)
  assertPeriodUnlocked(targetPeriod, params.overrideLocked, params.reason)

  const identity = resolveMemoryIdentity(store, {
    studentId: params.studentId,
    userId: params.userId,
  })

  const sourceActive = store.classEnrollments.find(
    (e) =>
      e.academic_period_id === params.fromAcademicPeriodId &&
      e.status === 'active' &&
      ((identity.studentId && e.student_id === identity.studentId) ||
        (identity.userId && e.user_id === identity.userId)),
  )
  if (!sourceActive) {
    throw AppError.notFound('Active class enrollment in source academic period')
  }
  const existingTarget = store.classEnrollments.find(
    (e) =>
      e.academic_period_id === params.toAcademicPeriodId &&
      e.status === 'active' &&
      ((identity.studentId && e.student_id === identity.studentId) ||
        (identity.userId && e.user_id === identity.userId)),
  )
  if (existingTarget) {
    throw AppError.conflict(
      'Student already has an active class enrollment in target academic period.',
    )
  }

  const nextAbsenceNumber =
    requestedAbsence !== undefined ? requestedAbsence : (sourceActive.absence_number ?? null)
  assertMemoryAbsenceAvailable(
    store,
    params.toClassId,
    params.toAcademicPeriodId,
    nextAbsenceNumber,
  )

  const sourceStart = sourceActive.effective_start_date ?? fromPeriod.start_date
  const sourceEnd = fromPeriod.end_date >= sourceStart ? fromPeriod.end_date : sourceStart
  const targetStart = params.effectiveDate ?? targetPeriod.start_date

  const now = new Date().toISOString()
  sourceActive.status = 'promoted'
  sourceActive.effective_end_date = sourceEnd
  sourceActive.updated_at = now

  const resolvedUserId = sourceActive.user_id ?? identity.userId ?? null
  const resolvedStudentId = sourceActive.student_id ?? identity.studentId ?? null

  const newEnrollment: ClassEnrollment = {
    id: `enrollment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    student_id: resolvedStudentId,
    user_id: resolvedUserId,
    class_id: params.toClassId,
    academic_period_id: params.toAcademicPeriodId,
    absence_number: nextAbsenceNumber,
    status: 'active',
    effective_start_date: targetStart,
    effective_end_date: null,
    created_at: now,
    updated_at: now,
  }
  store.classEnrollments.push(newEnrollment)

  if (resolvedUserId && targetPeriod.is_active) {
    const profile = store.profiles.get(resolvedUserId)
    if (profile) {
      profile.class_name = targetClass.name
      store.profiles.set(resolvedUserId, profile)
    }
  }

  return {
    previous: { ...sourceActive },
    current: hydrateEnrollment(store, newEnrollment),
  }
}

export function exitMemoryStudentEnrollment(
  store: MemoryDomainState,
  params: ExitStudentEnrollmentParams,
): ClassEnrollment {
  const period = store.academicPeriods.find((p) => p.id === params.academicPeriodId)
  if (!period) throw AppError.notFound('Academic period')
  assertPeriodUnlocked(period, params.overrideLocked, params.reason)

  const identity = resolveMemoryIdentity(store, {
    studentId: params.studentId,
    userId: params.userId,
  })

  const active = store.classEnrollments.find(
    (e) =>
      e.academic_period_id === params.academicPeriodId &&
      e.status === 'active' &&
      ((identity.studentId && e.student_id === identity.studentId) ||
        (identity.userId && e.user_id === identity.userId)),
  )
  if (!active) throw AppError.notFound('Active class enrollment')

  const status = params.status ?? 'archived'
  const effectiveDate = params.effectiveDate ?? todayWib()
  const startDate = active.effective_start_date ?? period.start_date
  const endDate = effectiveDate >= startDate ? effectiveDate : startDate

  active.status = status
  active.effective_end_date = endDate
  active.updated_at = new Date().toISOString()

  const resolvedUserId = active.user_id ?? identity.userId ?? null
  if (resolvedUserId && (period.is_active || status === 'graduated')) {
    const profile = store.profiles.get(resolvedUserId)
    if (profile) {
      profile.class_name = null
      store.profiles.set(resolvedUserId, profile)
    }
  }

  return { ...active }
}

function loadMemoryBatchPlan(store: MemoryDomainState, params: BatchTransitionPreviewParams) {
  if (params.fromAcademicPeriodId === params.toAcademicPeriodId) {
    throw AppError.validationError('Source and target academic periods must differ.')
  }
  const fromPeriod = getMemoryAcademicPeriod(store, params.fromAcademicPeriodId)
  if (!fromPeriod) throw AppError.notFound('Source academic period')
  const toPeriod = getMemoryAcademicPeriod(store, params.toAcademicPeriodId)
  if (!toPeriod) throw AppError.notFound('Target academic period')

  const fromClasses = getMemoryClasses(store, undefined, fromPeriod.id)
  const toClasses = getMemoryClasses(store, undefined, toPeriod.id)
  const sourceActiveEnrollments = listMemoryClassEnrollments(store, {
    academicPeriodId: fromPeriod.id,
    status: 'active',
  })
  const targetActiveEnrollments = listMemoryClassEnrollments(store, {
    academicPeriodId: toPeriod.id,
    status: 'active',
  })

  return buildBatchTransitionPlan({
    fromPeriod,
    toPeriod,
    mode: params.mode,
    fromClasses,
    toClasses,
    sourceActiveEnrollments,
    targetActiveEnrollments,
    classMappings: params.classMappings,
    overrides: params.overrides,
    clearConflictingAbsenceNumbers: params.clearConflictingAbsenceNumbers,
    effectiveDate: params.effectiveDate,
  })
}

export function previewMemoryBatchEnrollmentTransition(
  store: MemoryDomainState,
  params: BatchTransitionPreviewParams,
): BatchTransitionPreview {
  return loadMemoryBatchPlan(store, params).preview
}

export function commitMemoryBatchEnrollmentTransition(
  store: MemoryDomainState,
  params: BatchTransitionCommitParams,
): BatchTransitionCommitResult {
  const built = loadMemoryBatchPlan(store, params)
  if (built.preview.source_hash !== params.sourceHash) {
    throw AppError.conflict('Enrollment state changed since preview. Please refresh the preview.', {
      reason_code: 'STALE_PREVIEW',
      expected_source_hash: built.preview.source_hash,
    })
  }

  if (built.preview.requires_lock_override) {
    const reason = params.reason?.trim() ?? ''
    if (params.overrideLocked !== true || reason.length < 3) {
      throw AppError.conflict('One or more academic periods are locked.', {
        reason_code: 'PERIOD_LOCKED',
        academic_period_id: built.preview.from_period.is_locked
          ? built.preview.from_period.id
          : built.preview.to_period.id,
      })
    }
  }

  if (built.preview.unmapped_classes.length > 0 || built.preview.conflicts.length > 0) {
    throw AppError.conflict(
      'Batch transition cannot commit while unmapped classes or conflicts remain.',
      {
        reason_code: 'BATCH_TRANSITION_CONFLICT',
        conflicts_count: built.preview.conflicts.length,
        unmapped_count: built.preview.unmapped_classes.length,
      },
    )
  }

  const now = new Date().toISOString()
  let createdCount = 0

  for (const planned of built.plannedRows) {
    const sourceRow = store.classEnrollments.find((e) => e.id === planned.enrollment.id)
    if (!sourceRow) continue
    const startDate = sourceRow.effective_start_date ?? built.preview.from_period.start_date
    sourceRow.status = planned.sourceExitStatus
    sourceRow.effective_end_date =
      built.effectiveEndDate >= startDate ? built.effectiveEndDate : startDate
    sourceRow.updated_at = now

    if (planned.toClass) {
      store.classEnrollments.push({
        id: `enrollment-${randomUUID()}`,
        student_id: sourceRow.student_id ?? null,
        user_id: sourceRow.user_id ?? null,
        class_id: planned.toClass.id,
        academic_period_id: built.preview.to_period.id,
        absence_number: planned.resolvedAbsenceNumber,
        status: 'active',
        effective_start_date: built.effectiveStartDate,
        effective_end_date: null,
        created_at: now,
        updated_at: now,
      })
      createdCount++
      if (sourceRow.user_id && built.preview.to_period.is_active) {
        const profile = store.profiles.get(sourceRow.user_id)
        if (profile) {
          profile.class_name = planned.toClass.name
          store.profiles.set(sourceRow.user_id, profile)
        }
      }
    } else if (
      sourceRow.user_id &&
      (built.preview.from_period.is_active || planned.sourceExitStatus === 'graduated')
    ) {
      const profile = store.profiles.get(sourceRow.user_id)
      if (profile) {
        profile.class_name = null
        store.profiles.set(sourceRow.user_id, profile)
      }
    }
  }

  return {
    from_academic_period_id: built.preview.from_period.id,
    to_academic_period_id: built.preview.to_period.id,
    mode: params.mode,
    source_hash: built.preview.source_hash,
    summary: built.preview.summary,
    created_count: createdCount,
    closed_count: built.plannedRows.length,
  }
}
