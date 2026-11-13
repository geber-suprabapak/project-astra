import { describe, expect, it } from 'vitest'
import {
  approveLeaveRequest,
  forceFinishLeaveRequest,
  rejectLeaveRequest,
  reopenLeaveRequest,
} from '../../../src/modules/admin/service.js'
import { setupAdminLeaveTestEnvironment } from './admin-leave-service-harness.js'

describe('Admin Leave Requests Service — Audit Failure Atomicity & Force-Finish', () => {
  it('keeps a Leave Request pending when the approval audit write fails', async () => {
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()
    const permit = await domainStore.createLeaveRequest({
      user_id: 'student-1',
      category: 'sakit',
      description: 'Synthetic audit failure case',
      date: '2026-08-21T00:00:00+07:00',
      approval_status: 'pending',
    })
    domainStore.insertAuditLog = async () => {
      throw new Error('synthetic audit failure')
    }

    await expect(
      approveLeaveRequest({
        id: permit.id,
        actorRole: 'school_admin',
        actorId: 'admin-1',
        durationDays: 3,
        providers,
      }),
    ).rejects.toThrow('synthetic audit failure')

    expect(await domainStore.getLeaveRequestById(permit.id)).toMatchObject({
      approval_status: 'pending',
      status: false,
      original_end_date: null,
      effective_end_date: null,
    })
    expect(await domainStore.getAuditLogs('leave_request', permit.id)).toHaveLength(0)
  })

  it('keeps a Leave Request pending when the rejection audit write fails', async () => {
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()
    const permit = await domainStore.createLeaveRequest({
      user_id: 'student-1',
      category: 'sakit',
      description: 'Synthetic audit failure case',
      date: '2026-08-21T00:00:00+07:00',
      approval_status: 'pending',
    })
    domainStore.insertAuditLog = async () => {
      throw new Error('synthetic audit failure')
    }

    await expect(
      rejectLeaveRequest({
        id: permit.id,
        reason: 'Synthetic rejection reason',
        actorRole: 'school_admin',
        actorId: 'admin-1',
        providers,
      }),
    ).rejects.toThrow('synthetic audit failure')

    expect(await domainStore.getLeaveRequestById(permit.id)).toMatchObject({
      approval_status: 'pending',
      status: false,
      rejection_reason: null,
      rejected_at: null,
    })
    expect(await domainStore.getAuditLogs('leave_request', permit.id)).toHaveLength(0)
  })

  it('preserves a rejected Leave Request when its reopen audit write fails', async () => {
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()
    const permit = await domainStore.createLeaveRequest({
      user_id: 'student-1',
      category: 'sakit',
      description: 'Synthetic audit failure case',
      date: '2026-08-21T00:00:00+07:00',
      approval_status: 'pending',
    })
    const rejectedAt = '2026-08-22T12:00:00.000Z'
    await domainStore.updateLeaveRequestStatus({
      id: permit.id,
      approvalStatus: 'rejected',
      rejectionReason: 'Synthetic rejection reason',
      rejectedAt,
    })
    domainStore.insertAuditLog = async () => {
      throw new Error('synthetic audit failure')
    }

    await expect(
      reopenLeaveRequest({
        id: permit.id,
        actorRole: 'school_admin',
        actorId: 'admin-1',
        providers,
      }),
    ).rejects.toThrow('synthetic audit failure')

    expect(await domainStore.getLeaveRequestById(permit.id)).toMatchObject({
      approval_status: 'rejected',
      status: false,
      rejection_reason: 'Synthetic rejection reason',
      rejected_at: rejectedAt,
    })
    expect(await domainStore.getAuditLogs('leave_request', permit.id)).toHaveLength(0)
  })

  it('discards partially written audit rows when the approval audit write fails mid-write', async () => {
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()
    const permit = await domainStore.createLeaveRequest({
      user_id: 'student-1',
      category: 'sakit',
      description: 'Synthetic mid-write audit failure case',
      date: '2026-08-21T00:00:00+07:00',
      approval_status: 'pending',
    })
    const originalInsertAuditLog = domainStore.insertAuditLog.bind(domainStore)
    domainStore.insertAuditLog = async (entry) => {
      await originalInsertAuditLog(entry)
      await originalInsertAuditLog({ ...entry, action: `${entry.action}_duplicate` })
      throw new Error('synthetic audit failure after persist')
    }

    await expect(
      approveLeaveRequest({
        id: permit.id,
        actorRole: 'school_admin',
        actorId: 'admin-1',
        durationDays: 3,
        providers,
      }),
    ).rejects.toThrow('synthetic audit failure after persist')

    expect(await domainStore.getLeaveRequestById(permit.id)).toMatchObject({
      approval_status: 'pending',
      status: false,
      original_end_date: null,
      effective_end_date: null,
      duration_days: null,
    })
    expect(await domainStore.getAuditLogs('leave_request', permit.id)).toHaveLength(0)
    expect(await domainStore.getAuditLogs()).toHaveLength(0)
    domainStore.insertAuditLog = originalInsertAuditLog
  })

  it('does not duplicate the audit log when a repeated decision conflicts', async () => {
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()
    const permit = await domainStore.createLeaveRequest({
      user_id: 'student-1',
      category: 'sakit',
      description: 'Synthetic repeated decision case',
      date: '2026-08-21T00:00:00+07:00',
      approval_status: 'pending',
    })
    await approveLeaveRequest({
      id: permit.id,
      actorRole: 'school_admin',
      actorId: 'admin-1',
      durationDays: 3,
      providers,
    })

    await expect(
      approveLeaveRequest({
        id: permit.id,
        actorRole: 'school_admin',
        actorId: 'admin-1',
        durationDays: 3,
        providers,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })

    const logs = await domainStore.getAuditLogs('leave_request', permit.id)
    expect(logs).toHaveLength(1)
    expect(logs[0].action).toBe('approve_leave_request')
    expect(logs[0].actor_id).toBe('admin-1')
  })

  it('does not shorten the Leave Period when its required audit insert fails', async () => {
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()
    const permit = await domainStore.createLeaveRequest({
      user_id: 'student-1',
      category: 'sakit',
      description: 'Sakit demam',
      date: '2026-08-21T00:00:00+07:00',
      approval_status: 'pending',
    })
    await domainStore.updateLeaveRequestStatus({
      id: permit.id,
      approvalStatus: 'approved',
      durationDays: 3,
    })
    const originalInsertAuditLog = domainStore.insertAuditLog.bind(domainStore)
    domainStore.insertAuditLog = async () => {
      throw new Error('audit database unavailable')
    }

    await expect(
      forceFinishLeaveRequest({
        id: permit.id,
        effectiveEndDate: '2026-08-21',
        reason: 'Student returned early',
        actorRole: 'school_admin',
        actorId: 'admin-1',
        providers,
      }),
    ).rejects.toThrow('audit database unavailable')

    const unchanged = await domainStore.getLeaveRequestById(permit.id)
    expect(unchanged).toMatchObject({
      original_end_date: '2026-08-23',
      effective_end_date: '2026-08-23',
    })
    expect(await domainStore.getAuditLogs('leave_request', permit.id)).toHaveLength(0)
    domainStore.insertAuditLog = originalInsertAuditLog
  })

  it.each(['platform_admin', 'school_admin', 'teacher', 'staff'] as const)(
    'allows Chronos %s to force-finish with audited actor attribution',
    async (actorRole) => {
      const { domainStore, providers } = setupAdminLeaveTestEnvironment()
      const permit = await domainStore.insertPermit({
        user_id: 'student-1',
        kategori_izin: 'sakit',
        deskripsi: 'Synthetic early return',
        status: false,
        link_foto: null,
        tanggal: '2026-08-21T00:00:00+07:00',
      })
      await approveLeaveRequest({
        id: permit.id,
        actorRole: 'school_admin',
        actorId: 'admin-1',
        durationDays: 3,
        providers,
      })

      const actorId = `${actorRole}-decision-actor`
      domainStore.profiles.set(actorId, {
        user_id: actorId,
        full_name: `Decision Actor ${actorRole}`,
        role: actorRole,
        lifecycle_status: 'approved',
      })
      const finished = await forceFinishLeaveRequest({
        id: permit.id,
        effectiveEndDate: '2026-08-22',
        reason: 'Student returned early',
        actorRole,
        actorId,
        providers,
      })

      expect(finished.effective_end_date).toBe('2026-08-22')
      const logs = await domainStore.getAuditLogs('leave_request', permit.id)
      expect(logs.find((entry) => entry.action === 'force_finish_leave_request')).toMatchObject({
        actor_id: actorId,
        action: 'force_finish_leave_request',
        details: { actor_name: `Decision Actor ${actorRole}`, actor_role: actorRole },
      })
    },
  )

  it('denies student force-finish without changing the approved Leave Period', async () => {
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()
    const permit = await domainStore.insertPermit({
      user_id: 'student-1',
      kategori_izin: 'sakit',
      deskripsi: 'Synthetic denied force-finish',
      status: false,
      link_foto: null,
      tanggal: '2026-08-21T00:00:00+07:00',
    })
    await approveLeaveRequest({
      id: permit.id,
      actorRole: 'school_admin',
      actorId: 'admin-1',
      durationDays: 3,
      providers,
    })

    await expect(
      forceFinishLeaveRequest({
        id: permit.id,
        effectiveEndDate: '2026-08-22',
        reason: 'Unauthorized actor',
        actorRole: 'student',
        actorId: 'student-1',
        providers,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    expect((await domainStore.getLeaveRequestById(permit.id))?.effective_end_date).toBe(
      '2026-08-23',
    )
    expect(await domainStore.getAuditLogs('leave_request', permit.id)).toHaveLength(1)
  })
})
