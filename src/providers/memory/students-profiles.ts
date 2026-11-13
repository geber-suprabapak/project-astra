import { AppError } from '../../lib/errors/app-error.js'
import type {
  CreatePasswordResetCodeParams,
  CreateStudentParams,
  PasswordResetCode,
  ProfileLifecycleStatus,
  RosterStudent,
  Student,
  StudentBinding,
  StudentRosterRow,
  UserProfile,
} from '../types.js'
import type { MemoryDomainState } from './domain-state.js'

export function getMemoryUserProfile(store: MemoryDomainState, userId: string): UserProfile {
  const profile = store.profiles.get(userId)
  if (!profile) {
    throw AppError.notFound('User profile')
  }
  return { ...profile }
}

export function updateMemoryUserProfile(
  store: MemoryDomainState,
  userId: string,
  updates: Partial<UserProfile>,
): void {
  const profile = store.profiles.get(userId)
  if (!profile) {
    throw AppError.notFound('User profile')
  }
  store.profiles.set(userId, { ...profile, ...updates })
}

export function getMemoryProfileByNis(store: MemoryDomainState, nis: string): UserProfile | null {
  let placeholder: UserProfile | null = null
  for (const profile of store.profiles.values()) {
    if (profile.nis !== nis) continue
    if (profile.email) return { ...profile }
    placeholder ??= profile
  }
  return placeholder ? { ...placeholder } : null
}

export function getMemoryStudentByNis(store: MemoryDomainState, nis: string): Student | null {
  for (const student of store.students.values()) {
    if (student.nis === nis) return { ...student }
  }
  return null
}

export async function createMemoryStudent(
  store: MemoryDomainState,
  params: CreateStudentParams,
): Promise<Student> {
  const existing = await store.getStudentByNis(params.nis)
  if (existing) throw AppError.conflict(`NIS "${params.nis}" already exists in the student roster.`)
  const now = new Date().toISOString()
  const student: Student = {
    id: `student-${params.nis}`,
    nis: params.nis,
    full_name: params.fullName,
    gender: params.gender,
    created_at: now,
    updated_at: now,
  }
  store.students.set(student.id, student)
  return { ...student }
}

export function bindMemoryStudentToUser(
  store: MemoryDomainState,
  params: { studentId: string; userId: string },
): StudentBinding {
  if (!store.students.has(params.studentId)) throw AppError.notFound('Student')
  const current = store.studentBindings.get(params.studentId)
  if (current && current.user_id !== params.userId) {
    throw AppError.conflict('Student is already bound to another user.')
  }
  const existingUserBinding = [...store.studentBindings.values()].find(
    (binding) => binding.user_id === params.userId && binding.student_id !== params.studentId,
  )
  if (existingUserBinding) throw AppError.conflict('User is already bound to another student.')
  const now = new Date().toISOString()
  const binding: StudentBinding = current ?? {
    student_id: params.studentId,
    user_id: params.userId,
    created_at: now,
    updated_at: now,
  }
  binding.user_id = params.userId
  binding.updated_at = now
  store.studentBindings.set(params.studentId, binding)
  for (const enrollment of store.classEnrollments) {
    if (enrollment.student_id === params.studentId) enrollment.user_id = params.userId
  }
  return { ...binding }
}

export async function unbindMemoryStudentByNis(
  store: MemoryDomainState,
  nis: string,
): Promise<void> {
  const student = await store.getStudentByNis(nis)
  if (student) {
    store.studentBindings.delete(student.id)
    for (const enrollment of store.classEnrollments) {
      if (enrollment.student_id === student.id) enrollment.user_id = null
    }
  }
}

export async function getMemoryRosterStudentByNis(
  store: MemoryDomainState,
  nis: string,
): Promise<RosterStudent | null> {
  const student = await store.getStudentByNis(nis)
  if (student) {
    const enrollment = store.classEnrollments
      .filter((candidate) => candidate.student_id === student.id && candidate.status === 'active')
      .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0]
    const cls = enrollment
      ? store.classes.find((candidate) => candidate.id === enrollment.class_id)
      : null
    const binding = store.studentBindings.get(student.id)
    return {
      student_id: student.id,
      user_id: binding?.user_id ?? null,
      nis: student.nis,
      full_name: student.full_name,
      gender: student.gender,
      class_name: cls?.name ?? '',
      academic_period_id: enrollment?.academic_period_id ?? null,
      absence_number: enrollment?.absence_number ?? null,
    }
  }
  for (const report of store.rosterReports.values()) {
    if (report.status === 'accepted') {
      const row = report.rows.find((candidate) => candidate.nis === nis)
      if (row) {
        return {
          student_id: null,
          nis: row.nis,
          full_name: row.full_name,
          class_name: row.class_name,
          grade: row.grade,
        }
      }
    }
  }
  for (const profile of store.profiles.values()) {
    if (profile.nis === nis && profile.full_name && profile.class_name) {
      return {
        nis: profile.nis,
        full_name: profile.full_name,
        class_name: profile.class_name,
      }
    }
  }
  return null
}

