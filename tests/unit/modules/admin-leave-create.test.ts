import { describe, expect, it } from 'vitest'
import { createAdminLeaveRequest } from '../../../src/modules/admin/service.js'
import { setupAdminLeaveTestEnvironment } from './admin-leave-service-harness.js'

describe('Admin Leave Requests Service — createAdminLeaveRequest', () => {
  it.each(['platform_admin', 'school_admin', 'teacher', 'staff'] as const)(
    'allows Chronos %s to create a pending request with their own attachment and audit actor',
    async (actorRole) => {
      const { domainStore, providers } = setupAdminLeaveTestEnvironment()
      const actorId = `${actorRole}-creator`
      domainStore.profiles.set(actorId, {
        user_id: actorId,
        full_name: 'Chronos creator',
        role: actorRole,
        lifecycle_status: 'approved',
      })
      const file = await domainStore.createFileRecord({
        userId: actorId,
        purpose: 'permit_attachment',
        objectPath: `${actorId}/note.jpg`,
        contentType: 'image/jpeg',
        lifecycle: 'pending_upload',
      })
      const created = await createAdminLeaveRequest({
        userId: 'student-1',
        category: 'sakit',
        description: 'Dicatat melalui Chronos',
        date: '2026-08-28',
        actorRole,
        actorId,
        fileId: file.id,
        providers,
      })
      expect(created.user_id).toBe('student-1')
      expect(created.approval_status).toBe('pending')
      expect(created.status).toBe(false)
      expect(created.attachment_url).toContain(encodeURIComponent(file.object_path))
      expect((await domainStore.getFileRecord(file.id))?.lifecycle).toBe('available')
      const logs = await domainStore.getAuditLogs('leave_request', created.id)
      expect(logs).toHaveLength(1)
      expect(logs[0].actor_id).toBe(actorId)
      expect(logs[0].details).toMatchObject({ user_id: 'student-1', approval_status: 'pending' })
    },
  )

  it.each(['pending', 'rejected', 'disabled'] as const)(
    'rejects a Chronos creation for a %s student without writing a request',
    async (lifecycleStatus) => {
      const { domainStore, providers } = setupAdminLeaveTestEnvironment()
      const student = await domainStore.getUserProfile('student-1')
      domainStore.profiles.set('student-1', { ...student, lifecycle_status: lifecycleStatus })
      await expect(
        createAdminLeaveRequest({
          userId: 'student-1',
          category: 'sakit',
          description: 'Invalid target',
          date: '2026-08-28',
          actorRole: 'teacher',
          actorId: 'teacher-1',
          providers,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
      expect(await domainStore.listLeaveRequests()).toHaveLength(0)
    },
  )

  it('does not let a Chronos user borrow a student attachment', async () => {
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()
    const file = await domainStore.createFileRecord({
      userId: 'student-1',
      purpose: 'permit_attachment',
      objectPath: 'student-1/note.jpg',
      contentType: 'image/jpeg',
      lifecycle: 'pending_upload',
    })
    await expect(
      createAdminLeaveRequest({
        userId: 'student-1',
        category: 'sakit',
        description: 'Foreign file',
        date: '2026-08-28',
        actorRole: 'teacher',
        actorId: 'teacher-1',
        fileId: file.id,
        providers,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await domainStore.getFileRecord(file.id))?.lifecycle).toBe('pending_upload')
    expect(await domainStore.listLeaveRequests()).toHaveLength(0)
  })

  it('rejects a missing actor role before creating a request', async () => {
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()
    await expect(
      createAdminLeaveRequest({
        userId: 'student-1',
        category: 'sakit',
        description: 'No role',
        date: '2026-08-28',
        actorRole: null,
        actorId: 'teacher-1',
        providers,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await domainStore.listLeaveRequests()).toHaveLength(0)
  })

  it('creates leave request with default pending status and records audit log', async () => {
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()

    const created = await createAdminLeaveRequest({
      userId: 'student-1',
      category: 'sakit',
      description: 'Sakit tifus dicatat oleh wali kelas',
      date: '2026-08-28',
      actorRole: 'student',
      actorId: 'student-1',
      providers,
    })

    expect(created.id).toBeDefined()
    expect(created.user_id).toBe('student-1')
    expect(created.student_name).toBe('Budi Santoso')
    expect(created.student_nis).toBe('1001')
    expect(created.student_class).toBe('XII RPL 1')
    expect(created.category).toBe('sakit')
    expect(created.description).toBe('Sakit tifus dicatat oleh wali kelas')
    expect(created.approval_status).toBe('pending')
    expect(created.status).toBe(false)

    // Verify audit log
    const logs = await domainStore.getAuditLogs('leave_request', created.id)
    expect(logs).toHaveLength(1)
    expect(logs[0].action).toBe('create_admin_leave_request')
    expect(logs[0].actor_id).toBe('student-1')
  })

  it.each(['approved', 'rejected'] as const)(
    'does not allow admin creation to start in %s status',
    async (approvalStatus) => {
      const { providers } = setupAdminLeaveTestEnvironment()

      await expect(
        createAdminLeaveRequest({
          userId: 'student-1',
          category: 'sakit',
          description: 'Status must transition through the reviewed endpoint',
          date: '2026-08-28',
          approvalStatus,
          actorRole: 'student',
          actorId: 'student-1',
          providers,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    },
  )

  it('creates leave request with explicit pending status and file_id attachment', async () => {
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()

    const file = await domainStore.createFileRecord({
      userId: 'student-1',
      purpose: 'permit_attachment',
      objectPath: 'student-1/surat_dokter.pdf',
      contentType: 'application/pdf',
      lifecycle: 'pending_upload',
    })

    const created = await createAdminLeaveRequest({
      userId: 'student-1',
      category: 'sakit',
      description: 'Menunggu konfirmasi dokter',
      date: '2026-08-29',
      fileId: file.id,
      approvalStatus: 'pending',
      actorRole: 'student',
      actorId: 'student-1',
      providers,
    })

    expect(created.id).toBeDefined()
    expect(created.approval_status).toBe('pending')
    expect(created.status).toBe(false)
    expect(created.attachment_url).toContain('student-1%2Fsurat_dokter.pdf')

    // Verify file lifecycle changed to available
    const updatedFile = await domainStore.getFileRecord(file.id)
    expect(updatedFile?.lifecycle).toBe('available')
  })

  it('rejects an attachment owned by another student before lifecycle promotion', async () => {
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()

    const file = await domainStore.createFileRecord({
      userId: 'student-2',
      purpose: 'permit_attachment',
      objectPath: 'student-2/surat_dokter.pdf',
      contentType: 'application/pdf',
      lifecycle: 'pending_upload',
    })

    await expect(
      createAdminLeaveRequest({
        userId: 'student-1',
        category: 'sakit',
        description: 'Tidak boleh memakai lampiran siswa lain',
        date: '2026-08-29',
        fileId: file.id,
        actorRole: 'student',
        actorId: 'student-1',
        providers,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    expect((await domainStore.getFileRecord(file.id))?.lifecycle).toBe('pending_upload')
    expect(await domainStore.listLeaveRequests()).toHaveLength(0)
  })

  it('throws notFound when target student profile does not exist', async () => {
    const { providers } = setupAdminLeaveTestEnvironment()

    await expect(
      createAdminLeaveRequest({
        userId: 'non-existent-student',
        category: 'sakit',
        description: 'Sakit',
        date: '2026-08-28',
        actorRole: 'student',
        actorId: 'non-existent-student',
        providers,
      }),
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    })
  })

  it('throws notFound when attachment file_id does not exist', async () => {
    const { providers } = setupAdminLeaveTestEnvironment()

    await expect(
      createAdminLeaveRequest({
        userId: 'student-1',
        category: 'sakit',
        description: 'Sakit',
        date: '2026-08-28',
        fileId: '00000000-0000-0000-0000-000000000000',
        actorRole: 'student',
        actorId: 'student-1',
        providers,
      }),
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    })
  })

  it('throws validationError when attachment purpose is not permit_attachment', async () => {
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()

    const file = await domainStore.createFileRecord({
      userId: 'student-1',
      purpose: 'avatar',
      objectPath: 'student-1/avatar.jpg',
      contentType: 'image/jpeg',
      lifecycle: 'available',
    })

    await expect(
      createAdminLeaveRequest({
        userId: 'student-1',
        category: 'sakit',
        description: 'Sakit',
        date: '2026-08-28',
        fileId: file.id,
        actorRole: 'student',
        actorId: 'student-1',
        providers,
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
  })

  it('forbids unauthorized student from creating admin leave request', async () => {
    const { providers } = setupAdminLeaveTestEnvironment()

    await expect(
      createAdminLeaveRequest({
        userId: 'student-2',
        category: 'sakit',
        description: 'Sakit',
        date: '2026-08-28',
        actorRole: 'student',
        actorId: 'student-1',
        providers,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })
})
