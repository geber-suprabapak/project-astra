import { AppError } from '../../lib/errors/app-error.js'
import { defaultProviders } from '../../providers/index.js'
import type { AppProviders, Schedule } from '../../providers/types.js'
import {
  computeAttendanceStatus,
  getDayKeyWIB,
  getScheduleWindowForAction,
  getTodayWIB,
  getWIBDayBounds,
  type ScheduleWindow,
} from '../dashboard/service.js'
import { computeActionType } from './mapper.js'

// ---------------------------------------------------------------------------
// Shared gating logic (used by both precheck and submit)
// ---------------------------------------------------------------------------

export interface CheckResult {
  schedule: 'pass' | 'fail'
  permit: 'pass' | 'fail'
  enrollment: 'pass' | 'fail'
  robin: 'pass' | 'fail'
}

export interface GateResult {
  allowed: boolean
  actionType: 'check_in' | 'check_out' | null
  reason: string | null
  reasonCode: string | null
  locationName: string | null
  schedule: Schedule | null
  isLate: boolean
  window: ScheduleWindow | null
  todayWIB: string
  checks: CheckResult
}

export async function runGateChecks(
  params: {
    userId: string
    latitude: number
    longitude: number
    token: string
    requestId: string
    providers?: AppProviders
  },
  providers?: AppProviders,
): Promise<GateResult> {
  const actualProviders = params.providers ?? providers ?? defaultProviders
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

  type GateEnrollmentCheck =
    | { status: 'enrolled' | 'not_enrolled'; embeddingCount: number; message: string }
    | { status: 'unavailable'; embeddingCount: number; message: string }

  const [absences, activePermits, robinReady, enrollStatus, activePeriod] = await Promise.all([
    actualProviders.domainStore.getTodayAbsences(params.userId, todayWIB),
    actualProviders.domainStore.getActivePermitsToday(params.userId, startISO, endISO),
    actualProviders.robinClient.checkReadiness(),
    actualProviders.robinClient
      .getEnrollmentStatus(params.token, params.requestId)
      .catch((err): GateEnrollmentCheck => {
        if (
          err instanceof AppError &&
          (err.code === 'UPSTREAM_TIMEOUT' || err.code === 'DEPENDENCY_UNAVAILABLE')
        ) {
          return {
            status: 'unavailable',
            embeddingCount: 0,
            message: err.message,
          }
        }
        return {
          status: 'not_enrolled',
          embeddingCount: 0,
          message: 'Unavailable.',
        }
      }),
    actualProviders.domainStore.getActiveAcademicPeriod(),
  ])

  const checks: CheckResult = { ...defaults }

  if (!robinReady.healthy || enrollStatus.status === 'unavailable') {
    checks.robin = 'fail'
    return {
      allowed: false,
      actionType: null,
      reason: 'Face recognition service unavailable.',
      reasonCode: 'DEPENDENCY_UNAVAILABLE',
      locationName: null,
      schedule: null,
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
      schedule: null,
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
      schedule: null,
      isLate: false,
      window: null,
      todayWIB,
      checks,
    }
  }

  if (!activePeriod) {
    checks.schedule = 'fail'
    return {
      allowed: false,
      actionType: null,
      reason: 'No active academic period configured.',
      reasonCode: 'ATTENDANCE_BLOCKED',
      locationName: null,
      schedule: null,
      isLate: false,
      window: null,
      todayWIB,
      checks,
    }
  }

  const activeEnrollment = await actualProviders.domainStore.getActiveClassEnrollment(
    params.userId,
    activePeriod.id,
  )
  if (!activeEnrollment) {
    checks.schedule = 'fail'
    return {
      allowed: false,
      actionType: null,
      reason: 'Student has no active class enrollment for the current academic period.',
      reasonCode: 'ATTENDANCE_BLOCKED',
      locationName: null,
      schedule: null,
      isLate: false,
      window: null,
      todayWIB,
      checks,
    }
  }

  const calendarException = await actualProviders.domainStore.getCalendarExceptionByDate(
    todayWIB,
    activePeriod.id,
  )
  if (calendarException && calendarException.is_holiday) {
    checks.schedule = 'fail'
    return {
      allowed: false,
      actionType: null,
      reason: `Today is a scheduled calendar exception/holiday: ${calendarException.reason}`,
      reasonCode: 'ATTENDANCE_BLOCKED',
      locationName: null,
      schedule: null,
      isLate: false,
      window: null,
      todayWIB,
      checks,
    }
  }

  const schedule = await actualProviders.domainStore.getActiveSchedule(dayKey, {
    classId: activeEnrollment.class_id,
    academicPeriodId: activePeriod.id,
  })

  if (!schedule) {
    checks.schedule = 'fail'
    return {
      allowed: false,
      actionType: null,
      reason: 'No active schedule for today.',
      reasonCode: 'ATTENDANCE_BLOCKED',
      locationName: null,
      schedule: null,
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

  const rpcResult = await actualProviders.domainStore.validateAttendanceAction({
    userId: params.userId,
    latitude: params.latitude,
    longitude: params.longitude,
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
