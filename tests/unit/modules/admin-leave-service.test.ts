import { describe, expect, it } from 'vitest'
import {
  approveLeaveRequest,
  createAdminLeaveRequest,
  deleteAdminLeaveRequest,
  forceFinishLeaveRequest,
  getAdminLeaveRequest,
  listAdminLeaveRequests,
  rejectLeaveRequest,
  reopenLeaveRequest,
} from '../../../src/modules/admin/service.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { RobinClient } from '../../../src/clients/robin/client.js'

function setupTestEnvironment() {
  const domainStore = new MemoryDomainStore()
  const objectStorage = new MemoryObjectStorage()
  const identityProvider = new MemoryIdentityProvider()

  const defaultRobinClient: RobinClient = {
    checkReadiness: async () => ({ healthy: true }),
    getEnrollmentStatus: async () => ({
      status: 'enrolled',
      embeddingCount: 10,
      message: 'Ready.',
    }),
    enroll: async () => ({ imagesProcessed: 10, imagesFailed: 0, totalEmbeddings: 10 }),
    identify: async () => ({
      status: 'ok',
      confidence: 0.94,
      qualityScore: 0.91,
      processTimeMs: 38,
      message: 'Face verified successfully',
    }),
    deleteEnrollment: async () => {},
  }

  const providers = {
    domainStore,
    objectStorage,
    identityProvider,
    robinClient: defaultRobinClient,
  }

  // Setup students
  domainStore.profiles.set('student-1', {
    user_id: 'student-1',
    full_name: 'Budi Santoso',
    nis: '1001',
    class_name: 'XII RPL 1',
    absence_number: '05',
    role: 'student',
    lifecycle_status: 'approved',
  })

  domainStore.profiles.set('student-2', {
    user_id: 'student-2',
    full_name: 'Siti Aminah',
    nis: '1002',
    class_name: 'XII TKJ 2',
    absence_number: '12',
    role: 'student',
    lifecycle_status: 'approved',
  })

  // Setup staff/admin users
  domainStore.profiles.set('admin-1', {
    user_id: 'admin-1',
    full_name: 'Kepala Sekolah',
    role: 'school_admin',
    lifecycle_status: 'approved',
  })

  domainStore.profiles.set('teacher-1', {
    user_id: 'teacher-1',
    full_name: 'Wali Kelas XII RPL 1',
    role: 'teacher',
    lifecycle_status: 'approved',
  })

  domainStore.profiles.set('staff-1', {
    user_id: 'staff-1',
    full_name: 'Tata Usaha',
    role: 'staff',
    lifecycle_status: 'approved',
  })

  return { domainStore, objectStorage, identityProvider, providers }
}

