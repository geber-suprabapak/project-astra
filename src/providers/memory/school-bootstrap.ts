import { AppError } from '../../lib/errors/app-error.js'
import type {
  BootstrapStatus,
  CreateSchoolParams,
  RosterReport,
  School,
  StageRosterParams,
  UserProfile,
} from '../types.js'
import type { MemoryDomainState } from './domain-state.js'

export function getMemorySchool(store: MemoryDomainState): School | null {
  if (store.schools.length === 0) return null
  return { ...store.schools[0] }
}

export function getMemorySchoolBySlug(store: MemoryDomainState, slug: string): School | null {
  const school = store.schools.find((s) => s.slug === slug)
  if (!school) return null
  return { ...school }
}

export function createMemorySchool(store: MemoryDomainState, params: CreateSchoolParams): School {
  const now = new Date().toISOString()
  const school: School = {
    id: `school-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: params.name,
    slug: params.slug,
    timezone: params.timezone ?? 'Asia/Jakarta',
    signup_open: false,
    created_at: now,
    updated_at: now,
  }
  store.schools.push(school)

  if (store.academicPeriods.length === 0) {
    store.academicPeriods.push({
      id: `period-${Date.now()}`,
      school_id: school.id,
      name: '2026/2027 Ganjil',
      start_date: '2026-07-01',
      end_date: '2026-12-31',
      is_active: true,
      created_at: now,
      updated_at: now,
    })
  } else {
    for (const p of store.academicPeriods) {
      if (p.school_id === '11111111-1111-1111-1111-111111111111') {
        p.school_id = school.id
      }
    }
    for (const c of store.classes) {
      if (c.school_id === '11111111-1111-1111-1111-111111111111') {
        c.school_id = school.id
      }
    }
  }

  return { ...school }
}

export function createMemoryInitialSchoolAdmin(
  store: MemoryDomainState,
  params: {
    userId: string
    fullName?: string | null
    email?: string | null
  },
): UserProfile {
  const profile: UserProfile = {
    user_id: params.userId,
    full_name: params.fullName ?? null,
    email: params.email ?? null,
    role: 'school_admin',
    lifecycle_status: 'approved',
    gender: null,
  }
  store.profiles.set(params.userId, profile)
  return { ...profile }
}

export function stageMemoryRosterReport(
  store: MemoryDomainState,
  params: StageRosterParams,
): RosterReport {
  const now = new Date().toISOString()
  const id = `roster-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const report: RosterReport = {
    id,
    school_id: params.schoolId ?? null,
    academic_period_id: params.academicPeriodId ?? null,
    total_rows: params.totalRows,
    valid_rows: params.validRows,
    rejected_rows: params.rejectedRows,
    status: params.status,
    review_state: params.reviewState,
    rows: params.rows,
    rejected_items: params.rejectedItems,
    accepted_at: null,
    accepted_by: null,
    created_at: now,
    updated_at: now,
  }
  store.rosterReports.set(id, report)
  return { ...report }
}

export function getMemoryRosterReport(store: MemoryDomainState, id: string): RosterReport | null {
  const report = store.rosterReports.get(id)
  if (!report) return null
  return { ...report }
}

export async function acceptMemoryRosterReport(
  store: MemoryDomainState,
  id: string,
  acceptedBy: string,
): Promise<RosterReport> {
  const report = store.rosterReports.get(id)
  if (!report) {
    throw AppError.notFound('Roster report')
  }
  if (report.status === 'accepted') return { ...report }
  if (report.rejected_rows > 0 || report.rejected_items.length > 0) {
    throw AppError.validationError('Cannot accept a roster report with rejected rows.')
  }

  const period = report.academic_period_id
    ? store.academicPeriods.find((p) => p.id === report.academic_period_id)
    : null
  if (!period) throw AppError.validationError('Academic period is required.')
  const now = new Date().toISOString()

  const rows = report.rows.map((row) => {
    const cls = row.class_id
      ? store.classes.find(
          (candidate) =>
            candidate.id === row.class_id && candidate.academic_period_id === period.id,
        )
      : store.classes.find(
          (candidate) =>
            candidate.academic_period_id === period.id &&
            candidate.name.trim().toLowerCase() === row.class_name.trim().toLowerCase(),
        )
    if (!cls) throw AppError.validationError(`Class "${row.class_name}" does not exist.`)
    if (row.gender !== 'L' && row.gender !== 'P') {
      throw AppError.validationError('Gender must be L or P.')
    }
    const absenceText = String(row.absence_number ?? '').trim()
    const absenceNumber = Number(absenceText)
    if (!/^\d+$/.test(absenceText) || !Number.isInteger(absenceNumber) || absenceNumber <= 0) {
      throw AppError.validationError('Absence number must be a positive integer.')
    }
    if ([...store.students.values()].some((student) => student.nis === row.nis)) {
      throw AppError.conflict(`NIS "${row.nis}" already exists in the student roster.`)
    }
    if (
      store.classEnrollments.some(
        (enrollment) =>
          enrollment.status === 'active' &&
          enrollment.class_id === cls.id &&
          enrollment.academic_period_id === period.id &&
          Number(enrollment.absence_number) === absenceNumber,
      )
    ) {
      throw AppError.conflict('Absence number is already used in this class and academic period.')
    }
    return { row, cls, absenceText }
  })
  const batchAbsences = new Set<string>()
  for (const { cls, absenceText } of rows) {
    const key = `${cls.id}:${Number(absenceText)}`
    if (batchAbsences.has(key)) {
      throw AppError.conflict('Absence number is duplicated in this class and academic period.')
    }
    batchAbsences.add(key)
  }

  const previousStudents = new Map(store.students)
  const previousEnrollments = [...store.classEnrollments]
  try {
    for (const { row, cls, absenceText } of rows) {
      const student = await store.createStudent({
        nis: row.nis,
        fullName: row.full_name,
        // SAFETY: roster validation above rejects every gender except L and P.
        gender: row.gender as 'L' | 'P',
      })
      store.classEnrollments.push({
        id: `enrollment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        student_id: student.id,
        user_id: null,
        class_id: cls.id,
        academic_period_id: period.id,
        absence_number: absenceText,
        status: 'active',
        created_at: now,
        updated_at: now,
      })
    }
  } catch (err) {
    store.students = previousStudents
    store.classEnrollments = previousEnrollments
    throw err
  }

  report.status = 'accepted'
  report.review_state = 'accepted'
  report.accepted_at = now
  report.accepted_by = acceptedBy
  report.updated_at = now
  store.rosterReports.set(id, report)

  return { ...report }
}

export function openMemorySignup(store: MemoryDomainState): void {
  store.signupOpen = true
  if (store.schools.length > 0) {
    store.schools[0].signup_open = true
  }
}

export function isMemorySignupOpen(store: MemoryDomainState): boolean {
  return store.signupOpen || store.schools[0]?.signup_open === true
}

export function getMemoryBootstrapStatus(store: MemoryDomainState): BootstrapStatus {
  const school = store.schools[0] ?? null
  let hasSchoolAdmin = false
  for (const p of store.profiles.values()) {
    if (p.role === 'school_admin' && p.lifecycle_status === 'approved') {
      hasSchoolAdmin = true
      break
    }
  }
  const activePeriod = store.academicPeriods.find((p) => p.is_active) ?? null
  const reports = Array.from(store.rosterReports.values())
  const latestReport = reports.length > 0 ? reports[reports.length - 1] : null
  const rosterAccepted = reports.some((r) => r.status === 'accepted')

  return {
    school_configured: school !== null,
    school: school ? { ...school } : null,
    school_admin_created: hasSchoolAdmin,
    active_academic_period: activePeriod !== null,
    latest_roster_report: latestReport ? { ...latestReport } : null,
    roster_accepted: rosterAccepted,
    signup_open: store.signupOpen || school?.signup_open === true,
  }
}
