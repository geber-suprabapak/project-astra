import { z } from 'zod'
import { AppError } from '../../lib/errors/app-error.js'
import {
  identityRoleSchema,
  type Absence,
  type AcademicPeriod,
  type ActivePermitSummary,
  type AttendanceActionRpcResponse,
  type AttendanceActionType,
  type AttendanceAttempt,
  type AttendanceAttemptStatus,
  type AttendanceRecord,
  type AttendanceStatus,
  type AuditLog,
  type AuditLogEntry,
  type BootstrapStatus,
  type CalendarException,
  type ClassEnrollment,
  type ClassEnrollmentStatus,
  type ClassRoom,
  type ClaimPendingNotificationsParams,
  type CreateAcademicPeriodParams,
  type CreateCalendarExceptionParams,
  type CreateClassParams,
  type CreateFileRecordParams,
  type CreateLeaveRequestData,
  type CreateLocationParams,
  type CreateManualAttendanceParams,
  type CreatePasswordResetCodeParams,
  type CreateStudentIdentityParams,
  type CreateStudentParams,
  type CreatePermissionParams,
  type CreateRoleParams,
  type CreateScheduleParams,
  type CreateSchoolParams,
  type CreateStaffParams,
  type DomainStore,
  type EnqueueNotificationParams,
  type EnrollStudentParams,
  type ExitStudentEnrollmentParams,
  type FaceEnrollmentRecord,
  type ForceFinishLeaveRequestParams,
  type FileLifecycle,
  type FilePurpose,
  type FileRecord,
  type IdentityProvider,
  type IdentityUser,
  type IdentityRole,
  type InsertAttendanceData,
  type InsertPermitData,
  type LeaveRequest,
  getLeavePeriodFields,
  type ListLeaveRequestsFilter,
  type ListNotificationsFilter,
  type Location,
  type NotificationRecord,
  type ObjectStorage,
  normalizeAttendanceRecord,
  type PasswordResetCode,
  type Permission,
  type Permit,
  type ProfileLifecycleStatus,
  type PromoteStudentEnrollmentParams,
  type RecordAttendanceAttemptParams,
  type Role,
  type RosterReport,
  type RosterStudent,
  type SaveAttendanceRecordRpcResponse,
  type SaveFaceEnrollmentParams,
  type Schedule,
  type School,
  type Student,
  type StudentBinding,
  type StudentRosterRow,
  type StageRosterParams,
  type TransferStudentEnrollmentParams,
  type UpdateAcademicPeriodParams,
  type UpdateCalendarExceptionParams,
  type UpdateClassParams,
  type UpdateLocationParams,
  type UpdateRoleParams,
  type UpdateScheduleParams,
  type UpdateStaffParams,
  type UpdateLeaveRequestStatusParams,
  type UpdateNotificationStatusParams,
  type UserMetadata,
  type UserProfile,
} from '../types.js'
import { isMfaVerified } from '../identity/claims.js'

const DEFAULT_PERMISSIONS: Permission[] = [
  {
    id: 'd0000000-0000-0000-0000-000000000001',
    name: 'admin:read',
    description: 'Read administrative state and session',
  },
  {
    id: 'd0000000-0000-0000-0000-000000000002',
    name: 'admin:write',
    description: 'Write administrative configuration',
  },
  {
    id: 'd0000000-0000-0000-0000-000000000003',
    name: 'roles:manage',
    description: 'Create and modify roles and permissions',
  },
  {
    id: 'd0000000-0000-0000-0000-000000000004',
    name: 'staff:manage',
    description: 'Create and manage staff members and assign roles',
  },
  {
    id: 'd0000000-0000-0000-0000-000000000005',
    name: 'student:manage',
    description: 'Manage student profiles and approvals',
  },
  {
    id: 'd0000000-0000-0000-0000-000000000006',
    name: 'roster:manage',
    description: 'Stage and review student roster imports',
  },
  {
    id: 'd0000000-0000-0000-0000-000000000007',
    name: 'attendance:read',
    description: 'View attendance records',
  },
  {
    id: 'd0000000-0000-0000-0000-000000000008',
    name: 'attendance:write',
    description: 'Submit attendance check-in/out',
  },
  {
    id: 'd0000000-0000-0000-0000-000000000009',
    name: 'attendance:manual',
    description: 'Record manual attendance exceptions',
  },
  {
    id: 'd0000000-0000-0000-0000-000000000010',
    name: 'leave:read',
    description: 'View leave requests',
  },
  {
    id: 'd0000000-0000-0000-0000-000000000011',
    name: 'leave:submit',
    description: 'Submit leave requests',
  },
  {
    id: 'd0000000-0000-0000-0000-000000000012',
    name: 'leave:approve',
    description: 'Approve or reject leave requests',
  },
  {
    id: 'd0000000-0000-0000-0000-000000000013',
    name: 'profile:read',
    description: 'View profile information',
  },
  {
    id: 'd0000000-0000-0000-0000-000000000014',
    name: 'profile:write',
    description: 'Update profile information',
  },
]

const DEFAULT_ROLES: Role[] = [
  {
    id: 'c0000000-0000-0000-0000-000000000001',
    name: 'platform_admin',
    description: 'Platform Administrator with full access',
    is_active: true,
    permissions: [
      'admin:read',
      'admin:write',
      'roles:manage',
      'staff:manage',
      'student:manage',
      'roster:manage',
    ],
  },
  {
    id: 'c0000000-0000-0000-0000-000000000002',
    name: 'school_admin',
    description: 'School Administrator for school-level operations',
    is_active: true,
    permissions: [
      'admin:read',
      'staff:manage',
      'student:manage',
      'roster:manage',
      'attendance:read',
      'attendance:manual',
      'leave:read',
      'leave:approve',
    ],
  },
  {
    id: 'c0000000-0000-0000-0000-000000000003',
    name: 'teacher',
    description: 'Teacher with attendance and leave management access',
    is_active: true,
    permissions: ['attendance:read', 'attendance:manual', 'leave:read', 'leave:approve'],
  },
  {
    id: 'c0000000-0000-0000-0000-000000000004',
    name: 'staff',
    description: 'General staff with operational read access',
    is_active: true,
    permissions: ['attendance:read', 'leave:read'],
  },
  {
    id: 'c0000000-0000-0000-0000-000000000005',
    name: 'student',
    description: 'Student with attendance check-in and leave submission access',
    is_active: true,
    permissions: ['attendance:read', 'attendance:write', 'leave:read', 'leave:submit'],
  },
]

const identityTokenPayloadSchema = z
  .object({
    sub: z.string().min(1),
    email: z.string().nullable().optional(),
    roles: z.array(identityRoleSchema).optional(),
    scope: z.string().min(1).optional(),
    amr: z.array(z.string().min(1)).optional(),
    mfa_verified: z.boolean().optional(),
    must_change_password: z.boolean().optional(),
  })
  .passthrough()

const DEFAULT_LOCATIONS: Location[] = [
  {
    id: 'a0000000-0000-0000-0000-000000000001',
    name: 'School Campus',
    latitude: -6.2,
    longitude: 106.816666,
    radius_meters: 5000.0,
    is_active: true,
  },
]

const DEFAULT_SCHEDULES: Schedule[] = [
  {
    id: 'b0000000-0000-0000-0000-000000000001',
    day_of_week: 'senin',
    hari: 'senin',
    mulai_masuk: '06:00:00',
    selesai_masuk: '07:15:00',
    mulai_pulang: '15:00:00',
    selesai_pulang: '18:00:00',
    kompensasi_waktu: 15,
    is_active: true,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000002',
    day_of_week: 'selasa',
    hari: 'selasa',
    mulai_masuk: '06:00:00',
    selesai_masuk: '07:15:00',
    mulai_pulang: '15:00:00',
    selesai_pulang: '18:00:00',
    kompensasi_waktu: 15,
    is_active: true,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000003',
    day_of_week: 'rabu',
    hari: 'rabu',
    mulai_masuk: '06:00:00',
    selesai_masuk: '07:15:00',
    mulai_pulang: '15:00:00',
    selesai_pulang: '18:00:00',
    kompensasi_waktu: 15,
    is_active: true,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000004',
    day_of_week: 'kamis',
    hari: 'kamis',
    mulai_masuk: '06:00:00',
    selesai_masuk: '07:15:00',
    mulai_pulang: '15:00:00',
    selesai_pulang: '18:00:00',
    kompensasi_waktu: 15,
    is_active: true,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000005',
    day_of_week: 'jumat',
    hari: 'jumat',
    mulai_masuk: '06:00:00',
    selesai_masuk: '07:15:00',
    mulai_pulang: '11:30:00',
    selesai_pulang: '14:00:00',
    kompensasi_waktu: 15,
    is_active: true,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000006',
    day_of_week: 'sabtu',
    hari: 'sabtu',
    mulai_masuk: '06:00:00',
    selesai_masuk: '07:15:00',
    mulai_pulang: '12:00:00',
    selesai_pulang: '15:00:00',
    kompensasi_waktu: 15,
    is_active: true,
  },
]

