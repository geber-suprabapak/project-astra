import { AppError } from '../../lib/errors/app-error.js'
import type {
  AcademicPeriod,
  ClassEnrollment,
  ClassEnrollmentStatus,
  ClassRoom,
  CreateAcademicPeriodParams,
  CreateClassParams,
  EnrollStudentParams,
  ExitStudentEnrollmentParams,
  PromoteStudentEnrollmentParams,
  TransferStudentEnrollmentParams,
  UpdateAcademicPeriodParams,
  UpdateClassParams,
} from '../types.js'
import type { MemoryDomainState } from './domain-state.js'

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
  const now = new Date().toISOString()
  const school = store.schools[0]
  const schoolId = params.schoolId ?? school?.id ?? 'school-default'
  if (params.isActive) {
    for (const p of store.academicPeriods) {
      p.is_active = false
    }
  }
  const period: AcademicPeriod = {
    id: `period-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    school_id: schoolId,
    name: params.name,
    start_date: params.startDate,
    end_date: params.endDate,
    is_active: params.isActive ?? true,
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
  if (params.isActive === true) {
    for (const p of store.academicPeriods) {
      p.is_active = false
    }
  }
  if (params.name !== undefined) period.name = params.name
  if (params.startDate !== undefined) period.start_date = params.startDate
  if (params.endDate !== undefined) period.end_date = params.endDate
  if (params.isActive !== undefined) period.is_active = params.isActive
  period.updated_at = new Date().toISOString()
  return { ...period }
}

export function setMemoryActiveAcademicPeriod(
  store: MemoryDomainState,
  id: string,
): AcademicPeriod {
  const period = store.academicPeriods.find((p) => p.id === id)
  if (!period) throw AppError.notFound('Academic period')
  for (const p of store.academicPeriods) {
    p.is_active = p.id === id
    p.updated_at = new Date().toISOString()
  }
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
  const schoolId = params.schoolId ?? school?.id ?? 'school-default'
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

function hydrateEnrollment(store: MemoryDomainState, enrollment: ClassEnrollment): ClassEnrollment {
  const cls = store.classes.find((c) => c.id === enrollment.class_id)
  const prof = enrollment.user_id ? store.profiles.get(enrollment.user_id) : null
  const student = enrollment.student_id ? store.students.get(enrollment.student_id) : null
  const period = store.academicPeriods.find((p) => p.id === enrollment.academic_period_id)
  return {
    ...enrollment,
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
    userId?: string
    classId?: string
    academicPeriodId?: string
    status?: ClassEnrollmentStatus
  },
): ClassEnrollment[] {
  let list = [...store.classEnrollments]
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
  const existingActive = store.classEnrollments.find(
    (e) =>
      e.user_id === params.userId &&
      e.academic_period_id === params.academicPeriodId &&
      e.status === 'active',
  )
  if (existingActive) {
    throw AppError.conflict(
      'Student already has an active class enrollment in this academic period.',
    )
  }
  const cls = store.classes.find((c) => c.id === params.classId)
  if (!cls) throw AppError.notFound('Class')
  const period = store.academicPeriods.find((p) => p.id === params.academicPeriodId)
  if (!period) throw AppError.notFound('Academic period')

  const now = new Date().toISOString()
  const enrollment: ClassEnrollment = {
    id: `enrollment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    user_id: params.userId,
    class_id: params.classId,
    academic_period_id: params.academicPeriodId,
    status: 'active',
    created_at: now,
    updated_at: now,
  }
  store.classEnrollments.push(enrollment)

  const profile = store.profiles.get(params.userId)
  if (profile) {
    profile.class_name = cls.name
    store.profiles.set(params.userId, profile)
  }

  return {
    ...enrollment,
    class_name: cls.name,
    period_name: period.name,
  }
}

export function transferMemoryStudentEnrollment(
  store: MemoryDomainState,
  params: TransferStudentEnrollmentParams,
) {
  const currentActive = store.classEnrollments.find(
    (e) =>
      e.user_id === params.userId &&
      e.academic_period_id === params.academicPeriodId &&
      e.status === 'active',
  )
  if (!currentActive) {
    throw AppError.notFound('Active class enrollment in this academic period')
  }
  if (currentActive.class_id === params.toClassId) {
    throw AppError.validationError('Target class must be different from current class.')
  }
  const targetClass = store.classes.find((c) => c.id === params.toClassId)
  if (!targetClass) throw AppError.notFound('Target class')

  const now = new Date().toISOString()
  currentActive.status = 'transferred'
  currentActive.updated_at = now

  const newEnrollment: ClassEnrollment = {
    id: `enrollment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    student_id: currentActive.student_id,
    user_id: params.userId,
    class_id: params.toClassId,
    academic_period_id: params.academicPeriodId,
    absence_number: currentActive.absence_number,
    status: 'active',
    created_at: now,
    updated_at: now,
  }
  store.classEnrollments.push(newEnrollment)

  const profile = store.profiles.get(params.userId)
  if (profile) {
    profile.class_name = targetClass.name
    store.profiles.set(params.userId, profile)
  }

  return {
    previous: { ...currentActive },
    current: {
      ...newEnrollment,
      class_name: targetClass.name,
    },
  }
}

export function promoteMemoryStudentEnrollment(
  store: MemoryDomainState,
  params: PromoteStudentEnrollmentParams,
) {
  const sourceActive = store.classEnrollments.find(
    (e) =>
      e.user_id === params.userId &&
      e.academic_period_id === params.fromAcademicPeriodId &&
      e.status === 'active',
  )
  if (!sourceActive) {
    throw AppError.notFound('Active class enrollment in source academic period')
  }
  const existingTarget = store.classEnrollments.find(
    (e) =>
      e.user_id === params.userId &&
      e.academic_period_id === params.toAcademicPeriodId &&
      e.status === 'active',
  )
  if (existingTarget) {
    throw AppError.conflict(
      'Student already has an active class enrollment in target academic period.',
    )
  }
  const targetClass = store.classes.find((c) => c.id === params.toClassId)
  if (!targetClass) throw AppError.notFound('Target class')
  const targetPeriod = store.academicPeriods.find((p) => p.id === params.toAcademicPeriodId)
  if (!targetPeriod) throw AppError.notFound('Target academic period')

  const now = new Date().toISOString()
  sourceActive.status = 'promoted'
  sourceActive.updated_at = now

  const newEnrollment: ClassEnrollment = {
    id: `enrollment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    student_id: sourceActive.student_id,
    user_id: params.userId,
    class_id: params.toClassId,
    academic_period_id: params.toAcademicPeriodId,
    absence_number: sourceActive.absence_number,
    status: 'active',
    created_at: now,
    updated_at: now,
  }
  store.classEnrollments.push(newEnrollment)

  const profile = store.profiles.get(params.userId)
  if (profile) {
    profile.class_name = targetClass.name
    store.profiles.set(params.userId, profile)
  }

  return {
    previous: { ...sourceActive },
    current: {
      ...newEnrollment,
      class_name: targetClass.name,
      period_name: targetPeriod.name,
    },
  }
}

export function exitMemoryStudentEnrollment(
  store: MemoryDomainState,
  params: ExitStudentEnrollmentParams,
): ClassEnrollment {
  const active = store.classEnrollments.find(
    (e) =>
      e.user_id === params.userId &&
      e.academic_period_id === params.academicPeriodId &&
      e.status === 'active',
  )
  if (!active) throw AppError.notFound('Active class enrollment')
  active.status = params.status ?? 'archived'
  active.updated_at = new Date().toISOString()
  return { ...active }
}
