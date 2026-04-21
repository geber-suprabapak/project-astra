import {
  getActivePermitsToday,
  getActiveSchedule,
  getTodayAbsences,
  getUserProfile,
  type Absence,
  type Schedule,
} from '../../clients/supabase/admin.js'
import { getSignedAvatarUrl } from '../../clients/supabase/storage.js'
import { robinClient } from '../../clients/robin/client.js'

// ---------------------------------------------------------------------------
// WIB time utilities
// ---------------------------------------------------------------------------

const DAY_KEY_MAP = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'] as const

/** Returns today's date string in WIB (UTC+7) as YYYY-MM-DD */
export function getTodayWIB(now = new Date()): string {
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  return wib.toISOString().slice(0, 10)
}

/** Returns WIB day key (minggu/senin/...) for the given UTC date */
export function getDayKeyWIB(now = new Date()): string {
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  return DAY_KEY_MAP[wib.getUTCDay()]
}

/** Returns WIB day bounds as ISO strings for perizinan range query */
export function getWIBDayBounds(dateWIB: string): { startISO: string; endISO: string } {
  return {
    startISO: `${dateWIB}T00:00:00+07:00`,
    endISO: `${dateWIB}T23:59:59.999+07:00`,
  }
}

/**
 * Parse a schedule time column (HH:mm:ss in WIB) to absolute UTC Date for a given base date.
 * The columns store WIB local time so we subtract 7 hours to get UTC.
 */
function parseScheduleTime(timeStr: string | null, baseDateWIB: string): Date | null {
  if (!timeStr) return null
  const [hStr, mStr, sStr] = timeStr.split(':')
  const h = parseInt(hStr ?? '0', 10)
  const m = parseInt(mStr ?? '0', 10)
  const s = parseInt(sStr ?? '0', 10)
  const [year = 1970, month = 1, day = 1] = baseDateWIB.split('-').map(Number)
  // h is WIB hour; to get UTC we subtract 7
  return new Date(Date.UTC(year, month - 1, day, h - 7, m, s, 0))
}

// ---------------------------------------------------------------------------
// Attendance status computation (mirrors Dashboard.tsx logic)
// ---------------------------------------------------------------------------

export interface AttendanceStatus {
  today: 'pending' | 'present' | 'absent' | 'leave'
  hasCheckedIn: boolean
  hasCheckedOut: boolean
  checkInStatus: 'Hadir' | 'Terlambat' | null
}

export function computeAttendanceStatus(absences: Absence[]): AttendanceStatus {
  const inRec = absences.find(
    (r): r is Absence & { status: 'Hadir' | 'Terlambat' } =>
      r.status === 'Hadir' || r.status === 'Terlambat',
  )
  const outRec = absences.find((r) => r.status === 'Pulang')
  const absentRec = absences.find((r) => r.status === 'Alpha')

  if (absentRec) {
    return { today: 'absent', hasCheckedIn: false, hasCheckedOut: false, checkInStatus: null }
  }

  const hasCheckedIn = Boolean(inRec)
  const hasCheckedOut = Boolean(outRec)
  const checkInStatus = inRec ? inRec.status : null

  return {
    today: hasCheckedIn ? 'present' : 'pending',
    hasCheckedIn,
    hasCheckedOut,
    checkInStatus,
  }
}

// ---------------------------------------------------------------------------
// Schedule window check
// ---------------------------------------------------------------------------

export interface ScheduleWindow {
  start: string
  end: string
  action: 'check_in' | 'check_out'
  late_deadline: string | null
}

export function getScheduleWindowForAction(
  schedule: Schedule,
  baseDateWIB: string,
  actionType: 'check_in' | 'check_out',
): { inWindow: boolean; isLate: boolean; window: ScheduleWindow | null } {
  const now = new Date()

  if (actionType === 'check_in') {
    const start = parseScheduleTime(schedule.mulai_masuk, baseDateWIB)
    const end = parseScheduleTime(schedule.selesai_masuk, baseDateWIB)
    if (!start || !end) return { inWindow: false, isLate: false, window: null }

    const lateDeadline = schedule.kompensasi_waktu
      ? new Date(end.getTime() + schedule.kompensasi_waktu * 60 * 1000)
      : end

    const inWindow = now >= start && now <= lateDeadline
    const isLate = now > end && now <= lateDeadline

    return {
      inWindow,
      isLate,
      window: {
        start: start.toISOString(),
        end: lateDeadline.toISOString(),
        action: 'check_in',
        late_deadline: lateDeadline.toISOString(),
      },
    }
  } else {
    const start = parseScheduleTime(schedule.mulai_pulang, baseDateWIB)
    const end = parseScheduleTime(schedule.selesai_pulang, baseDateWIB)
    if (!start || !end) return { inWindow: false, isLate: false, window: null }

    const inWindow = now >= start && now <= end
    return {
      inWindow,
      isLate: false,
      window: {
        start: start.toISOString(),
        end: end.toISOString(),
        action: 'check_out',
        late_deadline: null,
      },
    }
  }
}

