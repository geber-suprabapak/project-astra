import { AppError } from '../../lib/errors/app-error.js'
import {
  canRecordAttendanceAction,
  normalizeAttendanceRecord,
  type AttendanceRecord,
  type AttendanceStatus,
  type AuditLogDetails,
  type CreateManualAttendanceParams,
} from '../types.js'
import {
  assertAttendanceAllowed,
  rollBackAuditLogs,
  rollBackNotifications,
  type MemoryDomainState,
} from './domain-state.js'

export async function createMemoryManualAttendance(
  store: MemoryDomainState,
  params: CreateManualAttendanceParams,
): Promise<AttendanceRecord> {
  const todayWIB =
    params.date ?? new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
  assertAttendanceAllowed(store.permits, params.userId, todayWIB)
  const current = store.attendancesList.filter(
    (attendance) => attendance.user_id === params.userId && attendance.date === todayWIB,
  )
  if (!canRecordAttendanceAction(current, params.actionType)) {
    throw AppError.conflict('Attendance action is already recorded or is not the next action.')
  }
  const status: AttendanceStatus =
    params.status ?? (params.actionType === 'check_in' ? 'Hadir' : 'Pulang')

  const record: AttendanceRecord = {
    id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    user_id: params.userId,
    date: todayWIB,
    status,
    action_type: params.actionType,
    latitude: params.latitude ?? null,
    longitude: params.longitude ?? null,
    created_at: new Date().toISOString(),
  }

  const auditDetails: AuditLogDetails = {
    ...params.auditDetails,
    student_user_id: params.userId,
    action_type: params.actionType,
    status: record.status,
    date: record.date,
    reason: params.reason,
    attempt_id: params.attemptId ?? null,
  }
  const existingAuditIds = new Set(store.auditLogs.map((item) => item.id))
  const existingNotifIds = new Set(store.notifications.keys())
  try {
    await store.insertAuditLog({
      actor_id: params.actorId,
      action: 'create_manual_attendance',
      entity_type: 'attendance',
      entity_id: record.id,
      details: auditDetails,
    })
    if (params.notification) {
      await store.enqueueNotification({
        ...params.notification,
        payload: {
          ...params.notification.payload,
          status: record.status,
          date: record.date,
          body: params.notification.payload.body
            ? String(params.notification.payload.body)
            : `Presensi manual (${params.actionType}) berhasil dicatat. Status: ${record.status}.`,
        },
      })
    }
  } catch (error) {
    // SAFETY: test/custom stores may persist the audit row before reporting failure.
    rollBackAuditLogs(
      store.auditLogs,
      existingAuditIds,
      params.actorId,
      'attendance',
      record.id,
      'create_manual_attendance',
    )
    rollBackNotifications(store.notifications, existingNotifIds)
    throw error
  }

  store.absences.push({
    status: record.status,
    date: record.date,
    user_id: record.user_id,
    created_at: record.created_at,
  })
  store.attendancesList.unshift(record)

  return { ...record }
}

export function deleteMemoryAttendances(
  store: MemoryDomainState,
  ids: string[],
): AttendanceRecord[] {
  const requestedIds = new Set(ids)
  const records = store.attendancesList.filter((attendance) => requestedIds.has(attendance.id))

  if (records.length !== requestedIds.size) {
    throw AppError.notFound('Attendance')
  }

  store.attendancesList = store.attendancesList.filter(
    (attendance) => !requestedIds.has(attendance.id),
  )

  // Manual attendance also maintains the legacy `absences` projection. Remove
  // only the matching projection row so unrelated mobile attendance remains.
  for (const record of records) {
    const legacyIndex = store.absences.findIndex(
      (absence) =>
        absence.user_id === record.user_id &&
        absence.date === record.date &&
        absence.status === record.status &&
        absence.created_at === record.created_at,
    )
    if (legacyIndex >= 0) store.absences.splice(legacyIndex, 1)
  }

  const recordsById = new Map(records.map((record) => [record.id, record]))
  return ids.map((id) => normalizeAttendanceRecord(recordsById.get(id)!))
}

export function listMemoryAttendances(
  store: MemoryDomainState,
  filter?: {
    userId?: string
    date?: string
    startDate?: string
    endDate?: string
    status?: string
    actionType?: string
    limit?: number
    offset?: number
  },
): AttendanceRecord[] {
  let items = [...store.attendancesList]
  if (filter?.userId) {
    items = items.filter((a) => a.user_id === filter.userId)
  }
  if (filter?.date) {
    items = items.filter((a) => a.date === filter.date)
  }
  if (filter?.startDate) {
    items = items.filter((a) => a.date >= filter.startDate!)
  }
  if (filter?.endDate) {
    items = items.filter((a) => a.date <= filter.endDate!)
  }
  if (filter?.status) {
    items = items.filter((a) =>
      filter.status === 'Hadir'
        ? // SAFETY: Legacy records may have unnormalized status 'Datang'
          a.status === 'Hadir' || (a.status as string) === 'Datang'
        : a.status === filter.status,
    )
  }
  if (filter?.actionType) {
    items = items.filter((a) =>
      filter.actionType === 'check_in'
        ? a.action_type === 'check_in' ||
          (a.action_type === null &&
            (a.status === 'Hadir' ||
              a.status === 'Terlambat' ||
              // SAFETY: Legacy records may have unnormalized status 'Datang'
              (a.status as string) === 'Datang'))
        : a.action_type === filter.actionType,
    )
  }
  items.sort((a, b) => {
    const createdAtOrder = b.created_at.localeCompare(a.created_at)
    return createdAtOrder || b.id.localeCompare(a.id)
  })
  // Keep the in-memory provider aligned with Postgres for the bounded
  // server-authoritative collection route. Public HTTP validation remains
  // capped at 100 rows.
  const limit = Math.min(Math.max(filter?.limit ?? 50, 1), 50_000)
  const offset = Math.max(filter?.offset ?? 0, 0)
  return items.slice(offset, offset + limit).map((a) => normalizeAttendanceRecord(a))
}

export function getMemoryAttendance(store: MemoryDomainState, id: string): AttendanceRecord | null {
  const item = store.attendancesList.find((a) => a.id === id)
  return item ? normalizeAttendanceRecord(item) : null
}