describe('Admin Leave Requests Service', () => {
  it('does not shorten the Leave Period when its required audit insert fails', async () => {
    const { domainStore, providers } = setupTestEnvironment()
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

  it('lists leave requests with student profile enrichment and filters', async () => {
    const { domainStore, providers } = setupTestEnvironment()

    await domainStore.insertPermit({
      user_id: 'student-1',
      kategori_izin: 'sakit',
      deskripsi: 'Sakit tifus rawat inap',
      status: false,
      link_foto: 'student-1/surat_dokter.jpg',
      tanggal: '2026-08-21T00:00:00+07:00',
    })

    await domainStore.insertPermit({
      user_id: 'student-2',
      kategori_izin: 'pergi',
      deskripsi: 'Mengikuti acara keluarga di luar kota',
      status: false,
      link_foto: null,
      tanggal: '2026-08-22T00:00:00+07:00',
    })

    const allRequests = await listAdminLeaveRequests({
      actorRole: 'school_admin',
      actorId: 'admin-1',
      providers,
    })

    expect(allRequests).toHaveLength(2)
    expect(allRequests[0].student_name).toBeDefined()
    expect(allRequests[0].student_nis).toBeDefined()

    // Filter by student
    const student1Requests = await listAdminLeaveRequests({
      filter: { userId: 'student-1' },
      actorRole: 'teacher',
      actorId: 'teacher-1',
      providers,
    })
    expect(student1Requests).toHaveLength(1)
    expect(student1Requests[0].user_id).toBe('student-1')
    expect(student1Requests[0].student_name).toBe('Budi Santoso')
    expect(student1Requests[0].student_class).toBe('XII RPL 1')
    expect(student1Requests[0].attachment_url).toContain('student-1%2Fsurat_dokter.jpg')

    // Filter by category
    const pergiRequests = await listAdminLeaveRequests({
      filter: { category: 'pergi' },
      actorRole: 'staff',
      actorId: 'staff-1',
      providers,
    })
    expect(pergiRequests).toHaveLength(1)
    expect(pergiRequests[0].user_id).toBe('student-2')
  })

  it('rejects listing leave requests for unauthorized student role', async () => {
    const { providers } = setupTestEnvironment()

    await expect(
      listAdminLeaveRequests({
        actorRole: 'student',
        actorId: 'student-1',
        providers,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('gets a single leave request by id with attachment link and student metadata', async () => {
    const { domainStore, providers } = setupTestEnvironment()

    const permit = await domainStore.insertPermit({
      user_id: 'student-1',
      kategori_izin: 'dispensasi',
      deskripsi: 'Mengikuti lomba basket antar sekolah',
      status: false,
      link_foto: 'student-1/surat_dispensasi.pdf',
      tanggal: '2026-08-25T00:00:00+07:00',
    })

    const fetched = await getAdminLeaveRequest({
      id: permit.id,
      actorRole: 'school_admin',
      actorId: 'admin-1',
      providers,
    })

    expect(fetched.id).toBe(permit.id)
    expect(fetched.student_name).toBe('Budi Santoso')
    expect(fetched.student_nis).toBe('1001')
    expect(fetched.student_class).toBe('XII RPL 1')
    expect(fetched.category).toBe('dispensasi')
    expect(fetched.approval_status).toBe('pending')
    expect(fetched.attachment_url).toContain('student-1%2Fsurat_dispensasi.pdf')
  })

  it('approves a leave request and records an audit log', async () => {
    const { domainStore, providers } = setupTestEnvironment()

    const permit = await domainStore.insertPermit({
      user_id: 'student-1',
      kategori_izin: 'sakit',
      deskripsi: 'Sakit demam',
      status: false,
      link_foto: null,
      tanggal: '2026-08-21T00:00:00+07:00',
    })

    const approved = await approveLeaveRequest({
      id: permit.id,
      actorRole: 'school_admin',
      actorId: 'admin-1',
      durationDays: 3,
      providers,
    })

    expect(approved.id).toBe(permit.id)
    expect(approved.approval_status).toBe('approved')
    expect(approved.status).toBe(true)
    expect(approved.requested_start_date).toBe('2026-08-21')
    expect(approved.original_end_date).toBe('2026-08-23')
    expect(approved.effective_end_date).toBe('2026-08-23')
    expect(approved.duration_days).toBe(3)

    // Verify audit log created
    const logs = await domainStore.getAuditLogs('leave_request', permit.id)
    expect(logs).toHaveLength(1)
    expect(logs[0].action).toBe('approve_leave_request')
    expect(logs[0].actor_id).toBe('admin-1')
  })

  it('rejects approval when its duration intersects another approved Leave Period', async () => {
    const { domainStore, providers } = setupTestEnvironment()
    const existing = await domainStore.createLeaveRequest({
      user_id: 'student-1',
      category: 'sakit',
      description: 'Sakit pada tanggal yang sudah disetujui',
      date: '2026-08-23T00:00:00+07:00',
      approval_status: 'approved',
    })
    const candidate = await domainStore.createLeaveRequest({
      user_id: 'student-1',
      category: 'pergi',
      description: 'Pengajuan dimulai sebelum periode yang sudah disetujui',
      date: '2026-08-21T00:00:00+07:00',
      approval_status: 'pending',
    })

    await expect(
      approveLeaveRequest({
        id: candidate.id,
        actorRole: 'school_admin',
        actorId: 'admin-1',
        durationDays: 3,
        providers,
      }),
    ).rejects.toMatchObject({
      code: 'LEAVE_PERIOD_OVERLAP',
      details: {
        overlapping_request_id: existing.id,
        requested_start_date: '2026-08-21',
        requested_end_date: '2026-08-23',
      },
    })

    expect((await domainStore.getLeaveRequestById(candidate.id))?.approval_status).toBe('pending')
  })

  it('rejects teacher approval while preserving a one-day legacy period on read', async () => {
    const { domainStore, providers } = setupTestEnvironment()

    const permit = await domainStore.createLeaveRequest({
      user_id: 'student-1',
      category: 'sakit',
      description: 'Sakit demam',
      date: '2026-08-21T00:00:00+07:00',
      approval_status: 'approved',
    })

    await expect(
      approveLeaveRequest({
        id: permit.id,
        actorRole: 'teacher',
        actorId: 'teacher-1',
        durationDays: 2,
        providers,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const legacy = await getAdminLeaveRequest({
      id: permit.id,
      actorRole: 'school_admin',
      actorId: 'admin-1',
      providers,
    })
    expect(legacy.requested_start_date).toBe('2026-08-21')
    expect(legacy.original_end_date).toBe('2026-08-21')
    expect(legacy.effective_end_date).toBe('2026-08-21')
    expect(legacy.duration_days).toBe(1)
  })

  it.each([0, 31])(
    'rejects approval duration %s outside the inclusive boundary',
    async (durationDays) => {
      const { domainStore, providers } = setupTestEnvironment()
      const permit = await domainStore.insertPermit({
        user_id: 'student-1',
        kategori_izin: 'sakit',
        deskripsi: 'Sakit demam',
        status: false,
        link_foto: null,
        tanggal: '2026-08-21T00:00:00+07:00',
      })

      await expect(
        approveLeaveRequest({
          id: permit.id,
          actorRole: 'school_admin',
          actorId: 'admin-1',
          durationDays,
          providers,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    },
  )

  it('requires an explicit approval duration', async () => {
    const { domainStore, providers } = setupTestEnvironment()
    const permit = await domainStore.insertPermit({
      user_id: 'student-1',
      kategori_izin: 'sakit',
      deskripsi: 'Sakit demam',
      status: false,
      link_foto: null,
      tanggal: '2026-08-21T00:00:00+07:00',
    })

    await expect(
      approveLeaveRequest({
        id: permit.id,
        actorRole: 'school_admin',
        actorId: 'admin-1',
        providers,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect((await domainStore.getLeaveRequestById(permit.id))?.approval_status).toBe('pending')
  })

  it('does not reopen an approved Leave Period', async () => {
    const { domainStore, providers } = setupTestEnvironment()
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

  it('forbids platform administrators from approving, rejecting, or reopening Leave Requests', async () => {
    const { domainStore, providers } = setupTestEnvironment()
    const permit = await domainStore.insertPermit({
      user_id: 'student-1',
      kategori_izin: 'sakit',
      deskripsi: 'Sakit demam',
      status: false,
      link_foto: null,
      tanggal: '2026-08-21T00:00:00+07:00',
    })

    await expect(
      approveLeaveRequest({
        id: permit.id,
        actorRole: 'platform_admin',
        actorId: 'platform-admin-1',
        durationDays: 1,
        providers,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    await expect(
      rejectLeaveRequest({
        id: permit.id,
        actorRole: 'platform_admin',
        actorId: 'platform-admin-1',
        reason: 'Tidak disetujui',
        providers,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    await expect(
      reopenLeaveRequest({
        id: permit.id,
        actorRole: 'platform_admin',
        actorId: 'platform-admin-1',
        providers,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('rejects a leave request with reason and records an audit log', async () => {
    const { domainStore, providers } = setupTestEnvironment()

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
  })

  it('reopens a rejected leave request to pending, resets rejection fields, records audit log and enqueues notification', async () => {
    const { domainStore, providers } = setupTestEnvironment()

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
    })

    // Verify push notification enqueued
    const notifications = await domainStore.listNotifications({ userId: 'student-1' })
    const reopenNotification = notifications.find((n) => n.payload.type === 'leave_reopened')
    expect(reopenNotification).toBeDefined()
    expect(reopenNotification?.payload.title).toBe('Pengajuan Izin Dibuka Kembali')
    expect(reopenNotification?.payload.leave_request_id).toBe(permit.id)
  })

  it('forbids unauthorized student or staff role from reopening leave request', async () => {
    const { domainStore, providers } = setupTestEnvironment()

    const permit = await domainStore.insertPermit({
      user_id: 'student-1',
      kategori_izin: 'sakit',
      deskripsi: 'Sakit demam',
      status: false,
      link_foto: null,
      tanggal: '2026-08-21T00:00:00+07:00',
    })

    await expect(
      reopenLeaveRequest({
        id: permit.id,
        actorRole: 'student',
        actorId: 'student-1',
        providers,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    await expect(
      reopenLeaveRequest({
        id: permit.id,
        actorRole: 'staff',
        actorId: 'staff-1',
        providers,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('throws notFound when reopening non-existent leave request', async () => {
    const { providers } = setupTestEnvironment()

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
    const { domainStore, providers } = setupTestEnvironment()

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
    const { domainStore, providers } = setupTestEnvironment()

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

  describe('createAdminLeaveRequest', () => {
    it('rejects staff actors from submitting a request for another student', async () => {
      const { domainStore, providers } = setupTestEnvironment()

      await expect(
        createAdminLeaveRequest({
          userId: 'student-1',
          category: 'sakit',
          description: 'Pengajuan tidak boleh dibuat oleh guru',
          date: '2026-08-28',
          actorRole: 'teacher',
          actorId: 'teacher-1',
          providers,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
      expect(await domainStore.listLeaveRequests({ userId: 'student-1' })).toHaveLength(0)
    })

    it('creates leave request with default pending status and records audit log', async () => {
      const { domainStore, providers } = setupTestEnvironment()

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
        const { providers } = setupTestEnvironment()

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
      const { domainStore, providers } = setupTestEnvironment()

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
      const { domainStore, providers } = setupTestEnvironment()

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
      const { providers } = setupTestEnvironment()

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
      const { providers } = setupTestEnvironment()

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
      const { domainStore, providers } = setupTestEnvironment()

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
      const { providers } = setupTestEnvironment()

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

  it('allows only one concurrent approval and records one set of side effects', async () => {
    const { domainStore, providers } = setupTestEnvironment()
    const permit = await domainStore.insertPermit({
      user_id: 'student-1',
      kategori_izin: 'sakit',
      deskripsi: 'Sakit demam',
      status: false,
      link_foto: null,
      tanggal: '2026-08-21T00:00:00+07:00',
    })

    const originalGetLeaveRequestById = domainStore.getLeaveRequestById.bind(domainStore)
    let reads = 0
    let releaseReads!: () => void
    const bothReadsComplete = new Promise<void>((resolve) => {
      releaseReads = resolve
    })
    domainStore.getLeaveRequestById = async (id) => {
      const request = await originalGetLeaveRequestById(id)
      reads += 1
      if (reads === 2) releaseReads()
      await bothReadsComplete
      return request
    }

    const results = await Promise.allSettled([
      approveLeaveRequest({
        id: permit.id,
        actorRole: 'school_admin',
        actorId: 'admin-1',
        durationDays: 1,
        providers,
      }),
      approveLeaveRequest({
        id: permit.id,
        actorRole: 'school_admin',
        actorId: 'admin-1',
        durationDays: 1,
        providers,
      }),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    expect(rejected?.reason).toMatchObject({ code: 'CONFLICT' })
    expect((await domainStore.getLeaveRequestById(permit.id))?.approval_status).toBe('approved')
    expect(await domainStore.getAuditLogs('leave_request', permit.id)).toHaveLength(1)
    expect(await domainStore.listNotifications({ userId: 'student-1' })).toHaveLength(1)
  })
})
