import { AppError } from '../../lib/errors/app-error.js'
import type {
  Absence,
  ActivePermitSummary,
  AttendanceActionRpcResponse,
  DomainStore,
  IdentityProvider,
  IdentityUser,
  InsertAttendanceData,
  InsertPermitData,
  ObjectStorage,
  Permit,
  SaveAttendanceRecordRpcResponse,
  Schedule,
  UserProfile,
} from '../types.js'

export class MemoryDomainStore implements DomainStore {
  public profiles = new Map<string, UserProfile>()
  public absences: Absence[] = []
  public schedules = new Map<string, Schedule>()
  public permits: Permit[] = []
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

  async validateAttendanceAction(params: {
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
      return { userId: token }
    }

    // Attempt base64 decode of mock tokens or sub
    try {
      if (token.includes('.')) {
        const parts = token.split('.')
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
        if (payload.sub) {
          return { userId: payload.sub, email: payload.email, ...payload }
        }
      }
    } catch {
      // Fall through
    }

    return { userId: token }
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
    // In memory update
  }

  async updateUserMetadata(userId: string, metadata: Record<string, unknown>): Promise<void> {
    const existing = this.users.get(userId)
    if (existing) {
      this.users.set(userId, { ...existing, ...metadata })
    }
  }

  async checkHealth(): Promise<boolean> {
    return this.isHealthy
  }
}
