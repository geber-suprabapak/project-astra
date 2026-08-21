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
  type CreateSchoolParams,
  type DomainStore,
  type IdentityProvider,
  type IdentityUser,
  type InsertAttendanceData,
  type InsertPermitData,
  type ObjectStorage,
  type Permit,
  type RosterReport,
  type SaveAttendanceRecordRpcResponse,
  type Schedule,
  type School,
  type StageRosterParams,
  type UserMetadata,
  type UserProfile,
} from '../types.js'
import { isMfaVerified } from '../identity/claims.js'

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
  public signupOpen = false
  public isHealthy = true

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

  async checkHealth(): Promise<boolean> {
    return this.isHealthy
  }
}
