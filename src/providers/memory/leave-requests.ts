import { AppError } from '../../lib/errors/app-error.js'
import {
  getLeavePeriodFields,
  toWibDate,
  type ActivePermitSummary,
  type CreateLeaveRequestData,
  type InsertPermitData,
  type LeaveRequest,
  type ListLeaveRequestsFilter,
  type Permit,
} from '../types.js'
import { effectiveLeavePeriod, type MemoryDomainState } from './domain-state.js'

export async function leaveStudentFields(
  store: MemoryDomainState,
  userId: string,
): Promise<
  Pick<LeaveRequest, 'student_name' | 'student_nis' | 'student_class' | 'absence_number'>
> {
  const profile = store.profiles.get(userId)
  const roster =
    profile?.role === 'student' && profile.nis
      ? await store.getRosterStudentByNis(profile.nis)
      : null
  const canonical = roster?.student_id && roster.user_id === userId ? roster : null
  return {
    student_name: canonical ? canonical.full_name : (profile?.full_name ?? null),
    student_nis: profile?.nis ?? null,
    student_class: canonical ? canonical.class_name || null : (profile?.class_name ?? null),
    absence_number: canonical
      ? (canonical.absence_number ?? null)
      : (profile?.absence_number ?? null),
  }
}

export async function toLeaveRequest(
  store: MemoryDomainState,
  permit: Permit,
  normalizeDate = false,
): Promise<LeaveRequest> {
  const studentFields = await leaveStudentFields(store, permit.user_id)
  return {
    id: permit.id,
    user_id: permit.user_id,
    category: permit.kategori_izin,
    description: permit.deskripsi,
    status: permit.status,
    attachment_url: permit.link_foto,
    date: normalizeDate ? toWibDate(permit.tanggal) : permit.tanggal,
    approval_status: permit.approval_status,
    rejection_reason: permit.rejection_reason ?? null,
    rejected_at: permit.rejected_at ?? null,
    created_at: permit.created_at,
    updated_at: permit.updated_at ?? permit.created_at,
    ...studentFields,
    ...getLeavePeriodFields({
      date: permit.tanggal,
      approval_status: permit.approval_status,
      original_end_date: permit.original_end_date,
      effective_end_date: permit.effective_end_date,
      duration_days: permit.duration_days,
    }),
  }
}

export function getMemoryActivePermitsToday(
  store: MemoryDomainState,
  userId: string,
  startISO: string,
  endISO: string,
): ActivePermitSummary[] {
  const start = startISO.slice(0, 10)
  const end = endISO.slice(0, 10)

  return store.permits
    .filter((p) => {
      if (p.user_id !== userId || p.approval_status !== 'approved') return false
      const period = effectiveLeavePeriod(p)
      return period.start <= end && period.end >= start
    })
    .map((p) => ({
      id: p.id,
      approval_status: p.approval_status,
      kategori_izin: p.kategori_izin,
    }))
}

export function getMemoryPermitHistory(store: MemoryDomainState, userId: string): Permit[] {
  return store.permits
    .filter((p) => p.user_id === userId)
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    .map((p) => ({
      ...p,
      ...getLeavePeriodFields({
        date: p.tanggal,
        approval_status: p.approval_status,
        original_end_date: p.original_end_date,
        effective_end_date: p.effective_end_date,
        duration_days: p.duration_days,
      }),
    }))
}

export async function insertMemoryPermit(
  store: MemoryDomainState,
  data: InsertPermitData,
): Promise<Permit> {
  const created = await createMemoryLeaveRequest(store, {
    user_id: data.user_id,
    category: data.kategori_izin,
    description: data.deskripsi,
    status: data.status,
    attachment_url: data.link_foto,
    date: data.tanggal,
    approval_status: 'pending',
  })
  return {
    id: created.id,
    user_id: created.user_id,
    kategori_izin: created.category,
    deskripsi: created.description,
    status: created.status,
    link_foto: created.attachment_url,
    tanggal: created.date,
    approval_status: created.approval_status,
    created_at: created.created_at,
    updated_at: created.updated_at,
    rejection_reason: created.rejection_reason,
    rejected_at: created.rejected_at,
    requested_start_date: created.requested_start_date,
    original_end_date: created.original_end_date,
    effective_end_date: created.effective_end_date,
    duration_days: created.duration_days,
  }
}

export async function createMemoryLeaveRequest(
  store: MemoryDomainState,
  data: CreateLeaveRequestData,
): Promise<LeaveRequest> {
  const approvalStatus = data.approval_status ?? 'approved'
  const status = data.status !== undefined ? data.status : approvalStatus === 'approved'
  const requestedStart = toWibDate(data.date)
  const pending = store.permits
    .filter((permit) => permit.user_id === data.user_id && permit.approval_status === 'pending')
    .sort(
      (a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id),
    )[0]
  if (pending) {
    throw AppError.leaveRequestPending({
      pending_request_id: pending.id,
      requested_start_date: requestedStart,
    })
  }

  const overlapping = store.permits
    .filter((permit) => {
      if (permit.user_id !== data.user_id || permit.approval_status !== 'approved') return false
      const period = effectiveLeavePeriod(permit)
      return requestedStart <= period.end && requestedStart >= period.start
    })
    .sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.id.localeCompare(b.id))[0]
  if (overlapping) {
    const period = effectiveLeavePeriod(overlapping)
    throw AppError.leavePeriodOverlap({
      overlapping_request_id: overlapping.id,
      overlapping_start_date: period.start,
      overlapping_end_date: period.end,
      requested_start_date: requestedStart,
    })
  }

  const now = new Date().toISOString()
  const id = `leave-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const permit: Permit = {
    id,
    user_id: data.user_id,
    kategori_izin: data.category,
    deskripsi: data.description,
    status,
    link_foto: data.attachment_url ?? null,
    tanggal: data.date,
    approval_status: approvalStatus,
    created_at: now,
    updated_at: now,
    rejection_reason: null,
    rejected_at: null,
    ...getLeavePeriodFields({ date: data.date, approval_status: approvalStatus }),
  }
  store.permits.push(permit)

  return toLeaveRequest(store, permit)
}

export async function getMemoryLeaveRequestById(
  store: MemoryDomainState,
  id: string,
): Promise<LeaveRequest | null> {
  const p = store.permits.find((item) => item.id === id)
  if (!p) return null
  return toLeaveRequest(store, p)
}

export async function listMemoryLeaveRequests(
  store: MemoryDomainState,
  filter?: ListLeaveRequestsFilter,
): Promise<LeaveRequest[]> {
  let items = store.permits.slice()
  if (filter?.userId) {
    items = items.filter((p) => p.user_id === filter.userId)
  }
  if (filter?.approvalStatus) {
    items = items.filter((p) => p.approval_status === filter.approvalStatus)
  }
  if (filter?.category) {
    items = items.filter((p) => p.kategori_izin === filter.category)
  }
  if (filter?.startDate || filter?.endDate) {
    items = items.filter((p) => {
      const period = effectiveLeavePeriod(p)
      return (
        (!filter.startDate || period.end >= filter.startDate) &&
        (!filter.endDate || period.start <= filter.endDate)
      )
    })
  }
  items.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  if (filter?.offset) {
    items = items.slice(filter.offset)
  }
  if (filter?.limit) {
    items = items.slice(0, filter.limit)
  }
  return Promise.all(items.map((p) => toLeaveRequest(store, p, true)))
}

export function deleteMemoryLeaveRequest(store: MemoryDomainState, id: string): void {
  const idx = store.permits.findIndex((item) => item.id === id)
  if (idx !== -1) {
    store.permits.splice(idx, 1)
  }
}
