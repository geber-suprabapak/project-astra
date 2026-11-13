import { describe, expect, it } from 'vitest'
import {
  deleteAdminLeaveRequest,
  rejectLeaveRequest,
  reopenLeaveRequest,
} from '../../../src/modules/admin/service.js'
import { setupAdminLeaveTestEnvironment } from './admin-leave-service-harness.js'

describe('Admin Leave Requests Service — Reject, Reopen & Delete Decisions', () => {
  it('does not reopen an approved Leave Period', async () => {
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()
    const permit = await domainStore.createLeaveRequest({
      user_id: 'student-1',
      category: 'sakit',
      description: 'Sakit demam',
      date: '2026-08-21T00:00:00+07:00',
      approval_status: 'approved',
    })

    await expect(
      reopenLeaveRequest({
        id: permit.id,
        actorRole: 'school_admin',
        actorId: 'admin-1',
        providers,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('rejects a leave request with reason and records an audit log', async () => {
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()

    const permit = await domainStore.insertPermit({
      user_id: 'student-1',
      kategori_izin: 'pergi',
      deskripsi: 'Liburan pribadi ke luar negeri',
      status: false,
      link_foto: null,
      tanggal: '2026-08-21T00:00:00+07:00',
    })

    const rejected = await rejectLeaveRequest({
      id: permit.id,
      reason: 'Izin liburan pribadi tidak dapat disetujui saat hari efektif KBM',
      actorRole: 'school_admin',
      actorId: 'admin-1',
      providers,
    })

    expect(rejected.id).toBe(permit.id)
    expect(rejected.approval_status).toBe('rejected')
    expect(rejected.status).toBe(false)
    expect(rejected.rejection_reason).toBe(
      'Izin liburan pribadi tidak dapat disetujui saat hari efektif KBM',
    )
    expect(rejected.rejected_at).toBeDefined()

    // Verify audit log created
    const logs = await domainStore.getAuditLogs('leave_request', permit.id)
    expect(logs).toHaveLength(1)
    expect(logs[0].action).toBe('reject_leave_request')
    expect(logs[0].actor_id).toBe('admin-1')
    expect(logs[0].details).toMatchObject({
      previous_status: 'pending',
      student_user_id: 'student-1',
      category: 'pergi',
      actor_name: 'Kepala Sekolah',
      actor_role: 'school_admin',
      rejection_reason: 'Izin liburan pribadi tidak dapat disetujui saat hari efektif KBM',
    })
  })

  it('reopens a rejected leave request to pending, resets rejection fields, records audit log and enqueues notification', async () => {
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()

    const permit = await domainStore.insertPermit({
      user_id: 'student-1',
      kategori_izin: 'sakit',
      deskripsi: 'Sakit flu',
      status: false,
      link_foto: null,
      tanggal: '2026-08-21T00:00:00+07:00',
    })

    // First reject it
    await rejectLeaveRequest({
      id: permit.id,
      reason: 'Tidak ada surat dokter',
      actorRole: 'school_admin',
      actorId: 'admin-1',
      providers,
    })

    // Now reopen it
    const reopened = await reopenLeaveRequest({
      id: permit.id,
      actorRole: 'school_admin',
      actorId: 'admin-1',
      providers,
    })

    expect(reopened.id).toBe(permit.id)
    expect(reopened.approval_status).toBe('pending')
    expect(reopened.status).toBe(false)
    expect(reopened.rejection_reason).toBeNull()
    expect(reopened.rejected_at).toBeNull()

    // Verify audit log created for reopen
    const logs = await domainStore.getAuditLogs('leave_request', permit.id)
    expect(logs).toHaveLength(2)
    const reopenLog = logs.find((l) => l.action === 'reopen_leave_request')
    expect(reopenLog).toBeDefined()
    expect(reopenLog?.actor_id).toBe('admin-1')
    expect(reopenLog?.details).toMatchObject({
      previous_status: 'rejected',
      student_user_id: 'student-1',
      category: 'sakit',
      actor_name: 'Kepala Sekolah',
      actor_role: 'school_admin',
    })

    // Verify push notification enqueued
    const notifications = await domainStore.listNotifications({ userId: 'student-1' })
    const reopenNotification = notifications.find((n) => n.payload.type === 'leave_reopened')
    expect(reopenNotification).toBeDefined()
    expect(reopenNotification?.payload.title).toBe('Pengajuan Izin Dibuka Kembali')
    expect(reopenNotification?.payload.leave_request_id).toBe(permit.id)
  })

  it('forbids students and allows staff to reopen leave requests', async () => {
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()

    const permit = await domainStore.insertPermit({
      user_id: 'student-1',
      kategori_izin: 'sakit',
      deskripsi: 'Sakit demam',
      status: false,
      link_foto: null,
      tanggal: '2026-08-21T00:00:00+07:00',
    })

    await domainStore.updateLeaveRequestStatus({
      id: permit.id,
      approvalStatus: 'rejected',
      status: false,
    })

    await expect(
      reopenLeaveRequest({
        id: permit.id,
        actorRole: 'student',
        actorId: 'student-1',
        providers,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const reopened = await reopenLeaveRequest({
      id: permit.id,
      actorRole: 'staff',
      actorId: 'staff-1',
      providers,
    })
    expect(reopened.approval_status).toBe('pending')
  })

  it('throws notFound when reopening non-existent leave request', async () => {
    const { providers } = setupAdminLeaveTestEnvironment()

    await expect(
      reopenLeaveRequest({
        id: '00000000-0000-0000-0000-000000000000',
        actorRole: 'school_admin',
        actorId: 'admin-1',
        providers,
      }),
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    })
  })

  it('deletes a leave request by school_admin and cleans up file record', async () => {
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()

    const fileRecord = await domainStore.createFileRecord({
      userId: 'student-1',
      purpose: 'permit_attachment',
      objectPath: 'student-1/surat_ijin.jpg',
      contentType: 'image/jpeg',
      lifecycle: 'available',
    })

    const permit = await domainStore.insertPermit({
      user_id: 'student-1',
      kategori_izin: 'sakit',
      deskripsi: 'Sakit cacar air',
      status: false,
      link_foto: fileRecord.object_path,
      tanggal: '2026-08-21T00:00:00+07:00',
    })

    await deleteAdminLeaveRequest({
      id: permit.id,
      actorRole: 'school_admin',
      actorId: 'admin-1',
      providers,
    })

    const fetched = await domainStore.getLeaveRequestById(permit.id)
    expect(fetched).toBeNull()

    const file = await domainStore.getFileRecord(fileRecord.id)
    expect(file?.lifecycle).toBe('deleted')

    // Verify audit log created
    const logs = await domainStore.getAuditLogs('leave_request', permit.id)
    expect(logs).toHaveLength(1)
    expect(logs[0].action).toBe('delete_leave_request')
  })

  it('forbids teacher or staff from deleting leave requests', async () => {
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()

    const permit = await domainStore.insertPermit({
      user_id: 'student-1',
      kategori_izin: 'sakit',
      deskripsi: 'Sakit cacar air',
      status: false,
      link_foto: null,
      tanggal: '2026-08-21T00:00:00+07:00',
    })

    await expect(
      deleteAdminLeaveRequest({
        id: permit.id,
        actorRole: 'teacher',
        actorId: 'teacher-1',
        providers,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    await expect(
      deleteAdminLeaveRequest({
        id: permit.id,
        actorRole: 'staff',
        actorId: 'staff-1',
        providers,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })
})
