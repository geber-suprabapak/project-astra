import { z } from 'zod'
import { AppError } from '../../lib/errors/app-error.js'
import {
  identityRoleSchema,
  type Absence,
  type AcademicPeriod,
  type ActivePermitSummary,
  type AttendanceActionRpcResponse,
  type AuditLog,
  type AuditLogEntry,
  type BootstrapStatus,
  type ClassEnrollment,
  type ClassRoom,
  type CreateAcademicPeriodParams,
  type CreateClassParams,
  type CreatePermissionParams,
  type CreateRoleParams,
  type CreateSchoolParams,
  type CreateStaffParams,
  type DomainStore,
  type IdentityProvider,
  type IdentityUser,
  type InsertAttendanceData,
  type InsertPermitData,
  type ObjectStorage,
  type Permission,
  type Permit,
  type Role,
  type RosterReport,
  type SaveAttendanceRecordRpcResponse,
  type Schedule,
  type School,
  type StageRosterParams,
  type UpdateRoleParams,
  type UpdateStaffParams,
  type UserMetadata,
  type UserProfile,
} from '../types.js'
import { isMfaVerified } from '../identity/claims.js'

const DEFAULT_PERMISSIONS: Permission[] = [
  { id: 'd0000000-0000-0000-0000-000000000001', name: 'admin:read', description: 'Read administrative state and session' },
  { id: 'd0000000-0000-0000-0000-000000000002', name: 'admin:write', description: 'Write administrative configuration' },
  { id: 'd0000000-0000-0000-0000-000000000003', name: 'roles:manage', description: 'Create and modify roles and permissions' },
  { id: 'd0000000-0000-0000-0000-000000000004', name: 'staff:manage', description: 'Create and manage staff members and assign roles' },
  { id: 'd0000000-0000-0000-0000-000000000005', name: 'student:manage', description: 'Manage student profiles and approvals' },
  { id: 'd0000000-0000-0000-0000-000000000006', name: 'roster:manage', description: 'Stage and review student roster imports' },
  { id: 'd0000000-0000-0000-0000-000000000007', name: 'attendance:read', description: 'View attendance records' },
  { id: 'd0000000-0000-0000-0000-000000000008', name: 'attendance:write', description: 'Submit attendance check-in/out' },
  { id: 'd0000000-0000-0000-0000-000000000009', name: 'attendance:manual', description: 'Record manual attendance exceptions' },
  { id: 'd0000000-0000-0000-0000-000000000010', name: 'leave:read', description: 'View leave requests' },
  { id: 'd0000000-0000-0000-0000-000000000011', name: 'leave:submit', description: 'Submit leave requests' },
  { id: 'd0000000-0000-0000-0000-000000000012', name: 'leave:approve', description: 'Approve or reject leave requests' },
  { id: 'd0000000-0000-0000-0000-000000000013', name: 'profile:read', description: 'View profile information' },
  { id: 'd0000000-0000-0000-0000-000000000014', name: 'profile:write', description: 'Update profile information' },
]

