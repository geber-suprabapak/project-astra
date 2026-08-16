import {
  getActivePermitsToday,
  getActiveSchedule,
  getTodayAbsences,
  saveAttendanceRecord,
  validateAttendanceAction,
} from '../../clients/supabase/admin.js'
import { robinClient } from '../../clients/robin/client.js'
import { AppError } from '../../lib/errors/app-error.js'
import {
  getDayKeyWIB,
  getTodayWIB,
  getWIBDayBounds,
  computeAttendanceStatus,
  getScheduleWindowForAction,
  type ScheduleWindow,
} from '../dashboard/service.js'
import { computeActionType, computeInsertStatus } from './mapper.js'

// ---------------------------------------------------------------------------
// Shared gating logic (used by both precheck and submit)
// ---------------------------------------------------------------------------

interface CheckResult {
  schedule: 'pass' | 'fail'
  permit: 'pass' | 'fail'
  enrollment: 'pass' | 'fail'
  robin: 'pass' | 'fail'
}

interface GateResult {
  allowed: boolean
  actionType: 'check_in' | 'check_out' | null
  reason: string | null
  reasonCode: string | null
  locationName: string | null
  schedule: Awaited<ReturnType<typeof getActiveSchedule>>
  isLate: boolean
  window: ScheduleWindow | null
  todayWIB: string
  checks: CheckResult
}

async function runGateChecks(params: {
  userId: string
  latitude: number
  longitude: number
  token: string
  requestId: string
}): Promise<GateResult> {
  const now = new Date()
  const todayWIB = getTodayWIB(now)
  const dayKey = getDayKeyWIB(now)
  const { startISO, endISO } = getWIBDayBounds(todayWIB)

  const defaults: CheckResult = {
    schedule: 'pass',
    permit: 'pass',
    enrollment: 'pass',
    robin: 'pass',
  }

  const [absences, schedule, activePermits, robinReady, enrollStatus] = await Promise.all([
    getTodayAbsences(params.userId, todayWIB),
    getActiveSchedule(dayKey),
    getActivePermitsToday(params.userId, startISO, endISO),
    robinClient.checkReadiness(),
    robinClient.getEnrollmentStatus(params.token, params.requestId).catch(() => ({
      status: 'not_enrolled' as const,
      embeddingCount: 0,
      message: 'Unavailable.',
    })),
  ])

  const checks: CheckResult = { ...defaults }

  if (!robinReady.healthy) {
    checks.robin = 'fail'
    return {
      allowed: false,
      actionType: null,
      reason: 'Face recognition service unavailable.',
      reasonCode: 'DEPENDENCY_UNAVAILABLE',
      locationName: null,
      schedule,
      isLate: false,
      window: null,
      todayWIB,
      checks,
    }
  }

  if (enrollStatus.status !== 'enrolled') {
    checks.enrollment = 'fail'
    return {
      allowed: false,
      actionType: null,
      reason: 'Face enrollment is required.',
      reasonCode: 'ENROLLMENT_REQUIRED',
      locationName: null,
      schedule,
      isLate: false,
      window: null,
      todayWIB,
      checks,
    }
  }

  if (activePermits.length > 0) {
    checks.permit = 'fail'
    return {
      allowed: false,
      actionType: null,
      reason: 'You have an active permit for today.',
      reasonCode: 'ATTENDANCE_BLOCKED',
      locationName: null,
      schedule,
      isLate: false,
      window: null,
      todayWIB,
      checks,
    }
  }

  if (!schedule) {
    checks.schedule = 'fail'
    return {
      allowed: false,
      actionType: null,
      reason: 'No active schedule for today.',
      reasonCode: 'ATTENDANCE_BLOCKED',
      locationName: null,
      schedule,
      isLate: false,
      window: null,
      todayWIB,
      checks,
    }
  }

  const attendanceStatus = computeAttendanceStatus(absences)
  const actionTypeResult = computeActionType(attendanceStatus)

  if (actionTypeResult === 'done') {
    return {
      allowed: false,
      actionType: null,
      reason: 'Attendance for today is already complete.',
      reasonCode: 'ATTENDANCE_BLOCKED',
      locationName: null,
      schedule,
      isLate: false,
      window: null,
      todayWIB,
      checks,
    }
  }

  const { inWindow, isLate, window } = getScheduleWindowForAction(
    schedule,
    todayWIB,
    actionTypeResult,
  )

  if (!inWindow) {
    checks.schedule = 'fail'
    return {
      allowed: false,
      actionType: null,
      reason: 'Outside of attendance window.',
      reasonCode: 'ATTENDANCE_BLOCKED',
      locationName: null,
      schedule,
      isLate: false,
      window,
      todayWIB,
      checks,
    }
  }

  const rpcResult = await validateAttendanceAction({
    userId: params.userId,
    latitude: params.latitude,
    longitude: params.longitude,
    token: params.token,
  })

  if (!rpcResult.actionable || rpcResult.action_type === 'none') {
    return {
      allowed: false,
      actionType: null,
      reason: rpcResult.message,
      reasonCode: 'ATTENDANCE_BLOCKED',
      locationName: rpcResult.details?.location_name ?? null,
      schedule,
      isLate: false,
      window,
      todayWIB,
      checks,
    }
  }

  if (rpcResult.action_type !== actionTypeResult) {
    return {
      allowed: false,
      actionType: null,
      reason: `Expected action type '${actionTypeResult}', got '${rpcResult.action_type}'.`,
      reasonCode: 'ATTENDANCE_BLOCKED',
      locationName: rpcResult.details?.location_name ?? null,
      schedule,
      isLate: false,
      window,
      todayWIB,
      checks,
    }
  }

  return {
    allowed: true,
    actionType: actionTypeResult,
    reason: null,
    reasonCode: null,
    locationName: rpcResult.details?.location_name ?? null,
    schedule,
    isLate: rpcResult.details?.status === 'Terlambat' ? true : isLate,
    window,
    todayWIB,
    checks,
  }
}