export function listMemoryStudentProfiles(
  store: MemoryDomainState,
  filter?: { lifecycle_status?: ProfileLifecycleStatus },
): StudentRosterRow[] {
  const rows: StudentRosterRow[] = []
  const boundUsers = new Set<string>()
  for (const student of store.students.values()) {
    const binding = store.studentBindings.get(student.id)
    const profile = binding ? store.profiles.get(binding.user_id) : null
    if (profile) boundUsers.add(profile.user_id)
    if (filter?.lifecycle_status && profile?.lifecycle_status !== filter.lifecycle_status) continue
    const enrollments = store.classEnrollments.filter(
      (enrollment) => enrollment.student_id === student.id && enrollment.status === 'active',
    )
    const entries = enrollments.length > 0 ? enrollments : [null]
    for (const enrollment of entries) {
      const cls = enrollment
        ? store.classes.find((candidate) => candidate.id === enrollment.class_id)
        : null
      const period = enrollment
        ? store.academicPeriods.find((candidate) => candidate.id === enrollment.academic_period_id)
        : null
      rows.push({
        user_id: profile?.user_id ?? null,
        student_id: student.id,
        full_name: student.full_name,
        email: profile?.email ?? null,
        nis: student.nis,
        class_name: cls?.name ?? null,
        class_id: cls?.id ?? null,
        absence_number: enrollment?.absence_number ?? profile?.absence_number ?? null,
        avatar_url: profile?.avatar_url ?? null,
        role: profile?.role ?? null,
        lifecycle_status: profile?.lifecycle_status ?? null,
        gender: student.gender,
        academic_period_id: enrollment?.academic_period_id ?? null,
        period_name: period?.name ?? null,
      })
    }
  }
  for (const profile of store.profiles.values()) {
    if (profile.role !== 'student' || boundUsers.has(profile.user_id)) continue
    if (filter?.lifecycle_status && profile.lifecycle_status !== filter.lifecycle_status) continue
    rows.push({ ...profile, user_id: profile.user_id, student_id: null })
  }
  return rows
}

export function createMemoryPendingStudentProfile(
  store: MemoryDomainState,
  params: {
    userId: string
    nis: string
    email: string
    fullName: string
    className: string
  },
): UserProfile {
  for (const existing of store.profiles.values()) {
    if (existing.nis === params.nis && existing.user_id !== params.userId) {
      throw AppError.conflict(`A student account is already registered for NIS "${params.nis}".`)
    }
  }
  const profile: UserProfile = {
    user_id: params.userId,
    full_name: params.fullName,
    nis: params.nis,
    email: params.email,
    class_name: params.className,
    role: 'student',
    lifecycle_status: 'pending',
    gender: null,
  }
  store.profiles.set(params.userId, profile)
  return { ...profile }
}

export function updateMemoryProfileLifecycle(
  store: MemoryDomainState,
  userId: string,
  status: ProfileLifecycleStatus,
): UserProfile {
  const profile = store.profiles.get(userId)
  if (!profile) {
    throw AppError.notFound('User profile')
  }
  profile.lifecycle_status = status
  store.profiles.set(userId, profile)
  return { ...profile }
}

export function updateMemoryProfileEmail(
  store: MemoryDomainState,
  userId: string,
  email: string,
): UserProfile {
  const profile = store.profiles.get(userId)
  if (!profile) {
    throw AppError.notFound('User profile')
  }
  profile.email = email
  store.profiles.set(userId, profile)
  return { ...profile }
}

export function createMemoryPasswordResetCode(
  store: MemoryDomainState,
  params: CreatePasswordResetCodeParams,
): PasswordResetCode {
  const resetCode: PasswordResetCode = {
    id: `rc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    user_id: params.userId,
    code: params.code,
    expires_at: params.expiresAt,
    used: false,
    used_at: null,
    created_by: params.createdBy ?? null,
    created_at: new Date().toISOString(),
  }
  store.resetCodes.push(resetCode)
  return { ...resetCode }
}

export function getMemoryActivePasswordResetCode(
  store: MemoryDomainState,
  userId: string,
  code: string,
): PasswordResetCode | null {
  const now = Date.now()
  const found = store.resetCodes.find(
    (resetCode) =>
      resetCode.user_id === userId &&
      resetCode.code === code &&
      !resetCode.used &&
      new Date(resetCode.expires_at).getTime() > now,
  )
  return found ? { ...found } : null
}

export function markMemoryPasswordResetCodeUsed(store: MemoryDomainState, codeId: string): void {
  const code = store.resetCodes.find((resetCode) => resetCode.id === codeId)
  if (code) {
    code.used = true
    code.used_at = new Date().toISOString()
  }
}