const DEFAULT_ROLES: Role[] = [
  {
    id: 'c0000000-0000-0000-0000-000000000001',
    name: 'platform_admin',
    description: 'Platform Administrator with full access',
    is_active: true,
    permissions: ['admin:read', 'admin:write', 'roles:manage', 'staff:manage', 'student:manage', 'roster:manage'],
  },
  {
    id: 'c0000000-0000-0000-0000-000000000002',
    name: 'school_admin',
    description: 'School Administrator for school-level operations',
    is_active: true,
    permissions: ['admin:read', 'staff:manage', 'student:manage', 'roster:manage', 'attendance:read', 'attendance:manual', 'leave:read', 'leave:approve'],
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

export class MemoryDomainStore implements DomainStore {
  public profiles = new Map<string, UserProfile>()
  public absences: Absence[] = []
  public schedules = new Map<string, Schedule>()
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
  public signupOpen = false
  public isHealthy = true

  constructor() {
    for (const perm of DEFAULT_PERMISSIONS) {
      this.permissions.set(perm.name, { ...perm })
    }
    for (const role of DEFAULT_ROLES) {
      this.roles.set(role.name, { ...role, permissions: [...(role.permissions ?? [])] })
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
    for (const profile of this.profiles.values()) {
      if (profile.nis === nis) {
        return { ...profile }
      }
    }
    return null
  }

  async getTodayAbsences(userId: string, dateWIB: string): Promise<Absence[]> {
    return this.absences.filter(
      (a) =>
        a.user_id === userId &&
        (a.date === dateWIB || a.created_at.startsWith(dateWIB)),
    )
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

  async getActiveSchedule(dayKey: string): Promise<Schedule | null> {
    const schedule = this.schedules.get(dayKey.toLowerCase())
    if (!schedule || !schedule.is_active) return null
    return { ...schedule }
  }

  async getActivePermitsToday(
    userId: string,
    startISO: string,
    endISO: string,
  ): Promise<ActivePermitSummary[]> {
    const start = new Date(startISO).getTime()
    const end = new Date(endISO).getTime()

    return this.permits
      .filter((p) => {
        if (p.user_id !== userId) return false
        if (!['pending', 'approved'].includes(p.approval_status)) return false
        const t = new Date(p.tanggal).getTime()
        return t >= start && t <= end
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
  }

  async insertPermit(data: InsertPermitData): Promise<Permit> {
    const permit: Permit = {
      id: `permit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      user_id: data.user_id,
      kategori_izin: data.kategori_izin,
      deskripsi: data.deskripsi,
      status: data.status,
      link_foto: data.link_foto,
      tanggal: data.tanggal,
      approval_status: 'pending',
      created_at: new Date().toISOString(),
      rejection_reason: null,
      rejected_at: null,
    }
    this.permits.push(permit)
    return permit
  }

  async validateAttendanceAction(_params: {
    userId: string
    latitude: number
    longitude: number
  }): Promise<AttendanceActionRpcResponse> {
    return {
      actionable: true,
      action_type: 'check_in',
      message: 'Validation successful.',
      details: {
        location_name: 'School Campus',
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
    const status = params.actionType === 'check_in' ? 'Hadir' : 'Pulang'
    this.absences.push({
      status,
      date: todayWIB,
      user_id: params.userId,
      created_at: new Date().toISOString(),
    })
    return { success: true }
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

  async getActiveAcademicPeriod(): Promise<AcademicPeriod | null> {
    const period = this.academicPeriods.find((p) => p.is_active)
    if (!period) return null
    return { ...period }
  }

  async createAcademicPeriod(params: CreateAcademicPeriodParams): Promise<AcademicPeriod> {
    const now = new Date().toISOString()
    const period: AcademicPeriod = {
      id: `period-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      school_id: params.schoolId,
      name: params.name,
      start_date: params.startDate,
      end_date: params.endDate,
      is_active: params.isActive,
      created_at: now,
      updated_at: now,
    }
    this.academicPeriods.push(period)
    return { ...period }
  }

  async getClasses(schoolId?: string): Promise<ClassRoom[]> {
    if (schoolId) {
      return this.classes.filter((c) => c.school_id === schoolId).map((c) => ({ ...c }))
    }
    return this.classes.map((c) => ({ ...c }))
  }

  async createClass(params: CreateClassParams): Promise<ClassRoom> {
    const now = new Date().toISOString()
    const cls: ClassRoom = {
      id: `class-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      school_id: params.schoolId,
      academic_period_id: params.academicPeriodId ?? null,
      name: params.name,
      grade: params.grade ?? null,
      created_at: now,
      updated_at: now,
    }
    this.classes.push(cls)
    return { ...cls }
  }

  async stageRosterReport(params: StageRosterParams): Promise<RosterReport> {
    const now = new Date().toISOString()
    const id = `roster-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const report: RosterReport = {
      id,
      school_id: params.schoolId ?? null,
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
    if (report.rejected_rows > 0 || report.rejected_items.length > 0) {
      throw AppError.validationError('Cannot accept a roster report with rejected rows.')
    }

    const school = this.schools[0]
    const period = this.academicPeriods.find((p) => p.is_active)
    const now = new Date().toISOString()

    for (const row of report.rows) {
      let cls = this.classes.find((c) => c.name.toLowerCase() === row.class_name.toLowerCase())
      if (!cls && school) {
        cls = {
          id: `class-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          school_id: school.id,
          academic_period_id: period?.id ?? null,
          name: row.class_name,
          grade: row.grade ?? null,
          created_at: now,
          updated_at: now,
        }
        this.classes.push(cls)
      }

      const studentUserId = `student-${row.nis}`
      const studentProfile: UserProfile = {
        user_id: studentUserId,
        nis: row.nis,
        full_name: row.full_name,
        class_name: row.class_name,
        role: 'student',
        lifecycle_status: 'approved',
        gender: null,
      }
      this.profiles.set(studentUserId, studentProfile)

      if (cls && period) {
        this.classEnrollments.push({
          id: `enrollment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          user_id: studentUserId,
          class_id: cls.id,
          academic_period_id: period.id,
          status: 'active',
          created_at: now,
          updated_at: now,
        })
      }
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

  async insertAuditLog(entry: AuditLogEntry): Promise<void> {
    const log: AuditLog = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      actor_id: entry.actor_id ?? null,
      action: entry.action,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id ?? null,
      details: entry.details ?? null,
      created_at: new Date().toISOString(),
    }
    this.auditLogs.push(log)
  }

  async getAuditLogs(entityType?: string, entityId?: string): Promise<AuditLog[]> {
    return this.auditLogs.filter((log) => {
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

  async uploadPermitAttachment(
    userId: string,
    file: Buffer,
    contentType: string,
  ): Promise<string> {
    const ext = contentType === 'image/png' ? 'png' : 'jpg'
    const path = `${userId}/${Date.now()}.${ext}`
    this.objects.set(path, { buffer: file, contentType })
    return path
  }

  async getSignedPermitUrl(path: string): Promise<string | null> {
    if (!path) return null
    return `https://storage.local/signed/${encodeURIComponent(path)}?expires=604800`
  }

  async checkHealth(): Promise<boolean> {
    return this.isHealthy
  }
}

export class MemoryIdentityProvider implements IdentityProvider {
  public users = new Map<string, IdentityUser>()
  public passwords = new Map<string, string>()
  public revokedUsers = new Set<string>()
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

  async updatePassword(_userId: string, _newPassword: string): Promise<void> {
    // In memory update
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