// ---------------------------------------------------------------------------
// Precheck — matches plan.md §7.2 response shape
// ---------------------------------------------------------------------------

export interface PrecheckResult {
  allowed: boolean
  action_type: 'check_in' | 'check_out' | null
  location_name: string | null
  schedule_window: ScheduleWindow | null
  checks: CheckResult
  blocking_reason: string | null
}

export async function precheck(params: {
  userId: string
  latitude: number
  longitude: number
  token: string
  requestId: string
}): Promise<PrecheckResult> {
  const gate = await runGateChecks(params)
  return {
    allowed: gate.allowed,
    action_type: gate.actionType,
    location_name: gate.locationName,
    schedule_window: gate.window,
    checks: gate.checks,
    blocking_reason: gate.reason,
  }
}

// ---------------------------------------------------------------------------
// Submit — matches plan.md §7.3 response shape
// ---------------------------------------------------------------------------

export interface SubmitResult {
  attendance_type: string
  status_label: string
  processed_ms: number
}

export async function submit(params: {
  userId: string
  actionType: 'check_in' | 'check_out'
  imageBase64: string
  latitude: number
  longitude: number
  token: string
  requestId: string
}): Promise<SubmitResult> {
  // Re-run gate checks (do not skip)
  const gate = await runGateChecks({
    userId: params.userId,
    latitude: params.latitude,
    longitude: params.longitude,
    token: params.token,
    requestId: params.requestId,
  })

  if (!gate.allowed) {
    throw AppError.attendanceBlocked(gate.reason ?? 'Attendance not allowed.')
  }

  if (gate.actionType !== params.actionType) {
    throw AppError.attendanceBlocked(
      `Expected action type '${gate.actionType}', got '${params.actionType}'.`,
    )
  }

  // Verify enrollment before calling identify
  const enrollment = await robinClient.getEnrollmentStatus(params.token, params.requestId)
  if (enrollment.status !== 'enrolled') {
    throw AppError.enrollmentRequired()
  }

  // Identify face — throws AppError.attendanceBlocked if status !== 'ok'
  const startMs = Date.now()
  const { processTimeMs } = await robinClient.identify(
    params.imageBase64,
    params.token,
    params.requestId,
  )

  // Persist attendance through the existing location-aware RPC
  const saveResult = await saveAttendanceRecord({
    userId: params.userId,
    actionType: params.actionType,
    latitude: params.latitude,
    longitude: params.longitude,
    token: params.token,
  })

  if (!saveResult.success) {
    throw AppError.internal(
      `Failed to save attendance record: ${saveResult.message ?? 'Unknown error.'}`,
    )
  }

  // Keep the outward label stable with the existing mobile contract.
  const insertStatus = computeInsertStatus(params.actionType, gate.isLate)

  return {
    attendance_type: params.actionType,
    status_label: insertStatus,
    processed_ms: processTimeMs || Date.now() - startMs,
  }
}
