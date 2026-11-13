import {
  canRecordAttendanceAction,
  type Absence,
  type AttendanceActionRpcResponse,
  type AttendanceActionType,
  type AttendanceAttempt,
  type AttendanceAttemptStatus,
  type AttendanceRecord,
  type InsertAttendanceData,
  type Location,
  type RecordAttendanceAttemptParams,
  type SaveAttendanceRecordRpcResponse,
} from '../types.js'
import {
  assertAttendanceAllowed,
  calculateDistanceMeters,
  type MemoryDomainState,
} from './domain-state.js'

export function getMemoryTodayAbsences(
  store: MemoryDomainState,
  userId: string,
  dateWIB: string,
): Absence[] {
  return store.absences
    .filter((a) => a.user_id === userId && (a.date === dateWIB || a.created_at.startsWith(dateWIB)))
    .map((a) => ({
      ...a,
      status: a.status === 'Datang' ? 'Hadir' : a.status,
    }))
}

export function insertMemoryAttendance(
  store: MemoryDomainState,
  data: InsertAttendanceData,
): Absence {
  const record: Absence = {
    status: data.status,
    date: data.date,
    user_id: data.user_id,
    created_at: data.created_at ?? new Date().toISOString(),
  }
  store.absences.push(record)
  return record
}

export function validateMemoryAttendanceAction(
  store: MemoryDomainState,
  params: {
    userId: string
    latitude: number
    longitude: number
  },
): AttendanceActionRpcResponse {
  // 1. Check geofence location policy
  const activeLocations = Array.from(store.locations.values()).filter((l) => l.is_active)
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
  const attendances = store.absences.filter(
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

export function saveMemoryAttendanceRecord(
  store: MemoryDomainState,
  params: {
    userId: string
    actionType: 'check_in' | 'check_out'
    latitude: number
    longitude: number
    successAttempt?: Omit<RecordAttendanceAttemptParams, 'userId' | 'actionType' | 'status'>
  },
): SaveAttendanceRecordRpcResponse {
  const todayWIB = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
  assertAttendanceAllowed(store.permits, params.userId, todayWIB)
  const current = store.attendancesList.filter(
    (record) => record.user_id === params.userId && record.date === todayWIB,
  )
  if (!canRecordAttendanceAction(current, params.actionType)) {
    return {
      success: false,
      conflict: true,
      message: 'Attendance action is already recorded or is not the next action.',
    }
  }
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
  store.absences.push({
    status,
    date: todayWIB,
    user_id: params.userId,
    created_at: record.created_at,
  })
  store.attendancesList.unshift(record)
  if (params.successAttempt) {
    store.attendanceAttempts.unshift({
      id: `attempt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      user_id: params.userId,
      action_type: params.actionType,
      status: 'success',
      reason: params.successAttempt.reason ?? null,
      quality_score: params.successAttempt.qualityScore ?? null,
      confidence: params.successAttempt.confidence ?? null,
      latitude: params.successAttempt.latitude ?? null,
      longitude: params.successAttempt.longitude ?? null,
      process_time_ms: params.successAttempt.processTimeMs ?? null,
      created_at: new Date().toISOString(),
    })
  }
  return { success: true }
}

export function recordMemoryAttendanceAttempt(
  store: MemoryDomainState,
  params: RecordAttendanceAttemptParams,
): AttendanceAttempt {
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
  store.attendanceAttempts.unshift(attempt)
  return { ...attempt }
}

export function listMemoryAttendanceAttempts(
  store: MemoryDomainState,
  filter?: {
    userId?: string
    status?: AttendanceAttemptStatus
    actionType?: AttendanceActionType
    limit?: number
  },
): AttendanceAttempt[] {
  let items = [...store.attendanceAttempts]
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

export function getMemoryAttendanceAttempt(
  store: MemoryDomainState,
  id: string,
): AttendanceAttempt | null {
  const attempt = store.attendanceAttempts.find((a) => a.id === id)
  if (!attempt) return null
  return { ...attempt }
}
