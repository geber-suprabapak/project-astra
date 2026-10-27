import { describe, it, expect } from 'vitest'
import { MemoryDomainStore } from '../../../src/providers/memory/index.js'

async function setup() {
  const store = new MemoryDomainStore()
  const legacy = {
    user_id: 'projection-user',
    nis: '73001',
    full_name: 'Legacy Name',
    class_name: 'Legacy Class',
    absence_number: '9',
    role: 'student' as const,
    lifecycle_status: 'approved' as const,
    gender: null,
  }
  store.profiles.set(legacy.user_id, { ...legacy })
  const student = await store.createStudent({
    nis: legacy.nis,
    fullName: 'Canonical Name',
    gender: 'P',
  })
  await store.bindStudentToUser({ studentId: student.id, userId: legacy.user_id })
  const cls = await store.createClass({ name: 'Canonical Class' })
  store.classEnrollments.push({
    id: 'old-enrollment',
    student_id: student.id,
    user_id: legacy.user_id,
    class_id: cls.id,
    academic_period_id: 'old-period',
    status: 'active',
    absence_number: '8',
    created_at: '2034-07-01T00:00:00Z',
  })
  store.classEnrollments.push({
    id: 'new-enrollment',
    student_id: student.id,
    user_id: legacy.user_id,
    class_id: cls.id,
    academic_period_id: 'new-period',
    status: 'active',
    absence_number: '2',
    created_at: '2034-08-01T00:00:00Z',
  })
  return { store, legacy, student }
}

describe('leave profile projection', () => {
  it('uses the bound canonical name/class/latest active absence on create, list, detail and decision response without rewriting profile', async () => {
    const { store, legacy } = await setup()
    const created = await store.createLeaveRequest({
      user_id: legacy.user_id,
      category: 'sakit',
      description: 'Projection test',
      date: '2035-02-01',
    })
    const updated = await store.updateLeaveRequestStatus({
      id: created.id,
      approvalStatus: 'rejected',
      rejectionReason: 'Test',
    })
    for (const row of [
      created,
      await store.getLeaveRequestById(created.id),
      ...(await store.listLeaveRequests({ userId: legacy.user_id })),
      updated,
    ]) {
      expect(row).toMatchObject({
        student_name: 'Canonical Name',
        student_class: 'Canonical Class',
        student_nis: legacy.nis,
        absence_number: '2',
      })
    }
    expect(updated.approval_status).toBe('rejected')
    expect(store.profiles.get(legacy.user_id)).toEqual(legacy)
    expect(store.classEnrollments.map((e) => e.absence_number)).toEqual(['8', '2'])
  })

  it('uses canonical fields when force-finishing an approved leave', async () => {
    const { store, legacy } = await setup()
    const created = await store.createLeaveRequest({
      user_id: legacy.user_id,
      category: 'sakit',
      description: 'Projection test',
      date: '2035-02-01',
    })
    const finished = await store.forceFinishLeaveRequest({
      id: created.id,
      actorId: 'qa-admin',
      effectiveEndDate: '2035-02-01',
      reason: 'Recovered',
    })
    expect(finished).toMatchObject({
      student_name: 'Canonical Name',
      student_class: 'Canonical Class',
      absence_number: '2',
      effective_end_date: '2035-02-01',
    })
    expect(store.profiles.get(legacy.user_id)).toEqual(legacy)
  })

  it('keeps legacy fields for an unmatched binding, but clears stale class/absence when the bound student has no active enrollment', async () => {
    const { store, legacy, student } = await setup()
    const created = await store.createLeaveRequest({
      user_id: legacy.user_id,
      category: 'sakit',
      description: 'Projection test',
      date: '2035-02-01',
    })
    store.studentBindings.get(student.id)!.user_id = 'other-user'
    expect(await store.getLeaveRequestById(created.id)).toMatchObject({
      student_name: legacy.full_name,
      student_class: legacy.class_name,
      absence_number: '9',
    })
    store.studentBindings.get(student.id)!.user_id = legacy.user_id
    for (const e of store.classEnrollments) e.status = 'archived'
    expect(await store.getLeaveRequestById(created.id)).toMatchObject({
      student_name: 'Canonical Name',
      student_class: null,
      absence_number: null,
    })
    expect(store.profiles.get(legacy.user_id)).toEqual(legacy)
  })
})