const DEFAULT_ACADEMIC_PERIODS: AcademicPeriod[] = [
  {
    id: 'b0000000-0000-0000-0000-000000000001',
    school_id: '11111111-1111-1111-1111-111111111111',
    name: '2026/2027 Ganjil',
    start_date: '2026-07-01',
    end_date: '2026-12-31',
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
]

const DEFAULT_CLASSES: ClassRoom[] = [
  {
    id: 'c0000000-0000-0000-0000-000000000001',
    school_id: '11111111-1111-1111-1111-111111111111',
    academic_period_id: 'b0000000-0000-0000-0000-000000000001',
    name: 'XII RPL 1',
    grade: 12,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
]

function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000 // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function addCalendarDays(date: string, days: number): string {
  return new Date(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

function isPhysicalAttendance(status: string, actionType?: string | null): boolean {
  return (
    actionType === 'check_in' ||
    actionType === 'check_out' ||
    status === 'Hadir' ||
    status === 'Terlambat' ||
    status === 'Pulang' ||
    status === 'Datang'
  )
}

function effectiveLeavePeriod(permit: Permit) {
  const start = permit.tanggal.slice(0, 10)
  return {
    start,
    end: permit.effective_end_date ?? permit.original_end_date ?? start,
  }
}

function assertAttendanceAllowed(permits: Permit[], userId: string, date: string): void {
  const dateOnly = date.slice(0, 10)
  const blocking = permits.find((permit) => {
    if (permit.user_id !== userId || permit.approval_status !== 'approved') return false
    const period = effectiveLeavePeriod(permit)
    return dateOnly >= period.start && dateOnly <= period.end
  })
  if (!blocking) return
  const period = effectiveLeavePeriod(blocking)
  throw AppError.attendanceBlocked('Attendance is blocked by an approved Leave Period.', {
    leave_request_id: blocking.id,
    date: dateOnly,
    effective_start_date: period.start,
    effective_end_date: period.end,
  })
}

export class MemoryDomainStore implements DomainStore {
  public profiles = new Map<string, UserProfile>()
  public students = new Map<string, Student>()
  public studentBindings = new Map<string, StudentBinding>()
  public absences: Absence[] = []
  public schedules = new Map<string, Schedule>()
  public locations = new Map<string, Location>()
  public calendarExceptions = new Map<string, CalendarException>()
  public permits: Permit[] = []
  public schools: School[] = []
  public academicPeriods: AcademicPeriod[] = []
  public classes: ClassRoom[] = []
  public classEnrollments: ClassEnrollment[] = []
  public rosterReports = new Map<string, RosterReport>()
  public auditLogs: AuditLog[] = []
  public roles = new Map<string, Role>()
  public permissions = new Map<string, Permission>()
  public userRoles = new Map<string, Set<string>>()
  public revokedSessions = new Set<string>()
  public resetCodes: PasswordResetCode[] = []
  public files = new Map<string, FileRecord>()
  public faceEnrollments = new Map<string, FaceEnrollmentRecord>()
  public notifications = new Map<string, NotificationRecord>()
  public attendanceAttempts: AttendanceAttempt[] = []
  public attendancesList: AttendanceRecord[] = []
  public signupOpen = false
  public isHealthy = true

  constructor() {
    for (const perm of DEFAULT_PERMISSIONS) {
      this.permissions.set(perm.name, { ...perm })
    }
    for (const role of DEFAULT_ROLES) {
      this.roles.set(role.name, { ...role, permissions: [...(role.permissions ?? [])] })
    }
    for (const loc of DEFAULT_LOCATIONS) {
      this.locations.set(loc.id, { ...loc })
    }
    for (const sched of DEFAULT_SCHEDULES) {
      this.schedules.set(sched.id ?? sched.hari, { ...sched })
    }
    for (const p of DEFAULT_ACADEMIC_PERIODS) {
      this.academicPeriods.push({ ...p })
    }
    for (const c of DEFAULT_CLASSES) {
      this.classes.push({ ...c })
    }
  }

  async getUserProfile(userId: string): Promise<UserProfile> {
    const profile = this.profiles.get(userId)
    if (!profile) {
      throw AppError.notFound('User profile')
    }
    return { ...profile }
  }

  async updateUserProfile(userId: string, updates: Partial<UserProfile>): Promise<void> {
    const profile = this.profiles.get(userId)
    if (!profile) {
      throw AppError.notFound('User profile')
    }
    this.profiles.set(userId, { ...profile, ...updates })
  }

  async getProfileByNis(nis: string): Promise<UserProfile | null> {
    let placeholder: UserProfile | null = null
    for (const profile of this.profiles.values()) {
      if (profile.nis !== nis) continue
      if (profile.email) return { ...profile }
      placeholder ??= profile
    }
    return placeholder ? { ...placeholder } : null
  }

  async getStudentByNis(nis: string): Promise<Student | null> {
    for (const student of this.students.values()) {
      if (student.nis === nis) return { ...student }
    }
    return null
  }

  async createStudent(params: CreateStudentParams): Promise<Student> {
    const existing = await this.getStudentByNis(params.nis)
    if (existing)
      throw AppError.conflict(`NIS "${params.nis}" already exists in the student roster.`)
    const now = new Date().toISOString()
    const student: Student = {
      id: `student-${params.nis}`,
      nis: params.nis,
      full_name: params.fullName,
      gender: params.gender,
      created_at: now,
      updated_at: now,
    }
    this.students.set(student.id, student)
    return { ...student }
  }

  async bindStudentToUser(params: { studentId: string; userId: string }): Promise<StudentBinding> {
    if (!this.students.has(params.studentId)) throw AppError.notFound('Student')
    const current = this.studentBindings.get(params.studentId)
    if (current && current.user_id !== params.userId) {
      throw AppError.conflict('Student is already bound to another user.')
    }
    const existingUserBinding = [...this.studentBindings.values()].find(
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
    this.studentBindings.set(params.studentId, binding)
    for (const enrollment of this.classEnrollments) {
      if (enrollment.student_id === params.studentId) enrollment.user_id = params.userId
    }
    return { ...binding }
  }

  async getTodayAbsences(userId: string, dateWIB: string): Promise<Absence[]> {
    return this.absences
      .filter(
        (a) => a.user_id === userId && (a.date === dateWIB || a.created_at.startsWith(dateWIB)),
      )
      .map((a) => ({
        ...a,
        status: a.status === 'Datang' ? 'Hadir' : a.status,
      }))
  }

  async insertAttendance(data: InsertAttendanceData): Promise<Absence> {
    const record: Absence = {
      status: data.status,
      date: data.date,
      user_id: data.user_id,
      created_at: data.created_at ?? new Date().toISOString(),
    }
    this.absences.push(record)
    return record
  }

  async getActiveSchedule(
    dayKey: string,
    params?: { classId?: string; academicPeriodId?: string },
  ): Promise<Schedule | null> {
    const day = dayKey.toLowerCase()
    const activeSchedules = Array.from(this.schedules.values()).filter(
      (s) => s.is_active && (s.day_of_week?.toLowerCase() === day || s.hari?.toLowerCase() === day),
    )

    if (activeSchedules.length === 0) return null

    // 1. Match classId + academicPeriodId
    if (params?.classId && params?.academicPeriodId) {
      const matched = activeSchedules.find(
        (s) => s.class_id === params.classId && s.academic_period_id === params.academicPeriodId,
      )
      if (matched) return { ...matched }
    }

    // 2. Match classId only
    if (params?.classId) {
      const matched = activeSchedules.find((s) => s.class_id === params.classId)
      if (matched) return { ...matched }
    }

    // 3. Match academicPeriodId only
    if (params?.academicPeriodId) {
      const matched = activeSchedules.find(
        (s) => s.academic_period_id === params.academicPeriodId && !s.class_id,
      )
      if (matched) return { ...matched }
    }

    // 4. Match general/school-wide (no classId, no academicPeriodId)
    const general = activeSchedules.find((s) => !s.class_id && !s.academic_period_id)
    if (general) return { ...general }

    return { ...activeSchedules[0] }
  }

  async listSchedules(filter?: {
    classId?: string
    academicPeriodId?: string
    dayOfWeek?: string
    isActive?: boolean
  }): Promise<Schedule[]> {
    let list = Array.from(this.schedules.values())
    if (filter?.classId !== undefined) {
      list = list.filter((s) => s.class_id === filter.classId)
    }
    if (filter?.academicPeriodId !== undefined) {
      list = list.filter((s) => s.academic_period_id === filter.academicPeriodId)
    }
    if (filter?.dayOfWeek !== undefined) {
      const day = filter.dayOfWeek.toLowerCase()
      list = list.filter(
        (s) => s.day_of_week?.toLowerCase() === day || s.hari?.toLowerCase() === day,
      )
    }
    if (filter?.isActive !== undefined) {
      list = list.filter((s) => s.is_active === filter.isActive)
    }
    return list.map((s) => ({ ...s }))
  }

  async getScheduleById(id: string): Promise<Schedule | null> {
    const s =
      this.schedules.get(id) ?? Array.from(this.schedules.values()).find((item) => item.id === id)
    return s ? { ...s } : null
  }

  async createSchedule(params: CreateScheduleParams): Promise<Schedule> {
    const now = new Date().toISOString()
    const id = `sched-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const schedule: Schedule = {
      id,
      school_id: params.schoolId ?? this.schools[0]?.id ?? null,
      class_id: params.classId ?? null,
      academic_period_id: params.academicPeriodId ?? null,
      location_id: params.locationId ?? null,
      day_of_week: params.dayOfWeek.toLowerCase(),
      hari: params.dayOfWeek.toLowerCase(),
      mulai_masuk: params.startTime,
      selesai_masuk: params.endTime,
      mulai_pulang: params.startCheckout,
      selesai_pulang: params.endCheckout,
      kompensasi_waktu: params.gracePeriodMinutes ?? 0,
      is_active: params.isActive ?? true,
      created_at: now,
      updated_at: now,
    }
    this.schedules.set(id, schedule)
    return { ...schedule }
  }

  async updateSchedule(id: string, params: UpdateScheduleParams): Promise<Schedule> {
    const schedule =
      this.schedules.get(id) ?? Array.from(this.schedules.values()).find((item) => item.id === id)
    if (!schedule) throw AppError.notFound('Schedule')

    if (params.dayOfWeek !== undefined) {
      schedule.day_of_week = params.dayOfWeek.toLowerCase()
      schedule.hari = params.dayOfWeek.toLowerCase()
    }
    if (params.startTime !== undefined) schedule.mulai_masuk = params.startTime
    if (params.endTime !== undefined) schedule.selesai_masuk = params.endTime
    if (params.startCheckout !== undefined) schedule.mulai_pulang = params.startCheckout
    if (params.endCheckout !== undefined) schedule.selesai_pulang = params.endCheckout
    if (params.gracePeriodMinutes !== undefined)
      schedule.kompensasi_waktu = params.gracePeriodMinutes
    if (params.isActive !== undefined) schedule.is_active = params.isActive
    if (params.classId !== undefined) schedule.class_id = params.classId
    if (params.academicPeriodId !== undefined) schedule.academic_period_id = params.academicPeriodId
    if (params.locationId !== undefined) schedule.location_id = params.locationId

    schedule.updated_at = new Date().toISOString()
    this.schedules.set(schedule.id ?? id, schedule)
    return { ...schedule }
  }

  async deleteSchedule(id: string): Promise<void> {
    const schedule =
      this.schedules.get(id) ?? Array.from(this.schedules.values()).find((item) => item.id === id)
    if (!schedule) throw AppError.notFound('Schedule')
    this.schedules.delete(schedule.id ?? id)
  }

  async listLocations(filter?: { isActive?: boolean }): Promise<Location[]> {
    let list = Array.from(this.locations.values())
    if (filter?.isActive !== undefined) {
      list = list.filter((loc) => loc.is_active === filter.isActive)
    }
    return list.map((loc) => ({ ...loc }))
  }

  async getLocationById(id: string): Promise<Location | null> {
    const loc = this.locations.get(id)
    return loc ? { ...loc } : null
  }

  async createLocation(params: CreateLocationParams): Promise<Location> {
    const now = new Date().toISOString()
    const id = `loc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const location: Location = {
      id,
      school_id: params.schoolId ?? this.schools[0]?.id ?? null,
      name: params.name,
      latitude: params.latitude,
      longitude: params.longitude,
      radius_meters: params.radiusMeters ?? 100.0,
      is_active: params.isActive ?? true,
      created_at: now,
      updated_at: now,
    }
    this.locations.set(id, location)
    return { ...location }
  }

  async updateLocation(id: string, params: UpdateLocationParams): Promise<Location> {
    const loc = this.locations.get(id)
    if (!loc) throw AppError.notFound('Location')
    if (params.name !== undefined) loc.name = params.name
    if (params.latitude !== undefined) loc.latitude = params.latitude
    if (params.longitude !== undefined) loc.longitude = params.longitude
    if (params.radiusMeters !== undefined) loc.radius_meters = params.radiusMeters
    if (params.isActive !== undefined) loc.is_active = params.isActive
    loc.updated_at = new Date().toISOString()
    this.locations.set(id, loc)
    return { ...loc }
  }

  async deleteLocation(id: string): Promise<void> {
    if (!this.locations.has(id)) throw AppError.notFound('Location')
    this.locations.delete(id)
  }

  async listCalendarExceptions(filter?: {
    academicPeriodId?: string
    startDate?: string
    endDate?: string
  }): Promise<CalendarException[]> {
    let list = Array.from(this.calendarExceptions.values())
    if (filter?.academicPeriodId) {
      list = list.filter((e) => e.academic_period_id === filter.academicPeriodId)
    }
    if (filter?.startDate) {
      list = list.filter((e) => e.date >= filter.startDate!)
    }
    if (filter?.endDate) {
      list = list.filter((e) => e.date <= filter.endDate!)
    }
    return list.map((e) => ({ ...e }))
  }

  async getCalendarExceptionById(id: string): Promise<CalendarException | null> {
    const e = this.calendarExceptions.get(id)
    return e ? { ...e } : null
  }

  async getCalendarExceptionByDate(
    date: string,
    academicPeriodId?: string,
  ): Promise<CalendarException | null> {
    const formattedDate = date.slice(0, 10)
    for (const e of this.calendarExceptions.values()) {
      if (e.date === formattedDate) {
        if (
          !academicPeriodId ||
          !e.academic_period_id ||
          e.academic_period_id === academicPeriodId
        ) {
          return { ...e }
        }
      }
    }
    return null
  }

  async createCalendarException(params: CreateCalendarExceptionParams): Promise<CalendarException> {
    const now = new Date().toISOString()
    const id = `cal-exc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const exc: CalendarException = {
      id,
      school_id: params.schoolId ?? this.schools[0]?.id ?? null,
      academic_period_id: params.academicPeriodId ?? null,
      date: params.date.slice(0, 10),
      reason: params.reason,
      is_holiday: params.isHoliday ?? true,
      created_at: now,
      updated_at: now,
    }
    this.calendarExceptions.set(id, exc)
    return { ...exc }
  }

  async updateCalendarException(
    id: string,
    params: UpdateCalendarExceptionParams,
  ): Promise<CalendarException> {
    const exc = this.calendarExceptions.get(id)
    if (!exc) throw AppError.notFound('Calendar exception')
    if (params.date !== undefined) exc.date = params.date.slice(0, 10)
    if (params.reason !== undefined) exc.reason = params.reason
    if (params.isHoliday !== undefined) exc.is_holiday = params.isHoliday
    if (params.academicPeriodId !== undefined) exc.academic_period_id = params.academicPeriodId
    exc.updated_at = new Date().toISOString()
    this.calendarExceptions.set(id, exc)
    return { ...exc }
  }

  async deleteCalendarException(id: string): Promise<void> {
    if (!this.calendarExceptions.has(id)) throw AppError.notFound('Calendar exception')
    this.calendarExceptions.delete(id)
  }

  async listAcademicPeriods(filter?: { isActive?: boolean }): Promise<AcademicPeriod[]> {
    let list = [...this.academicPeriods]
    if (filter?.isActive !== undefined) {
      list = list.filter((p) => p.is_active === filter.isActive)
    }
    return list.map((p) => ({ ...p }))
  }

  async getAcademicPeriod(id: string): Promise<AcademicPeriod | null> {
    const p = this.academicPeriods.find((item) => item.id === id)
    return p ? { ...p } : null
  }

  async getActiveAcademicPeriod(): Promise<AcademicPeriod | null> {
    const period = this.academicPeriods.find((p) => p.is_active)
    if (!period) return null
    return { ...period }
  }

  async createAcademicPeriod(params: CreateAcademicPeriodParams): Promise<AcademicPeriod> {
    const now = new Date().toISOString()
    const school = this.schools[0]
    const schoolId = params.schoolId ?? school?.id ?? 'school-default'
    if (params.isActive) {
      for (const p of this.academicPeriods) {
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
    this.academicPeriods.push(period)
    return { ...period }
  }

  async updateAcademicPeriod(
    id: string,
    params: UpdateAcademicPeriodParams,
  ): Promise<AcademicPeriod> {
    const period = this.academicPeriods.find((p) => p.id === id)
    if (!period) throw AppError.notFound('Academic period')
    if (params.isActive === true) {
      for (const p of this.academicPeriods) {
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

  async setActiveAcademicPeriod(id: string): Promise<AcademicPeriod> {
    const period = this.academicPeriods.find((p) => p.id === id)
    if (!period) throw AppError.notFound('Academic period')
    for (const p of this.academicPeriods) {
      p.is_active = p.id === id
      p.updated_at = new Date().toISOString()
    }
    return { ...period }
  }

  async getClasses(schoolId?: string, academicPeriodId?: string): Promise<ClassRoom[]> {
    let list = [...this.classes]
    if (schoolId) list = list.filter((c) => c.school_id === schoolId)
    if (academicPeriodId) list = list.filter((c) => c.academic_period_id === academicPeriodId)
    return list.map((c) => ({ ...c }))
  }

  async getClassById(id: string): Promise<ClassRoom | null> {
    const cls = this.classes.find((c) => c.id === id)
    return cls ? { ...cls } : null
  }

  async createClass(params: CreateClassParams): Promise<ClassRoom> {
    const now = new Date().toISOString()
    const school = this.schools[0]
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
    this.classes.push(cls)
    return { ...cls }
  }

  async updateClass(id: string, params: UpdateClassParams): Promise<ClassRoom> {
    const cls = this.classes.find((c) => c.id === id)
    if (!cls) throw AppError.notFound('Class')
    if (params.name !== undefined) cls.name = params.name
    if (params.grade !== undefined) cls.grade = params.grade
    if (params.academicPeriodId !== undefined) cls.academic_period_id = params.academicPeriodId
    cls.updated_at = new Date().toISOString()
    return { ...cls }
  }

  async listClassEnrollments(filter?: {
    userId?: string
    classId?: string
    academicPeriodId?: string
    status?: ClassEnrollmentStatus
  }): Promise<ClassEnrollment[]> {
    let list = [...this.classEnrollments]
    if (filter?.userId) list = list.filter((e) => e.user_id === filter.userId)
    if (filter?.classId) list = list.filter((e) => e.class_id === filter.classId)
    if (filter?.academicPeriodId)
      list = list.filter((e) => e.academic_period_id === filter.academicPeriodId)
    if (filter?.status) list = list.filter((e) => e.status === filter.status)

    return list.map((e) => {
      const cls = this.classes.find((c) => c.id === e.class_id)
      const prof = e.user_id ? this.profiles.get(e.user_id) : null
      const student = e.student_id ? this.students.get(e.student_id) : null
      const period = this.academicPeriods.find((p) => p.id === e.academic_period_id)
      return {
        ...e,
        class_name: cls?.name ?? null,
        student_name: student?.full_name ?? prof?.full_name ?? null,
        nis: student?.nis ?? prof?.nis ?? null,
        period_name: period?.name ?? null,
      }
    })
  }

  async getActiveClassEnrollment(
    userId: string,
    academicPeriodId?: string,
  ): Promise<ClassEnrollment | null> {
    const periodId = academicPeriodId ?? this.academicPeriods.find((p) => p.is_active)?.id
    if (!periodId) return null
    const enrollment = this.classEnrollments.find(
      (e) => e.user_id === userId && e.academic_period_id === periodId && e.status === 'active',
    )
    if (!enrollment) return null
    const cls = this.classes.find((c) => c.id === enrollment.class_id)
    const prof = enrollment.user_id ? this.profiles.get(enrollment.user_id) : null
    const student = enrollment.student_id ? this.students.get(enrollment.student_id) : null
    const period = this.academicPeriods.find((p) => p.id === enrollment.academic_period_id)
    return {
      ...enrollment,
      class_name: cls?.name ?? null,
      student_name: student?.full_name ?? prof?.full_name ?? null,
      nis: student?.nis ?? prof?.nis ?? null,
      period_name: period?.name ?? null,
    }
  }

  async enrollStudentInClass(params: EnrollStudentParams): Promise<ClassEnrollment> {
    const existingActive = this.classEnrollments.find(
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
    const cls = this.classes.find((c) => c.id === params.classId)
    if (!cls) throw AppError.notFound('Class')
    const period = this.academicPeriods.find((p) => p.id === params.academicPeriodId)
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
    this.classEnrollments.push(enrollment)

    const profile = this.profiles.get(params.userId)
    if (profile) {
      profile.class_name = cls.name
      this.profiles.set(params.userId, profile)
    }

    return {
      ...enrollment,
      class_name: cls.name,
      period_name: period.name,
    }
  }

  async transferStudentEnrollment(
    params: TransferStudentEnrollmentParams,
  ): Promise<{ previous: ClassEnrollment; current: ClassEnrollment }> {
    const currentActive = this.classEnrollments.find(
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
    const targetClass = this.classes.find((c) => c.id === params.toClassId)
    if (!targetClass) throw AppError.notFound('Target class')

    const now = new Date().toISOString()
    currentActive.status = 'transferred'
    currentActive.updated_at = now

    const newEnrollment: ClassEnrollment = {
      id: `enrollment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      user_id: params.userId,
      class_id: params.toClassId,
      academic_period_id: params.academicPeriodId,
      status: 'active',
      created_at: now,
      updated_at: now,
    }
    this.classEnrollments.push(newEnrollment)

    const profile = this.profiles.get(params.userId)
    if (profile) {
      profile.class_name = targetClass.name
      this.profiles.set(params.userId, profile)
    }

    return {
      previous: { ...currentActive },
      current: {
        ...newEnrollment,
        class_name: targetClass.name,
      },
    }
  }

  async promoteStudentEnrollment(
    params: PromoteStudentEnrollmentParams,
  ): Promise<{ previous: ClassEnrollment; current: ClassEnrollment }> {
    const sourceActive = this.classEnrollments.find(
      (e) =>
        e.user_id === params.userId &&
        e.academic_period_id === params.fromAcademicPeriodId &&
        e.status === 'active',
    )
    if (!sourceActive) {
      throw AppError.notFound('Active class enrollment in source academic period')
    }
    const existingTarget = this.classEnrollments.find(
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
    const targetClass = this.classes.find((c) => c.id === params.toClassId)
    if (!targetClass) throw AppError.notFound('Target class')
    const targetPeriod = this.academicPeriods.find((p) => p.id === params.toAcademicPeriodId)
    if (!targetPeriod) throw AppError.notFound('Target academic period')

    const now = new Date().toISOString()
    sourceActive.status = 'promoted'
    sourceActive.updated_at = now

    const newEnrollment: ClassEnrollment = {
      id: `enrollment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      user_id: params.userId,
      class_id: params.toClassId,
      academic_period_id: params.toAcademicPeriodId,
      status: 'active',
      created_at: now,
      updated_at: now,
    }
    this.classEnrollments.push(newEnrollment)

    const profile = this.profiles.get(params.userId)
    if (profile) {
      profile.class_name = targetClass.name
      this.profiles.set(params.userId, profile)
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

  async exitStudentEnrollment(params: ExitStudentEnrollmentParams): Promise<ClassEnrollment> {
    const active = this.classEnrollments.find(
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

  async getStudentEnrollmentHistory(userId: string): Promise<ClassEnrollment[]> {
    return this.listClassEnrollments({ userId })
  }

  async getActivePermitsToday(
    userId: string,
    startISO: string,
    endISO: string,
  ): Promise<ActivePermitSummary[]> {
    const start = startISO.slice(0, 10)
    const end = endISO.slice(0, 10)

    return this.permits
      .filter((p) => {
        if (p.user_id !== userId || p.approval_status !== 'approved') return false
        const period = effectiveLeavePeriod(p)
        return period.start <= end && period.end >= start
      })
      .map((p) => ({
        id: p.id,
        approval_status: p.approval_status,
        kategori_izin: p.kategori_izin,
      }))
  }

  async getPermitHistory(userId: string): Promise<Permit[]> {
    return this.permits
      .filter((p) => p.user_id === userId)
      .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
      .map((p) => ({
        ...p,
        ...getLeavePeriodFields({
          date: p.tanggal,
          approval_status: p.approval_status,
          original_end_date: p.original_end_date,
          effective_end_date: p.effective_end_date,
          duration_days: p.duration_days,
        }),
      }))
  }

  async insertPermit(data: InsertPermitData): Promise<Permit> {
    const created = await this.createLeaveRequest({
      user_id: data.user_id,
      category: data.kategori_izin,
      description: data.deskripsi,
      status: data.status,
      attachment_url: data.link_foto,
      date: data.tanggal,
      approval_status: 'pending',
    })
    return {
      id: created.id,
      user_id: created.user_id,
      kategori_izin: created.category,
      deskripsi: created.description,
      status: created.status,
      link_foto: created.attachment_url,
      tanggal: created.date,
      approval_status: created.approval_status,
      created_at: created.created_at,
      updated_at: created.updated_at,
      rejection_reason: created.rejection_reason,
      rejected_at: created.rejected_at,
      requested_start_date: created.requested_start_date,
      original_end_date: created.original_end_date,
      effective_end_date: created.effective_end_date,
      duration_days: created.duration_days,
    }
  }

  async createLeaveRequest(data: CreateLeaveRequestData): Promise<LeaveRequest> {
    const approvalStatus = data.approval_status ?? 'approved'
    const status = data.status !== undefined ? data.status : approvalStatus === 'approved'
    const requestedStart = data.date.slice(0, 10)
    const pending = this.permits
      .filter((permit) => permit.user_id === data.user_id && permit.approval_status === 'pending')
      .sort(
        (a, b) =>
          (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id),
      )[0]
    if (pending) {
      throw AppError.leaveRequestPending({
        pending_request_id: pending.id,
        requested_start_date: requestedStart,
      })
    }

    const overlapping = this.permits
      .filter((permit) => {
        if (permit.user_id !== data.user_id || permit.approval_status !== 'approved') return false
        const start = permit.tanggal.slice(0, 10)
        const end = permit.effective_end_date ?? permit.original_end_date ?? start
        return requestedStart >= start && requestedStart <= end
      })
      .sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.id.localeCompare(b.id))[0]
    if (overlapping) {
      const start = overlapping.tanggal.slice(0, 10)
      const end = overlapping.effective_end_date ?? overlapping.original_end_date ?? start
      throw AppError.leavePeriodOverlap({
        overlapping_request_id: overlapping.id,
        overlapping_start_date: start,
        overlapping_end_date: end,
        requested_start_date: requestedStart,
      })
    }

    const now = new Date().toISOString()
    const id = `leave-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const permit: Permit = {
      id,
      user_id: data.user_id,
      kategori_izin: data.category,
      deskripsi: data.description,
      status,
      link_foto: data.attachment_url ?? null,
      tanggal: data.date,
      approval_status: approvalStatus,
      created_at: now,
      updated_at: now,
      rejection_reason: null,
      rejected_at: null,
      ...getLeavePeriodFields({ date: data.date, approval_status: approvalStatus }),
    }
    this.permits.push(permit)

    const profile = this.profiles.get(data.user_id)
    return {
      id,
      user_id: data.user_id,
      category: data.category,
      description: data.description,
      status,
      attachment_url: data.attachment_url ?? null,
      date: data.date,
      approval_status: approvalStatus,
      rejection_reason: null,
      rejected_at: null,
      created_at: now,
      updated_at: now,
      student_name: profile?.full_name ?? null,
      student_nis: profile?.nis ?? null,
      student_class: profile?.class_name ?? null,
      absence_number: profile?.absence_number ?? null,
      ...getLeavePeriodFields({
        date: data.date,
        approval_status: approvalStatus,
      }),
    }
  }

  async getLeaveRequestById(id: string): Promise<LeaveRequest | null> {
    const p = this.permits.find((item) => item.id === id)
    if (!p) return null
    const profile = this.profiles.get(p.user_id)
    return {
      id: p.id,
      user_id: p.user_id,
      category: p.kategori_izin,
      description: p.deskripsi,
      status: p.status,
      attachment_url: p.link_foto,
      date: p.tanggal,
      approval_status: p.approval_status,
      rejection_reason: p.rejection_reason ?? null,
      rejected_at: p.rejected_at ?? null,
      created_at: p.created_at,
      updated_at: p.updated_at ?? p.created_at,
      student_name: profile?.full_name ?? null,
      student_nis: profile?.nis ?? null,
      student_class: profile?.class_name ?? null,
      absence_number: profile?.absence_number ?? null,
      ...getLeavePeriodFields({
        date: p.tanggal,
        approval_status: p.approval_status,
        original_end_date: p.original_end_date,
        effective_end_date: p.effective_end_date,
        duration_days: p.duration_days,
      }),
    }
  }

  async listLeaveRequests(filter?: ListLeaveRequestsFilter): Promise<LeaveRequest[]> {
    let items = this.permits.slice()
    if (filter?.userId) {
      items = items.filter((p) => p.user_id === filter.userId)
    }
    if (filter?.approvalStatus) {
      items = items.filter((p) => p.approval_status === filter.approvalStatus)
    }
    if (filter?.category) {
      items = items.filter((p) => p.kategori_izin === filter.category)
    }
    if (filter?.startDate) {
      items = items.filter((p) => p.tanggal >= filter.startDate!)
    }
    if (filter?.endDate) {
      items = items.filter((p) => p.tanggal <= filter.endDate!)
    }
    items.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    if (filter?.offset) {
      items = items.slice(filter.offset)
    }
    if (filter?.limit) {
      items = items.slice(0, filter.limit)
    }
    return items.map((p) => {
      const profile = this.profiles.get(p.user_id)
      return {
        id: p.id,
        user_id: p.user_id,
        category: p.kategori_izin,
        description: p.deskripsi,
        status: p.status,
        attachment_url: p.link_foto,
        date: p.tanggal,
        approval_status: p.approval_status,
        rejection_reason: p.rejection_reason ?? null,
        rejected_at: p.rejected_at ?? null,
        created_at: p.created_at,
        updated_at: p.updated_at ?? p.created_at,
        student_name: profile?.full_name ?? null,
        student_nis: profile?.nis ?? null,
        student_class: profile?.class_name ?? null,
        absence_number: profile?.absence_number ?? null,
        ...getLeavePeriodFields({
          date: p.tanggal,
          approval_status: p.approval_status,
          original_end_date: p.original_end_date,
          effective_end_date: p.effective_end_date,
          duration_days: p.duration_days,
        }),
      }
    })
  }

  async updateLeaveRequestStatus(params: UpdateLeaveRequestStatusParams): Promise<LeaveRequest> {
    const p = this.permits.find((item) => item.id === params.id)
    if (!p) {
      throw AppError.notFound('Leave request')
    }

    if (params.approvalStatus === 'approved') {
      const durationDays = params.durationDays ?? 1
      const start = p.tanggal.slice(0, 10)
      const end = addCalendarDays(start, durationDays - 1)
      const conflictDates = new Set<string>()
      for (const attendance of this.attendancesList) {
        if (
          attendance.user_id === p.user_id &&
          isPhysicalAttendance(attendance.status, attendance.action_type) &&
          attendance.date.slice(0, 10) >= start &&
          attendance.date.slice(0, 10) <= end
        ) {
          conflictDates.add(attendance.date.slice(0, 10))
        }
      }
      for (const absence of this.absences) {
        if (
          absence.user_id === p.user_id &&
          isPhysicalAttendance(absence.status) &&
          (absence.date ?? absence.created_at).slice(0, 10) >= start &&
          (absence.date ?? absence.created_at).slice(0, 10) <= end
        ) {
          conflictDates.add((absence.date ?? absence.created_at).slice(0, 10))
        }
      }
      if (conflictDates.size > 0) {
        throw AppError.leaveApprovalConflict({
          conflicting_dates: [...conflictDates].sort(),
          requested_start_date: start,
          requested_end_date: end,
        })
      }
    }

    p.approval_status = params.approvalStatus
    p.status = params.status !== undefined ? params.status : params.approvalStatus === 'approved'
    if (params.rejectionReason !== undefined) {
      p.rejection_reason = params.rejectionReason
    } else if (params.approvalStatus === 'pending') {
      p.rejection_reason = null
    }
    if (params.approvalStatus === 'rejected') {
      p.rejected_at = params.rejectedAt ?? new Date().toISOString()
    } else if (params.approvalStatus === 'pending') {
      p.rejected_at = params.rejectedAt ?? null
    } else if (params.rejectedAt !== undefined) {
      p.rejected_at = params.rejectedAt
    }
    p.updated_at = new Date().toISOString()

    if (params.approvalStatus === 'approved') {
      const durationDays = params.durationDays ?? 1
      const start = Date.parse(`${p.tanggal.slice(0, 10)}T00:00:00Z`)
      const end = new Date(start + (durationDays - 1) * 86_400_000).toISOString().slice(0, 10)
      p.original_end_date = end
      p.effective_end_date = end
      p.duration_days = durationDays
    } else {
      p.original_end_date = undefined
      p.effective_end_date = undefined
      p.duration_days = undefined
    }

    const profile = this.profiles.get(p.user_id)
    return {
      id: p.id,
      user_id: p.user_id,
      category: p.kategori_izin,
      description: p.deskripsi,
      status: p.status,
      attachment_url: p.link_foto,
      date: p.tanggal,
      approval_status: p.approval_status,
      rejection_reason: p.rejection_reason ?? null,
      rejected_at: p.rejected_at ?? null,
      created_at: p.created_at,
      updated_at: p.updated_at,
      student_name: profile?.full_name ?? null,
      student_nis: profile?.nis ?? null,
      student_class: profile?.class_name ?? null,
      absence_number: profile?.absence_number ?? null,
      ...getLeavePeriodFields({
        date: p.tanggal,
        approval_status: p.approval_status,
        original_end_date: p.original_end_date,
        effective_end_date: p.effective_end_date,
        duration_days: p.duration_days,
      }),
    }
  }

  async forceFinishLeaveRequest(params: ForceFinishLeaveRequestParams): Promise<LeaveRequest> {
    const permit = this.permits.find((item) => item.id === params.id)
    if (!permit) throw AppError.notFound('Leave request')
    if (permit.approval_status !== 'approved') {
      throw AppError.conflict('Only an approved Leave Period can be force-finished.')
    }

    const period = effectiveLeavePeriod(permit)
    const effectiveEndDate = params.effectiveEndDate.slice(0, 10)
    if (effectiveEndDate < period.start) {
      throw AppError.validationError('Effective end date cannot precede the Leave Period start.')
    }
    if (effectiveEndDate > period.end) {
      throw AppError.conflict('Force-finish cannot extend an approved Leave Period.')
    }

    const originalEndDate = permit.original_end_date ?? period.end
    const previousEffectiveEndDate = permit.effective_end_date ?? null
    await this.insertAuditLog({
      actor_id: params.actorId,
      action: 'force_finish_leave_request',
      entity_type: 'leave_request',
      entity_id: params.id,
      details: {
        student_user_id: permit.user_id,
        category: permit.kategori_izin,
        requested_start_date: period.start,
        original_end_date: originalEndDate,
        previous_effective_end_date: previousEffectiveEndDate,
        effective_end_date: effectiveEndDate,
        reason: params.reason,
      },
    })
    permit.original_end_date = originalEndDate
    permit.effective_end_date = effectiveEndDate
    permit.updated_at = new Date().toISOString()
    const profile = this.profiles.get(permit.user_id)
    return {
      id: permit.id,
      user_id: permit.user_id,
      category: permit.kategori_izin,
      description: permit.deskripsi,
      status: permit.status,
      attachment_url: permit.link_foto,
      date: permit.tanggal,
      approval_status: permit.approval_status,
      rejection_reason: permit.rejection_reason ?? null,
      rejected_at: permit.rejected_at ?? null,
      created_at: permit.created_at,
      updated_at: permit.updated_at,
      student_name: profile?.full_name ?? null,
      student_nis: profile?.nis ?? null,
      student_class: profile?.class_name ?? null,
      absence_number: profile?.absence_number ?? null,
      ...getLeavePeriodFields({
        date: permit.tanggal,
        approval_status: permit.approval_status,
        original_end_date: permit.original_end_date,
        effective_end_date: permit.effective_end_date,
        duration_days: permit.duration_days,
      }),
    }
  }

  async deleteLeaveRequest(id: string): Promise<void> {
    const idx = this.permits.findIndex((item) => item.id === id)
    if (idx !== -1) {
      this.permits.splice(idx, 1)
    }
  }

  async validateAttendanceAction(params: {
    userId: string
    latitude: number
    longitude: number
  }): Promise<AttendanceActionRpcResponse> {
    // 1. Check geofence location policy
    const activeLocations = Array.from(this.locations.values()).filter((l) => l.is_active)
    if (activeLocations.length === 0) {
      return {
        actionable: false,
        action_type: 'none',
        message: 'No active attendance location/geofence configured.',
        details: null,
      }
    }

    // Check if user within radius of any active location
    let matchedLocation: Location | null = null
    for (const loc of activeLocations) {
      const dist = calculateDistanceMeters(
        params.latitude,
        params.longitude,
        loc.latitude,
        loc.longitude,
      )
      if (dist <= loc.radius_meters) {
        matchedLocation = loc
        break
      }
    }

    if (!matchedLocation) {
      const loc = activeLocations[0]
      return {
        actionable: false,
        action_type: 'none',
        message: `Di luar radius lokasi sekolah (${loc.name}).`,
        details: {
          location_name: loc.name,
        },
      }
    }

    // 2. Query today's attendances
    const now = new Date()
    const todayWIB = new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const attendances = this.absences.filter(
      (a) =>
        a.user_id === params.userId && (a.date === todayWIB || a.created_at.startsWith(todayWIB)),
    )

    const hasCheckedIn = attendances.some(
      (r) =>
        r.status === 'Hadir' ||
        r.status === 'Terlambat' ||
        r.status === 'Datang' ||
        r.action_type === 'check_in',
    )
    const hasCheckedOut = attendances.some((r) => r.status === 'Pulang')
    const hasAbsent = attendances.some((r) => r.status === 'Alpha')

    if (hasAbsent || (hasCheckedIn && hasCheckedOut)) {
      return {
        actionable: false,
        action_type: 'none',
        message: 'Attendance for today is already complete.',
        details: {
          location_name: matchedLocation.name,
        },
      }
    }

    const actionType: 'check_in' | 'check_out' = hasCheckedIn ? 'check_out' : 'check_in'

    return {
      actionable: true,
      action_type: actionType,
      message: 'Validation successful.',
      details: {
        location_name: matchedLocation.name,
        status: 'Hadir',
      },
    }
  }

  async saveAttendanceRecord(params: {
    userId: string
    actionType: 'check_in' | 'check_out'
    latitude: number
    longitude: number
  }): Promise<SaveAttendanceRecordRpcResponse> {
    const todayWIB = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
    assertAttendanceAllowed(this.permits, params.userId, todayWIB)
    const status = params.actionType === 'check_in' ? 'Hadir' : 'Pulang'
    const record: AttendanceRecord = {
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      user_id: params.userId,
      date: todayWIB,
      status,
      action_type: params.actionType,
      latitude: params.latitude,
      longitude: params.longitude,
      created_at: new Date().toISOString(),
    }
    this.absences.push({
      status,
      date: todayWIB,
      user_id: params.userId,
      created_at: record.created_at,
    })
    this.attendancesList.unshift(record)
    return { success: true }
  }

  async recordAttendanceAttempt(params: RecordAttendanceAttemptParams): Promise<AttendanceAttempt> {
    const attempt: AttendanceAttempt = {
      id: `attempt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      user_id: params.userId,
      action_type: params.actionType,
      status: params.status,
      reason: params.reason ?? null,
      quality_score: params.qualityScore ?? null,
      confidence: params.confidence ?? null,
      latitude: params.latitude ?? null,
      longitude: params.longitude ?? null,
      process_time_ms: params.processTimeMs ?? null,
      created_at: new Date().toISOString(),
    }
    this.attendanceAttempts.unshift(attempt)
    return { ...attempt }
  }

  async listAttendanceAttempts(filter?: {
    userId?: string
    status?: AttendanceAttemptStatus
    actionType?: AttendanceActionType
    limit?: number
  }): Promise<AttendanceAttempt[]> {
    let items = [...this.attendanceAttempts]
    if (filter?.userId) {
      items = items.filter((a) => a.user_id === filter.userId)
    }
    if (filter?.status) {
      items = items.filter((a) => a.status === filter.status)
    }
    if (filter?.actionType) {
      items = items.filter((a) => a.action_type === filter.actionType)
    }
    const limit = Math.min(Math.max(filter?.limit ?? 50, 1), 100)
    return items.slice(0, limit).map((a) => ({ ...a }))
  }

  async getAttendanceAttempt(id: string): Promise<AttendanceAttempt | null> {
    const attempt = this.attendanceAttempts.find((a) => a.id === id)
    if (!attempt) return null
    return { ...attempt }
  }

  async createManualAttendance(params: CreateManualAttendanceParams): Promise<AttendanceRecord> {
    const todayWIB =
      params.date ?? new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
    assertAttendanceAllowed(this.permits, params.userId, todayWIB)
    const status: AttendanceStatus =
      params.status ?? (params.actionType === 'check_in' ? 'Hadir' : 'Pulang')

    const record: AttendanceRecord = {
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      user_id: params.userId,
      date: todayWIB,
      status,
      action_type: params.actionType,
      latitude: params.latitude ?? null,
      longitude: params.longitude ?? null,
      created_at: new Date().toISOString(),
    }

    this.absences.push({
      status: record.status,
      date: record.date,
      user_id: record.user_id,
      created_at: record.created_at,
    })
    this.attendancesList.unshift(record)

    return { ...record }
  }

  async deleteAttendances(ids: string[]): Promise<AttendanceRecord[]> {
    const requestedIds = new Set(ids)
    const records = this.attendancesList.filter((attendance) => requestedIds.has(attendance.id))

    if (records.length !== requestedIds.size) {
      throw AppError.notFound('Attendance')
    }

    this.attendancesList = this.attendancesList.filter(
      (attendance) => !requestedIds.has(attendance.id),
    )

    // Manual attendance also maintains the legacy `absences` projection. Remove
    // only the matching projection row so unrelated mobile attendance remains.
    for (const record of records) {
      const legacyIndex = this.absences.findIndex(
        (absence) =>
          absence.user_id === record.user_id &&
          absence.date === record.date &&
          absence.status === record.status &&
          absence.created_at === record.created_at,
      )
      if (legacyIndex >= 0) this.absences.splice(legacyIndex, 1)
    }

    const recordsById = new Map(records.map((record) => [record.id, record]))
    return ids.map((id) => normalizeAttendanceRecord(recordsById.get(id)!))
  }

  async listAttendances(filter?: {
    userId?: string
    date?: string
    startDate?: string
    endDate?: string
    status?: string
    actionType?: string
    limit?: number
    offset?: number
  }): Promise<AttendanceRecord[]> {
    let items = [...this.attendancesList]
    if (filter?.userId) {
      items = items.filter((a) => a.user_id === filter.userId)
    }
    if (filter?.date) {
      items = items.filter((a) => a.date === filter.date)
    }
    if (filter?.startDate) {
      items = items.filter((a) => a.date >= filter.startDate!)
    }
    if (filter?.endDate) {
      items = items.filter((a) => a.date <= filter.endDate!)
    }
    if (filter?.status) {
      items = items.filter((a) =>
        filter.status === 'Hadir'
          ? // SAFETY: Legacy records may have unnormalized status 'Datang'
            a.status === 'Hadir' || (a.status as string) === 'Datang'
          : a.status === filter.status,
      )
    }
    if (filter?.actionType) {
      items = items.filter((a) =>
        filter.actionType === 'check_in'
          ? a.action_type === 'check_in' ||
            (a.action_type === null &&
              (a.status === 'Hadir' ||
                a.status === 'Terlambat' ||
                // SAFETY: Legacy records may have unnormalized status 'Datang'
                (a.status as string) === 'Datang'))
          : a.action_type === filter.actionType,
      )
    }
    items.sort((a, b) => {
      const createdAtOrder = b.created_at.localeCompare(a.created_at)
      return createdAtOrder || b.id.localeCompare(a.id)
    })
    // Keep the in-memory provider aligned with Postgres for the bounded
    // server-authoritative collection route. Public HTTP validation remains
    // capped at 100 rows.
    const limit = Math.min(Math.max(filter?.limit ?? 50, 1), 50_000)
    const offset = Math.max(filter?.offset ?? 0, 0)
    return items.slice(offset, offset + limit).map((a) => normalizeAttendanceRecord(a))
  }

  async getAttendance(id: string): Promise<AttendanceRecord | null> {
    const item = this.attendancesList.find((a) => a.id === id)
    return item ? normalizeAttendanceRecord(item) : null
  }

  async getSchool(): Promise<School | null> {
    if (this.schools.length === 0) return null
    return { ...this.schools[0] }
  }

  async getSchoolBySlug(slug: string): Promise<School | null> {
    const school = this.schools.find((s) => s.slug === slug)
    if (!school) return null
    return { ...school }
  }

  async createSchool(params: CreateSchoolParams): Promise<School> {
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
    this.schools.push(school)

    if (this.academicPeriods.length === 0) {
      this.academicPeriods.push({
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
      for (const p of this.academicPeriods) {
        if (p.school_id === '11111111-1111-1111-1111-111111111111') {
          p.school_id = school.id
        }
      }
      for (const c of this.classes) {
        if (c.school_id === '11111111-1111-1111-1111-111111111111') {
          c.school_id = school.id
        }
      }
    }

    return { ...school }
  }

  async createInitialSchoolAdmin(params: {
    userId: string
    fullName?: string | null
    email?: string | null
  }): Promise<UserProfile> {
    const profile: UserProfile = {
      user_id: params.userId,
      full_name: params.fullName ?? null,
      email: params.email ?? null,
      role: 'school_admin',
      lifecycle_status: 'approved',
      gender: null,
    }
    this.profiles.set(params.userId, profile)
    return { ...profile }
  }

  async stageRosterReport(params: StageRosterParams): Promise<RosterReport> {
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
    this.rosterReports.set(id, report)
    return { ...report }
  }

  async getRosterReport(id: string): Promise<RosterReport | null> {
    const report = this.rosterReports.get(id)
    if (!report) return null
    return { ...report }
  }

  async acceptRosterReport(id: string, acceptedBy: string): Promise<RosterReport> {
    const report = this.rosterReports.get(id)
    if (!report) {
      throw AppError.notFound('Roster report')
    }
    if (report.status === 'accepted') return { ...report }
    if (report.rejected_rows > 0 || report.rejected_items.length > 0) {
      throw AppError.validationError('Cannot accept a roster report with rejected rows.')
    }

    const period = report.academic_period_id
      ? this.academicPeriods.find((p) => p.id === report.academic_period_id)
      : null
    if (!period) throw AppError.validationError('Academic period is required.')
    const now = new Date().toISOString()

    const rows = report.rows.map((row) => {
      const cls = row.class_id
        ? this.classes.find(
            (candidate) =>
              candidate.id === row.class_id && candidate.academic_period_id === period.id,
          )
        : this.classes.find(
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
      if ([...this.students.values()].some((student) => student.nis === row.nis)) {
        throw AppError.conflict(`NIS "${row.nis}" already exists in the student roster.`)
      }
      if (
        this.classEnrollments.some(
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

    const previousStudents = new Map(this.students)
    const previousEnrollments = [...this.classEnrollments]
    try {
      for (const { row, cls, absenceText } of rows) {
        const student = await this.createStudent({
          nis: row.nis,
          fullName: row.full_name,
          // SAFETY: roster validation above rejects every gender except L and P.
          gender: row.gender as 'L' | 'P',
        })
        this.classEnrollments.push({
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
      this.students = previousStudents
      this.classEnrollments = previousEnrollments
      throw err
    }

    report.status = 'accepted'
    report.review_state = 'accepted'
    report.accepted_at = now
    report.accepted_by = acceptedBy
    report.updated_at = now
    this.rosterReports.set(id, report)

    return { ...report }
  }

  async openSignup(): Promise<void> {
    this.signupOpen = true
    if (this.schools.length > 0) {
      this.schools[0].signup_open = true
    }
  }

  async isSignupOpen(): Promise<boolean> {
    return this.signupOpen || this.schools[0]?.signup_open === true
  }

  async getBootstrapStatus(): Promise<BootstrapStatus> {
    const school = this.schools[0] ?? null
    let hasSchoolAdmin = false
    for (const p of this.profiles.values()) {
      if (p.role === 'school_admin' && p.lifecycle_status === 'approved') {
        hasSchoolAdmin = true
        break
      }
    }
    const activePeriod = this.academicPeriods.find((p) => p.is_active) ?? null
    const reports = Array.from(this.rosterReports.values())
    const latestReport = reports.length > 0 ? reports[reports.length - 1] : null
    const rosterAccepted = reports.some((r) => r.status === 'accepted')

    return {
      school_configured: school !== null,
      school: school ? { ...school } : null,
      school_admin_created: hasSchoolAdmin,
      active_academic_period: activePeriod !== null,
      latest_roster_report: latestReport ? { ...latestReport } : null,
      roster_accepted: rosterAccepted,
      signup_open: this.signupOpen || school?.signup_open === true,
    }
  }

  async insertAuditLog(entry: AuditLogEntry): Promise<AuditLog> {
    const log: AuditLog = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      actor_id: entry.actor_id ?? null,
      action: entry.action,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id ?? null,
      details: entry.details ? JSON.parse(JSON.stringify(entry.details)) : null,
      created_at: new Date().toISOString(),
    }
    this.auditLogs.push(log)
    return log
  }

  async getAuditLogs(entityType?: string, entityId?: string): Promise<AuditLog[]> {
    return [...this.auditLogs].reverse().filter((log) => {
      if (entityType && log.entity_type !== entityType) return false
      if (entityId && log.entity_id !== entityId) return false
      return true
    })
  }

  async getRoles(activeOnly = false): Promise<Role[]> {
    const roles = Array.from(this.roles.values())
    if (activeOnly) {
      return roles.filter((r) => r.is_active)
    }
    return roles.map((r) => ({ ...r, permissions: [...(r.permissions ?? [])] }))
  }

  async getRoleById(id: string): Promise<Role | null> {
    for (const role of this.roles.values()) {
      if (role.id === id) {
        return { ...role, permissions: [...(role.permissions ?? [])] }
      }
    }
    return null
  }

  async getRoleByName(name: string): Promise<Role | null> {
    const role = this.roles.get(name.toLowerCase())
    if (!role) return null
    return { ...role, permissions: [...(role.permissions ?? [])] }
  }

  async createRole(params: CreateRoleParams): Promise<Role> {
    const nameLower = params.name.toLowerCase()
    if (this.roles.has(nameLower)) {
      throw AppError.conflict(`Role with name "${params.name}" already exists.`)
    }
    const role: Role = {
      id: `role-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: nameLower,
      description: params.description ?? null,
      is_active: true,
      permissions: params.permissions ? [...params.permissions] : [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    this.roles.set(nameLower, role)
    return { ...role }
  }

  async updateRole(id: string, params: UpdateRoleParams): Promise<Role> {
    let targetRole: Role | null = null
    let targetKey: string | null = null
    for (const [key, role] of this.roles.entries()) {
      if (role.id === id) {
        targetRole = role
        targetKey = key
        break
      }
    }
    if (!targetRole || !targetKey) {
      throw AppError.notFound('Role')
    }

    if (params.name && params.name.toLowerCase() !== targetRole.name) {
      const newNameLower = params.name.toLowerCase()
      if (this.roles.has(newNameLower)) {
        throw AppError.conflict(`Role with name "${params.name}" already exists.`)
      }
      this.roles.delete(targetKey)
      targetRole.name = newNameLower
      targetKey = newNameLower
    }

    if (params.description !== undefined) {
      targetRole.description = params.description
    }
    if (params.permissions !== undefined) {
      targetRole.permissions = [...params.permissions]
    }
    if (params.isActive !== undefined) {
      targetRole.is_active = params.isActive
    }
    targetRole.updated_at = new Date().toISOString()
    this.roles.set(targetKey, targetRole)
    return { ...targetRole, permissions: [...(targetRole.permissions ?? [])] }
  }

  async getPermissions(): Promise<Permission[]> {
    return Array.from(this.permissions.values()).map((p) => ({ ...p }))
  }

  async createPermission(params: CreatePermissionParams): Promise<Permission> {
    const nameLower = params.name.toLowerCase()
    if (this.permissions.has(nameLower)) {
      throw AppError.conflict(`Permission with name "${params.name}" already exists.`)
    }
    const perm: Permission = {
      id: `perm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: nameLower,
      description: params.description ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    this.permissions.set(nameLower, perm)
    return { ...perm }
  }

  async getUserRoles(userId: string): Promise<string[]> {
    const assigned = this.userRoles.get(userId)
    const result = new Set<string>()
    if (assigned) {
      for (const r of assigned) result.add(r)
    }
    const profile = this.profiles.get(userId)
    if (profile?.role) {
      result.add(profile.role)
    }
    return Array.from(result)
  }

  async assignUserRoles(userId: string, roleNames: string[]): Promise<void> {
    const set = new Set<string>()
    for (const r of roleNames) {
      set.add(r.toLowerCase())
    }
    this.userRoles.set(userId, set)
  }

  async getUserEffectivePermissions(userId: string): Promise<string[]> {
    const roles = await this.getUserRoles(userId)
    const permissions = new Set<string>()
    for (const roleName of roles) {
      const role = this.roles.get(roleName.toLowerCase())
      if (role && role.is_active && role.permissions) {
        for (const p of role.permissions) {
          permissions.add(p)
        }
      }
    }
    return Array.from(permissions).sort()
  }

  async createStaffProfile(params: CreateStaffParams): Promise<UserProfile> {
    for (const p of this.profiles.values()) {
      if (p.email && p.email.toLowerCase() === params.email.toLowerCase()) {
        throw AppError.conflict(`Email "${params.email}" is already registered.`)
      }
    }

    const userId = params.userId ?? `staff-${Date.now()}`
    // SAFETY: role is verified against active roles in service
    const primaryRole = params.role as UserProfile['role']
    const profile: UserProfile = {
      user_id: userId,
      full_name: params.fullName,
      email: params.email,
      role: primaryRole,
      lifecycle_status: 'approved',
      gender: params.gender ?? null,
    }
    this.profiles.set(userId, profile)

    const allRoles = new Set<string>([params.role])
    if (params.roles) {
      for (const r of params.roles) allRoles.add(r)
    }
    this.userRoles.set(userId, allRoles)

    return { ...profile }
  }

  async getStaffProfiles(): Promise<UserProfile[]> {
    const result: UserProfile[] = []
    for (const p of this.profiles.values()) {
      if (p.role && p.role !== 'student') {
        result.push({ ...p })
      }
    }
    return result
  }

  async getStaffProfile(userId: string): Promise<UserProfile | null> {
    const profile = this.profiles.get(userId)
    if (!profile || profile.role === 'student') return null
    return { ...profile }
  }

  async updateStaffProfile(userId: string, updates: UpdateStaffParams): Promise<UserProfile> {
    const profile = this.profiles.get(userId)
    if (!profile) {
      throw AppError.notFound('Staff profile')
    }

    if (updates.fullName !== undefined) {
      profile.full_name = updates.fullName
    }
    if (updates.gender !== undefined) {
      profile.gender = updates.gender
    }
    if (updates.role !== undefined) {
      // SAFETY: updates.role is validated by schema and service
      profile.role = updates.role as UserProfile['role']
      const existingRoles = this.userRoles.get(userId) ?? new Set<string>()
      existingRoles.add(updates.role)
      this.userRoles.set(userId, existingRoles)
    }
    if (updates.roles !== undefined) {
      const set = new Set<string>(updates.roles)
      if (updates.role) set.add(updates.role)
      this.userRoles.set(userId, set)
    }
    if (updates.lifecycleStatus !== undefined) {
      profile.lifecycle_status = updates.lifecycleStatus
      if (updates.lifecycleStatus === 'disabled' || updates.lifecycleStatus === 'rejected') {
        this.revokedSessions.add(userId)
      }
    }
    this.profiles.set(userId, profile)
    return { ...profile }
  }

  async revokeUserSessions(userId: string): Promise<void> {
    this.revokedSessions.add(userId)
  }

  async isSessionRevoked(userId: string): Promise<boolean> {
    return this.revokedSessions.has(userId)
  }

  async getRosterStudentByNis(nis: string): Promise<RosterStudent | null> {
    const student = await this.getStudentByNis(nis)
    if (student) {
      const enrollment = this.classEnrollments
        .filter((candidate) => candidate.student_id === student.id && candidate.status === 'active')
        .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0]
      const cls = enrollment
        ? this.classes.find((candidate) => candidate.id === enrollment.class_id)
        : null
      const binding = this.studentBindings.get(student.id)
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
    for (const report of this.rosterReports.values()) {
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
    for (const profile of this.profiles.values()) {
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

  async listStudentProfiles(filter?: {
    lifecycle_status?: ProfileLifecycleStatus
  }): Promise<StudentRosterRow[]> {
    const rows: StudentRosterRow[] = []
    const boundUsers = new Set<string>()
    for (const student of this.students.values()) {
      const binding = this.studentBindings.get(student.id)
      const profile = binding ? this.profiles.get(binding.user_id) : null
      if (profile) boundUsers.add(profile.user_id)
      if (filter?.lifecycle_status && profile?.lifecycle_status !== filter.lifecycle_status)
        continue
      const enrollments = this.classEnrollments.filter(
        (enrollment) => enrollment.student_id === student.id && enrollment.status === 'active',
      )
      const entries = enrollments.length > 0 ? enrollments : [null]
      for (const enrollment of entries) {
        const cls = enrollment
          ? this.classes.find((candidate) => candidate.id === enrollment.class_id)
          : null
        const period = enrollment
          ? this.academicPeriods.find((candidate) => candidate.id === enrollment.academic_period_id)
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
    for (const profile of this.profiles.values()) {
      if (profile.role !== 'student' || boundUsers.has(profile.user_id)) continue
      if (filter?.lifecycle_status && profile.lifecycle_status !== filter.lifecycle_status) continue
      rows.push({ ...profile, user_id: profile.user_id, student_id: null })
    }
    return rows
  }

  async createPendingStudentProfile(params: {
    userId: string
    nis: string
    email: string
    fullName: string
    className: string
  }): Promise<UserProfile> {
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
    this.profiles.set(params.userId, profile)
    return { ...profile }
  }

  async updateProfileLifecycle(
    userId: string,
    status: ProfileLifecycleStatus,
  ): Promise<UserProfile> {
    const profile = this.profiles.get(userId)
    if (!profile) {
      throw AppError.notFound('User profile')
    }
    profile.lifecycle_status = status
    this.profiles.set(userId, profile)
    return { ...profile }
  }

  async updateProfileEmail(userId: string, email: string): Promise<UserProfile> {
    const profile = this.profiles.get(userId)
    if (!profile) {
      throw AppError.notFound('User profile')
    }
    profile.email = email
    this.profiles.set(userId, profile)
    return { ...profile }
  }

  async createPasswordResetCode(params: CreatePasswordResetCodeParams): Promise<PasswordResetCode> {
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
    this.resetCodes.push(resetCode)
    return { ...resetCode }
  }

  async getActivePasswordResetCode(
    userId: string,
    code: string,
  ): Promise<PasswordResetCode | null> {
    const now = Date.now()
    const found = this.resetCodes.find(
      (resetCode) =>
        resetCode.user_id === userId &&
        resetCode.code === code &&
        !resetCode.used &&
        new Date(resetCode.expires_at).getTime() > now,
    )
    return found ? { ...found } : null
  }

  async markPasswordResetCodeUsed(codeId: string): Promise<void> {
    const code = this.resetCodes.find((resetCode) => resetCode.id === codeId)
    if (code) {
      code.used = true
      code.used_at = new Date().toISOString()
    }
  }

  // ---------------------------------------------------------------------------
  // File records & metadata
  // ---------------------------------------------------------------------------

  async createFileRecord(params: CreateFileRecordParams): Promise<FileRecord> {
    const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = new Date().toISOString()
    const record: FileRecord = {
      id,
      user_id: params.userId,
      purpose: params.purpose,
      object_path: params.objectPath,
      content_type: params.contentType,
      size_bytes: params.sizeBytes ?? null,
      lifecycle: params.lifecycle ?? 'available',
      created_at: now,
      updated_at: now,
    }
    this.files.set(id, record)
    return { ...record }
  }

  async getFileRecord(id: string): Promise<FileRecord | null> {
    const record = this.files.get(id)
    return record ? { ...record } : null
  }

  async listFiles(filter?: {
    userId?: string
    purpose?: FilePurpose
    lifecycle?: FileLifecycle
  }): Promise<FileRecord[]> {
    let result = Array.from(this.files.values())
    if (filter?.userId) {
      result = result.filter((f) => f.user_id === filter.userId)
    }
    if (filter?.purpose) {
      result = result.filter((f) => f.purpose === filter.purpose)
    }
    if (filter?.lifecycle) {
      result = result.filter((f) => f.lifecycle === filter.lifecycle)
    }
    return result.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  }

  async updateFileLifecycle(id: string, lifecycle: FileLifecycle): Promise<FileRecord> {
    const record = this.files.get(id)
    if (!record) {
      throw AppError.notFound('File record')
    }
    const updated: FileRecord = {
      ...record,
      lifecycle,
      updated_at: new Date().toISOString(),
    }
    this.files.set(id, updated)
    return { ...updated }
  }

  async deleteFileRecord(id: string): Promise<void> {
    const record = this.files.get(id)
    if (record) {
      this.files.set(id, {
        ...record,
        lifecycle: 'deleted',
        updated_at: new Date().toISOString(),
      })
    }
  }

  async deleteFaceEnrollmentFiles(userId: string): Promise<number> {
    let count = 0
    for (const [id, file] of this.files.entries()) {
      if (
        file.user_id === userId &&
        file.purpose === 'face_enrollment' &&
        file.lifecycle !== 'deleted'
      ) {
        this.files.set(id, {
          ...file,
          lifecycle: 'deleted',
          updated_at: new Date().toISOString(),
        })
        count++
      }
    }
    return count
  }

  // ---------------------------------------------------------------------------
  // Face enrollment lifecycle
  // ---------------------------------------------------------------------------

  async getFaceEnrollment(userId: string): Promise<FaceEnrollmentRecord | null> {
    const record = this.faceEnrollments.get(userId)
    return record ? { ...record } : null
  }

  async saveFaceEnrollment(params: SaveFaceEnrollmentParams): Promise<FaceEnrollmentRecord> {
    const existing = this.faceEnrollments.get(params.userId)
    const now = new Date().toISOString()
    const record: FaceEnrollmentRecord = {
      id: existing?.id ?? `face-enrollment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      user_id: params.userId,
      status: params.status,
      sample_count: params.sampleCount ?? existing?.sample_count ?? 10,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    }
    this.faceEnrollments.set(params.userId, record)
    return { ...record }
  }

  async deleteFaceEnrollment(userId: string): Promise<void> {
    const existing = this.faceEnrollments.get(userId)
    if (existing) {
      this.faceEnrollments.set(userId, {
        ...existing,
        status: 'not_enrolled',
        sample_count: 0,
        updated_at: new Date().toISOString(),
      })
    }
  }

  // ---------------------------------------------------------------------------
  // Notification Outbox domain methods
  // ---------------------------------------------------------------------------

  async enqueueNotification(params: EnqueueNotificationParams): Promise<NotificationRecord> {
    const now = new Date().toISOString()
    const record: NotificationRecord = {
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      user_id: params.userId,
      channel: params.channel,
      payload: { ...params.payload },
      status: params.status ?? 'pending',
      retry_count: 0,
      next_retry_at: params.nextRetryAt ?? null,
      error_message: null,
      created_at: now,
      updated_at: now,
    }
    this.notifications.set(record.id, record)
    return { ...record }
  }

  async getNotificationById(id: string): Promise<NotificationRecord | null> {
    const record = this.notifications.get(id)
    return record ? { ...record } : null
  }

  async listNotifications(filter?: ListNotificationsFilter): Promise<NotificationRecord[]> {
    let result = Array.from(this.notifications.values())
    if (filter?.userId) {
      result = result.filter((n) => n.user_id === filter.userId)
    }
    if (filter?.channel) {
      result = result.filter((n) => n.channel === filter.channel)
    }
    if (filter?.status) {
      result = result.filter((n) => n.status === filter.status)
    }
    result.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    if (filter?.offset) {
      result = result.slice(filter.offset)
    }
    if (filter?.limit) {
      result = result.slice(0, filter.limit)
    }
    return result.map((r) => ({ ...r }))
  }

  async claimPendingNotifications(
    params?: ClaimPendingNotificationsParams,
  ): Promise<NotificationRecord[]> {
    const limit = params?.limit ?? 10
    const maxRetries = params?.maxRetries ?? 3
    const now = params?.now ? new Date(params.now).getTime() : Date.now()
    const claimed: NotificationRecord[] = []

    for (const record of this.notifications.values()) {
      if (claimed.length >= limit) break
      if (record.status !== 'pending') continue
      if (record.retry_count >= maxRetries) continue
      if (record.next_retry_at && new Date(record.next_retry_at).getTime() > now) continue

      const updated: NotificationRecord = {
        ...record,
        status: 'processing',
        updated_at: new Date().toISOString(),
      }
      this.notifications.set(record.id, updated)
      claimed.push({ ...updated })
    }

    return claimed
  }

  async updateNotificationStatus(
    params: UpdateNotificationStatusParams,
  ): Promise<NotificationRecord> {
    const record = this.notifications.get(params.id)
    if (!record) {
      throw AppError.notFound('Notification')
    }
    const updated: NotificationRecord = {
      ...record,
      status: params.status,
      retry_count: params.retryCount !== undefined ? params.retryCount : record.retry_count,
      next_retry_at: params.nextRetryAt !== undefined ? params.nextRetryAt : record.next_retry_at,
      error_message: params.errorMessage !== undefined ? params.errorMessage : record.error_message,
      updated_at: new Date().toISOString(),
    }
    this.notifications.set(params.id, updated)
    return { ...updated }
  }

  async deleteNotification(id: string): Promise<void> {
    this.notifications.delete(id)
  }

  async checkHealth(): Promise<boolean> {
    return this.isHealthy
  }
}

export class MemoryObjectStorage implements ObjectStorage {
  public objects = new Map<string, { buffer: Buffer; contentType: string }>()
  public isHealthy = true

  async uploadAvatar(userId: string, file: Buffer, contentType: string): Promise<string> {
    const ext = contentType === 'image/png' ? 'png' : 'jpg'
    const path = `${userId}/avatar.${ext}`
    this.objects.set(path, { buffer: file, contentType })
    return path
  }

  async deleteAvatar(userId: string): Promise<void> {
    for (const key of this.objects.keys()) {
      if (key.startsWith(`${userId}/avatar.`)) {
        this.objects.delete(key)
      }
    }
  }

  async getSignedAvatarUrl(path: string): Promise<string | null> {
    if (!path) return null
    return `https://storage.local/signed/${encodeURIComponent(path)}?expires=86400`
  }

  async uploadPermitAttachment(userId: string, file: Buffer, contentType: string): Promise<string> {
    const ext = contentType === 'image/png' ? 'png' : 'jpg'
    const path = `${userId}/${Date.now()}.${ext}`
    this.objects.set(path, { buffer: file, contentType })
    return path
  }

  async getSignedPermitUrl(path: string): Promise<string | null> {
    if (!path) return null
    return `https://storage.local/signed/${encodeURIComponent(path)}?expires=604800`
  }

  async deletePermitAttachment(path: string): Promise<void> {
    this.objects.delete(path)
  }

  async uploadFaceEnrollmentImage(
    userId: string,
    imageIndex: number,
    file: Buffer,
    contentType: string,
  ): Promise<string> {
    const ext = contentType === 'image/png' ? 'png' : 'jpg'
    const path = `${userId}/face_${imageIndex}.${ext}`
    this.objects.set(path, { buffer: file, contentType })
    return path
  }

  async deleteFaceEnrollmentImages(userId: string): Promise<void> {
    for (const key of Array.from(this.objects.keys())) {
      if (key.startsWith(`${userId}/face_`)) {
        this.objects.delete(key)
      }
    }
  }

  async deleteObject(
    _purpose: 'avatar' | 'permit_attachment' | 'face_enrollment',
    path: string,
  ): Promise<void> {
    this.objects.delete(path)
  }

  async getSignedFaceEnrollmentUrl(path: string): Promise<string | null> {
    if (!path) return null
    return `https://storage.local/signed/${encodeURIComponent(path)}?expires=86400`
  }

  async getPresignedUploadUrl(params: {
    bucket?: string
    key: string
    contentType: string
    expiresInSeconds?: number
  }): Promise<string> {
    return `https://storage.local/presigned-upload/${encodeURIComponent(params.key)}?expires=${params.expiresInSeconds ?? 900}`
  }

  async checkHealth(): Promise<boolean> {
    return this.isHealthy
  }
}

export class MemoryIdentityProvider implements IdentityProvider {
  public users = new Map<string, IdentityUser>()
  public passwords = new Map<string, string>()
  public revokedUsers = new Set<string>()
  public suspendedUsers = new Set<string>()
  public revokedSessions = new Set<string>()
  async createStudentIdentity(params: CreateStudentIdentityParams): Promise<{ userId: string }> {
    const userId = `student-identity-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    this.users.set(userId, {
      userId,
      email: params.email,
      roles: [...(params.roles ?? ['student'])],
      scopes: ['openid', 'profile'],
      mfaVerified: false,
      mustChangePassword: false,
    })
    if (params.password) {
      this.passwords.set(params.email, params.password)
    }
    if (params.suspended !== false) {
      this.suspendedUsers.add(userId)
    }
    return { userId }
  }

  async setUserSuspended(userId: string, suspended: boolean): Promise<void> {
    if (suspended) {
      this.suspendedUsers.add(userId)
    } else {
      this.suspendedUsers.delete(userId)
    }
  }

  async assignUserRole(userId: string, role: IdentityRole): Promise<void> {
    const user = this.users.get(userId)
    if (user) {
      user.roles = [...new Set([...(user.roles ?? []), role])]
      this.users.set(userId, user)
    }
  }

  async revokeUserRole(userId: string, role: IdentityRole): Promise<void> {
    const user = this.users.get(userId)
    if (user) {
      user.roles = (user.roles ?? []).filter((assignedRole) => assignedRole !== role)
      this.users.set(userId, user)
    }
  }

  async updateUserEmail(userId: string, email: string): Promise<void> {
    const user = this.users.get(userId)
    if (user) {
      this.users.set(userId, { ...user, email })
    }
  }

  public isHealthy = true

  async verifyToken(token: string): Promise<IdentityUser> {
    if (!token || token === 'invalid' || token === 'invalid.jwt.token') {
      throw AppError.authInvalid()
    }

    if (token.startsWith('user-')) {
      return {
        userId: token,
        roles: ['student'],
        scopes: ['openid', 'profile'],
        mfaVerified: false,
        mustChangePassword: false,
      }
    }

    try {
      if (token.includes('.')) {
        const parts = token.split('.')
        const rawPayload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
        const parsedPayload = identityTokenPayloadSchema.safeParse(rawPayload)
        if (parsedPayload.success) {
          const { data } = parsedPayload
          return {
            userId: data.sub,
            email: data.email,
            roles: data.roles ?? [],
            scopes: data.scope?.split(' ').filter(Boolean) ?? [],
            mfaVerified: isMfaVerified(data.mfa_verified, data.amr),
            mustChangePassword: data.must_change_password,
          }
        }
      }
    } catch {
      // Fall through to the plain mock token path.
    }

    return {
      userId: token,
      roles: ['student'],
      scopes: ['openid', 'profile'],
      mfaVerified: false,
      mustChangePassword: false,
    }
  }

  async verifyPassword(email: string, password: string): Promise<void> {
    const stored = this.passwords.get(email)
    if (stored && stored !== password) {
      throw AppError.authInvalid('Current password is incorrect.')
    }
    if (!password || password.length < 6) {
      throw AppError.authInvalid('Current password is incorrect.')
    }
  }

  async updatePassword(userId: string, newPassword: string): Promise<void> {
    this.passwords.set(userId, newPassword)
    const user = this.users.get(userId)
    if (user?.email) {
      this.passwords.set(user.email, newPassword)
    }
  }

  async updateUserMetadata(userId: string, metadata: UserMetadata): Promise<void> {
    const existing = this.users.get(userId)
    if (existing) {
      this.users.set(userId, { ...existing, ...metadata })
    }
  }

  async createStaffIdentity(params: {
    email: string
    fullName: string
    role: string
    password?: string
  }): Promise<{ userId: string; email: string }> {
    const userId = `staff-identity-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    // SAFETY: role string cast to IdentityRole array
    const role = params.role as NonNullable<IdentityUser['roles']>[number]
    this.users.set(userId, {
      userId,
      email: params.email,
      roles: [role],
      scopes: ['openid', 'profile', 'admin:read'],
      mfaVerified: true,
      mustChangePassword: false,
    })
    if (params.password) {
      this.passwords.set(params.email, params.password)
    }
    return { userId, email: params.email }
  }

  async requestPasswordResetEmail(email: string): Promise<void> {
    let found = false
    for (const u of this.users.values()) {
      if (u.email === email) {
        found = true
        break
      }
    }
    if (!found) {
      // Simulate silent success
    }
  }

  async revokeUserSessions(userId: string): Promise<void> {
    this.revokedUsers.add(userId)
    this.revokedSessions.add(userId)
  }

  async assignRoles(userId: string, roles: string[]): Promise<void> {
    const user = this.users.get(userId)
    if (user) {
      // SAFETY: string roles cast to IdentityRole array
      user.roles = roles as IdentityUser['roles']
      this.users.set(userId, user)
    }
  }

  async checkHealth(): Promise<boolean> {
    return this.isHealthy
  }
}
