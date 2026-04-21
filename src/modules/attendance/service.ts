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

interface GateResult {
  allowed: boolean
  actionType: 'check_in' | 'check_out' | null
  reason: string | null
  locationName: string | null
  schedule: Awaited<ReturnType<typeof getActiveSchedule>>
  isLate: boolean
  window: ScheduleWindow | null
  todayWIB: string
}

async function runGateChecks(params: {
  userId: string
  latitude: number
  longitude: number
}): Promise<GateResult> {
  const now = new Date()
  const todayWIB = getTodayWIB(now)
  const dayKey = getDayKeyWIB(now)
  const { startISO, endISO } = getWIBDayBounds(todayWIB)

  const [absences, schedule, activePermits, robinReady] = await Promise.all([
    getTodayAbsences(params.userId, todayWIB),
    getActiveSchedule(dayKey),
    getActivePermitsToday(params.userId, startISO, endISO),
    robinClient.checkReadiness(),
  ])

  if (!robinReady.healthy) {
    return {
      allowed: false,
      actionType: null,
      reason: 'Face recognition service unavailable.',
      locationName: null,
      schedule,
      isLate: false,
      window: null,
      todayWIB,
    }
  }

  if (activePermits.length > 0) {
    return {
      allowed: false,
      actionType: null,
      reason: 'You have an active permit for today.',
      locationName: null,
      schedule,
      isLate: false,
      window: null,
      todayWIB,
    }
  }

  if (!schedule) {
    return {
      allowed: false,
      actionType: null,
      reason: 'No active schedule for today.',
      locationName: null,
      schedule,
      isLate: false,
      window: null,
      todayWIB,
    }
  }

  const attendanceStatus = computeAttendanceStatus(absences)
  const actionTypeResult = computeActionType(attendanceStatus)

  if (actionTypeResult === 'done') {
    return {
      allowed: false,
      actionType: null,
      reason: 'Attendance for today is already complete.',
      locationName: null,
      schedule,
      isLate: false,
      window: null,
      todayWIB,
    }
  }

  const { inWindow, isLate, window } = getScheduleWindowForAction(schedule, todayWIB, actionTypeResult)

  if (!inWindow) {
    return {
      allowed: false,
      actionType: null,
      reason: 'Outside of attendance window.',
      locationName: null,
      schedule,
      isLate: false,
      window,
      todayWIB,
    }
  }

  const rpcResult = await validateAttendanceAction({
    userId: params.userId,
    latitude: params.latitude,
    longitude: params.longitude,
  })

  if (!rpcResult.actionable || rpcResult.action_type === 'none') {
    return {
      allowed: false,
      actionType: null,
      reason: rpcResult.message,
      locationName: rpcResult.details?.location_name ?? null,
      schedule,
      isLate: false,
      window,
      todayWIB,
    }
  }

  if (rpcResult.action_type !== actionTypeResult) {
    return {
      allowed: false,
      actionType: null,
      reason: `Expected action type '${actionTypeResult}', got '${rpcResult.action_type}'.`,
      locationName: rpcResult.details?.location_name ?? null,
      schedule,
      isLate: false,
      window,
      todayWIB,
    }
  }

  return {
    allowed: true,
    actionType: actionTypeResult,
    reason: null,
    locationName: rpcResult.details?.location_name ?? null,
    schedule,
    isLate: rpcResult.details?.status === 'Terlambat' ? true : isLate,
    window,
    todayWIB,
  }
}

// ---------------------------------------------------------------------------
// Precheck
// ---------------------------------------------------------------------------

export interface PrecheckResult {
  allowed: boolean
  action_type: 'check_in' | 'check_out' | null
  blocking_reason: string | null
  location_name: string | null
  schedule_window: ScheduleWindow | null
}

export async function precheck(params: {
  userId: string
  latitude: number
  longitude: number
}): Promise<PrecheckResult> {
  const gate = await runGateChecks(params)
  return {
    allowed: gate.allowed,
    action_type: gate.actionType,
    blocking_reason: gate.reason,
    location_name: gate.locationName,
    schedule_window: gate.window,
  }
}

// ---------------------------------------------------------------------------
// Submit
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
    processed_ms: processTimeMs || (Date.now() - startMs),
  }
}
