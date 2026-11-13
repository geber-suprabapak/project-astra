import { AppError } from '../../lib/errors/app-error.js'
import { defaultProviders } from '../../providers/index.js'
import type { AppProviders } from '../../providers/types.js'
import type { ScheduleWindow } from '../dashboard/service.js'
import { type CheckResult, runGateChecks } from './gate.js'
import { computeInsertStatus } from './mapper.js'

// ---------------------------------------------------------------------------
// Precheck
// ---------------------------------------------------------------------------

export interface PrecheckResult {
  allowed: boolean
  action_type: 'check_in' | 'check_out' | null
  location_name: string | null
  schedule_window: ScheduleWindow | null
  checks: CheckResult
  blocking_reason: string | null
}

export async function precheck(
  params: {
    userId: string
    latitude: number
    longitude: number
    token: string
    requestId: string
    providers?: AppProviders
  },
  providers?: AppProviders,
): Promise<PrecheckResult> {
  const actualProviders = params.providers ?? providers ?? defaultProviders
  const gate = await runGateChecks(params, actualProviders)
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
// Submit
// ---------------------------------------------------------------------------

export interface SubmitResult {
  attendance_type: string
  status_label: string
  processed_ms: number
}

export async function submit(
  params: {
    userId: string
    actionType: 'check_in' | 'check_out'
    imageBase64: string
    latitude: number
    longitude: number
    token: string
    requestId: string
    providers?: AppProviders
  },
  providers?: AppProviders,
): Promise<SubmitResult> {
  const actualProviders = params.providers ?? providers ?? defaultProviders

  // Re-run gate checks (do not skip)
  const gate = await runGateChecks(
    {
      userId: params.userId,
      latitude: params.latitude,
      longitude: params.longitude,
      token: params.token,
      requestId: params.requestId,
    },
    actualProviders,
  )

  if (!gate.allowed) {
    if (gate.reasonCode === 'ENROLLMENT_REQUIRED') {
      throw AppError.enrollmentRequired()
    }
    throw AppError.attendanceBlocked(gate.reason ?? 'Attendance not allowed.')
  }

  if (gate.actionType !== params.actionType) {
    throw AppError.attendanceBlocked(
      `Expected action type '${gate.actionType}', got '${params.actionType}'.`,
    )
  }

  // Identify face — throws on network/timeout/503/400 or returns non-match / match
  const startMs = Date.now()
  let identifyResult: {
    status?: string
    confidence?: number
    qualityScore?: number
    processTimeMs?: number
    message?: string
  }

  try {
    identifyResult = await actualProviders.robinClient.identify(
      params.imageBase64,
      params.token,
      params.requestId,
    )
  } catch (err) {
    const elapsedMs = Date.now() - startMs
    if (err instanceof AppError && err.code === 'UPSTREAM_TIMEOUT') {
      await actualProviders.domainStore.recordAttendanceAttempt({
        userId: params.userId,
        actionType: params.actionType,
        status: 'error',
        reason: 'Face verification service timeout.',
        latitude: params.latitude,
        longitude: params.longitude,
        processTimeMs: elapsedMs,
      })
      throw err
    }

    if (err instanceof AppError && err.code === 'DEPENDENCY_UNAVAILABLE') {
      await actualProviders.domainStore.recordAttendanceAttempt({
        userId: params.userId,
        actionType: params.actionType,
        status: 'error',
        reason: 'Face verification service unavailable.',
        latitude: params.latitude,
        longitude: params.longitude,
        processTimeMs: elapsedMs,
      })
      throw err
    }

    const reason = err instanceof AppError ? err.message : 'Face verification error.'
    await actualProviders.domainStore.recordAttendanceAttempt({
      userId: params.userId,
      actionType: params.actionType,
      status: 'failed',
      reason,
      latitude: params.latitude,
      longitude: params.longitude,
      processTimeMs: elapsedMs,
    })
    throw err
  }

  const isMatch = identifyResult.status === 'ok'

  const processTimeMs = identifyResult.processTimeMs ?? Date.now() - startMs

  if (!isMatch) {
    const reason = identifyResult.message || 'Face does not match enrolled face.'
    await actualProviders.domainStore.recordAttendanceAttempt({
      userId: params.userId,
      actionType: params.actionType,
      status: 'failed',
      reason,
      confidence: identifyResult.confidence,
      qualityScore: identifyResult.qualityScore,
      latitude: params.latitude,
      longitude: params.longitude,
      processTimeMs,
    })
    throw AppError.attendanceBlocked(reason)
  }

  // Persist attendance through DomainStore
  const saveResult = await actualProviders.domainStore.saveAttendanceRecord({
    userId: params.userId,
    actionType: params.actionType,
    latitude: params.latitude,
    longitude: params.longitude,
    successAttempt: {
      reason: identifyResult.message || 'Face verified successfully',
      confidence: identifyResult.confidence,
      qualityScore: identifyResult.qualityScore,
      latitude: params.latitude,
      longitude: params.longitude,
      processTimeMs,
    },
  })

  if (!saveResult.success) {
    if (saveResult.conflict) {
      throw AppError.attendanceBlocked(
        saveResult.message ?? 'Attendance action is no longer available.',
      )
    }
    throw AppError.internal(
      `Failed to save attendance record: ${saveResult.message ?? 'Unknown error.'}`,
    )
  }

  const insertStatus = computeInsertStatus(params.actionType, gate.isLate)

  return {
    attendance_type: params.actionType,
    status_label: insertStatus,
    processed_ms: processTimeMs,
  }
}