// ---------------------------------------------------------------------------
// Primary action gate
// ---------------------------------------------------------------------------

export type PrimaryAction =
  | { allowed: false; type: null; reason_code: string; label: string }
  | { allowed: true; type: 'check_in' | 'check_out'; reason_code: null; label: string }

export function computePrimaryAction(params: {
  robinHealthy: boolean
  enrollmentStatus: 'enrolled' | 'not_enrolled'
  hasActivePermit: boolean
  schedule: Schedule | null
  attendanceStatus: AttendanceStatus
  baseDateWIB: string
}): PrimaryAction {
  const { robinHealthy, enrollmentStatus, hasActivePermit, schedule, attendanceStatus, baseDateWIB } = params

  if (!robinHealthy) {
    return { allowed: false, type: null, reason_code: 'DEPENDENCY_UNAVAILABLE', label: 'Layanan tidak tersedia' }
  }

  if (enrollmentStatus !== 'enrolled') {
    return { allowed: false, type: null, reason_code: 'ENROLLMENT_REQUIRED', label: 'Absensi wajah belum terdaftar' }
  }

  if (hasActivePermit) {
    return { allowed: false, type: null, reason_code: 'ATTENDANCE_BLOCKED', label: 'Izin aktif hari ini' }
  }

  if (!schedule) {
    return { allowed: false, type: null, reason_code: 'ATTENDANCE_BLOCKED', label: 'Tidak ada jadwal aktif' }
  }

  const { hasCheckedIn, hasCheckedOut } = attendanceStatus

  if (hasCheckedIn && hasCheckedOut) {
    return { allowed: false, type: null, reason_code: 'ATTENDANCE_BLOCKED', label: 'Absensi hari ini sudah lengkap' }
  }

  const actionType: 'check_in' | 'check_out' = hasCheckedIn ? 'check_out' : 'check_in'
  const { inWindow } = getScheduleWindowForAction(schedule, baseDateWIB, actionType)

  if (!inWindow) {
    return { allowed: false, type: null, reason_code: 'ATTENDANCE_BLOCKED', label: 'Di luar jam absensi' }
  }

  return {
    allowed: true,
    type: actionType,
    reason_code: null,
    label: actionType === 'check_in' ? 'PRESENSI' : 'PRESENSI PULANG',
  }
}

// ---------------------------------------------------------------------------
// Dashboard orchestrator
// ---------------------------------------------------------------------------

export interface DashboardResponse {
  profile: {
    user_id: string
    full_name: string | null
    nis: string | null | undefined
    class_name: string | null | undefined
    role: string | null | undefined
    avatar_url: string | null
  }
  today_date: string
  today_status: AttendanceStatus
  primary_action: PrimaryAction
  schedule: Schedule | null
  service_operational: boolean
}

export async function getDashboard(
  userId: string,
  token: string,
  requestId: string,
): Promise<DashboardResponse> {
  const now = new Date()
  const todayWIB = getTodayWIB(now)
  const dayKey = getDayKeyWIB(now)
  const { startISO, endISO } = getWIBDayBounds(todayWIB)

  // All parallel fetches
  const [profile, absences, schedule, activePermits, robinReady, enrollStatus] =
    await Promise.all([
      getUserProfile(userId),
      getTodayAbsences(userId, todayWIB),
      getActiveSchedule(dayKey),
      getActivePermitsToday(userId, startISO, endISO),
      robinClient.checkReadiness(),
      robinClient.getEnrollmentStatus(token, requestId).catch(() => ({
        status: 'not_enrolled' as const,
        embeddingCount: 0,
        message: 'Unavailable.',
      })),
    ])

  const attendanceStatus = computeAttendanceStatus(absences)

  // Active permit check
  if (activePermits.length > 0) {
    attendanceStatus.today = 'leave'
  }

  const avatarUrl = profile.avatar_url
    ? await getSignedAvatarUrl(profile.avatar_url)
    : null

  const primaryAction = computePrimaryAction({
    robinHealthy: robinReady.healthy,
    enrollmentStatus: enrollStatus.status,
    hasActivePermit: activePermits.length > 0,
    schedule,
    attendanceStatus,
    baseDateWIB: todayWIB,
  })

  return {
    profile: {
      user_id: profile.user_id,
      full_name: profile.full_name,
      nis: profile.nis,
      class_name: profile.class_name,
      role: profile.role,
      avatar_url: avatarUrl,
    },
    today_date: todayWIB,
    today_status: attendanceStatus,
    primary_action: primaryAction,
    schedule,
    service_operational: robinReady.healthy,
  }
}
