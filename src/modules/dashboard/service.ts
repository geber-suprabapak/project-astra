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
import { env } from '../../config/env.js'

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

export interface DayBounds {
  startISO: string
  endISO: string
}

/** Returns WIB day bounds as ISO strings for perizinan range query */
export function getWIBDayBounds(dateWIB: string): DayBounds {
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
// Schedule window check (shared with attendance module)
// ---------------------------------------------------------------------------

export interface ScheduleWindow {
  start_at: string
  end_at: string
  action: 'check_in' | 'check_out'
  late_deadline: string | null
}

export interface ScheduleActionResult {
  inWindow: boolean
  isLate: boolean
  window: ScheduleWindow | null
}

export function getScheduleWindowForAction(
  schedule: Schedule,
  baseDateWIB: string,
  actionType: 'check_in' | 'check_out',
): ScheduleActionResult {
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
        start_at: start.toISOString(),
        end_at: lateDeadline.toISOString(),
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
        start_at: start.toISOString(),
        end_at: end.toISOString(),
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
  | { allowed: false; type: null; reason_code: string; label: string; reason_message: string }
  | {
      allowed: true
      type: 'check_in' | 'check_out'
      reason_code: null
      label: string
      reason_message: null
    }

export function computePrimaryAction(params: {
  robinHealthy: boolean
  enrollmentStatus: 'enrolled' | 'not_enrolled'
  hasActivePermit: boolean
  schedule: Schedule | null
  attendanceStatus: AttendanceStatus
  baseDateWIB: string
}): PrimaryAction {
  const {
    robinHealthy,
    enrollmentStatus,
    hasActivePermit,
    schedule,
    attendanceStatus,
    baseDateWIB,
  } = params

  if (!robinHealthy) {
    return {
      allowed: false,
      type: null,
      reason_code: 'DEPENDENCY_UNAVAILABLE',
      label: 'Layanan tidak tersedia',
      reason_message: 'Face recognition service is unavailable.',
    }
  }

  if (enrollmentStatus !== 'enrolled') {
    return {
      allowed: false,
      type: null,
      reason_code: 'ENROLLMENT_REQUIRED',
      label: 'Absensi wajah belum terdaftar',
      reason_message: 'Face enrollment is required before attendance.',
    }
  }

  if (hasActivePermit) {
    return {
      allowed: false,
      type: null,
      reason_code: 'ATTENDANCE_BLOCKED',
      label: 'Izin aktif hari ini',
      reason_message: 'You have an active permit for today.',
    }
  }

  if (!schedule) {
    return {
      allowed: false,
      type: null,
      reason_code: 'ATTENDANCE_BLOCKED',
      label: 'Tidak ada jadwal aktif',
      reason_message: 'No active schedule for today.',
    }
  }

  const { hasCheckedIn, hasCheckedOut } = attendanceStatus

  if (hasCheckedIn && hasCheckedOut) {
    return {
      allowed: false,
      type: null,
      reason_code: 'ATTENDANCE_BLOCKED',
      label: 'Absensi hari ini sudah lengkap',
      reason_message: 'Attendance for today is already complete.',
    }
  }

  const actionType: 'check_in' | 'check_out' = hasCheckedIn ? 'check_out' : 'check_in'
  const { inWindow } = getScheduleWindowForAction(schedule, baseDateWIB, actionType)

  if (!inWindow) {
    return {
      allowed: false,
      type: null,
      reason_code: 'ATTENDANCE_BLOCKED',
      label: 'Di luar jam absensi',
      reason_message: 'Outside of attendance window.',
    }
  }

  return {
    allowed: true,
    type: actionType,
    reason_code: null,
    label: actionType === 'check_in' ? 'PRESENSI' : 'PRESENSI PULANG',
    reason_message: null,
  }
}

// ---------------------------------------------------------------------------
// Helpers to compute total work hours from absence records
// ---------------------------------------------------------------------------

function computeTotalWorkHours(absences: Absence[]): number | null {
  const checkIn = absences.find((r) => r.status === 'Hadir' || r.status === 'Terlambat')
  const checkOut = absences.find((r) => r.status === 'Pulang')
  if (!checkIn || !checkOut) return null

  const inTime = new Date(checkIn.created_at).getTime()
  const outTime = new Date(checkOut.created_at).getTime()
  if (outTime <= inTime) return null
  return Math.round(((outTime - inTime) / (1000 * 60 * 60)) * 100) / 100
}

// ---------------------------------------------------------------------------
// Dashboard orchestrator — matches plan.md §7.1 response shape
// ---------------------------------------------------------------------------

export interface DashboardResponse {
  profile: {
    user_id: string
    full_name: string | null
    email: string | null | undefined
    nis: string | null | undefined
    class_name: string | null | undefined
    absence_number: string | null | undefined
    avatar_url: string | null
    role: string | null | undefined
  }
  attendance: {
    today_status: 'pending' | 'present' | 'absent' | 'leave'
    has_checked_in: boolean
    has_checked_out: boolean
    check_in_time: string | null
    check_out_time: string | null
    total_work_hours: number | null
  }
  schedule: {
    day_key: string
    start_check_in_at: string | null
    end_check_in_at: string | null
    start_check_out_at: string | null
    end_check_out_at: string | null
    compensation_minutes: number | null
  } | null
  face: {
    server_status: 'healthy' | 'unhealthy'
    enrollment_status: 'enrolled' | 'not_enrolled'
    message: string
  }
  permit: {
    has_active_permit: boolean
    active_category: string | null
  }
  primary_action: PrimaryAction
  server_time: {
    now: string
    timezone: string
    source: 'bff'
  }
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
  const [profile, absences, schedule, activePermits, robinReady, enrollStatus] = await Promise.all([
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

  // Active permit overrides status
  if (activePermits.length > 0) {
    attendanceStatus.today = 'leave'
  }

  const avatarUrl = profile.avatar_url ? await getSignedAvatarUrl(profile.avatar_url) : null

  const primaryAction = computePrimaryAction({
    robinHealthy: robinReady.healthy,
    enrollmentStatus: enrollStatus.status,
    hasActivePermit: activePermits.length > 0,
    schedule,
    attendanceStatus,
    baseDateWIB: todayWIB,
  })

  // Compute normalized schedule
  const normalizedSchedule = schedule
    ? {
        day_key: schedule.hari,
        start_check_in_at: parseScheduleTime(schedule.mulai_masuk, todayWIB)?.toISOString() ?? null,
        end_check_in_at: parseScheduleTime(schedule.selesai_masuk, todayWIB)?.toISOString() ?? null,
        start_check_out_at:
          parseScheduleTime(schedule.mulai_pulang, todayWIB)?.toISOString() ?? null,
        end_check_out_at:
          parseScheduleTime(schedule.selesai_pulang, todayWIB)?.toISOString() ?? null,
        compensation_minutes: schedule.kompensasi_waktu,
      }
    : null

  // Extract check-in/out times and total hours
  const checkInRecord = absences.find((r) => r.status === 'Hadir' || r.status === 'Terlambat')
  const checkOutRecord = absences.find((r) => r.status === 'Pulang')

  return {
    profile: {
      user_id: profile.user_id,
      full_name: profile.full_name,
      email: profile.email,
      nis: profile.nis,
      class_name: profile.class_name,
      absence_number: profile.absence_number,
      avatar_url: avatarUrl,
      role: profile.role,
    },
    attendance: {
      today_status: attendanceStatus.today,
      has_checked_in: attendanceStatus.hasCheckedIn,
      has_checked_out: attendanceStatus.hasCheckedOut,
      check_in_time: checkInRecord?.created_at ?? null,
      check_out_time: checkOutRecord?.created_at ?? null,
      total_work_hours: computeTotalWorkHours(absences),
    },
    schedule: normalizedSchedule,
    face: {
      server_status: robinReady.healthy ? 'healthy' : 'unhealthy',
      enrollment_status: enrollStatus.status,
      message:
        enrollStatus.message ?? (enrollStatus.status === 'enrolled' ? 'Ready' : 'Not enrolled.'),
    },
    permit: {
      has_active_permit: activePermits.length > 0,
      active_category: activePermits.length > 0 ? activePermits[0].kategori_izin : null,
    },
    primary_action: primaryAction,
    server_time: {
      now: now.toISOString(),
      timezone: env.businessTimezone,
      source: 'bff' as const,
    },
  }
}
