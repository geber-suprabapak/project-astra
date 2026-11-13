import { describe, expect, it } from 'vitest'
import {
  approveLeaveRequest,
  getAdminLeaveRequest,
  listAdminLeaveRequests,
  rejectLeaveRequest,
  reopenLeaveRequest,
} from '../../../src/modules/admin/service.js'
import { setupAdminLeaveTestEnvironment } from './admin-leave-service-harness.js'

describe('Admin Leave Requests Service', () => {
  it('lists leave requests with student profile enrichment and filters', async () => {
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()

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
    const { providers } = setupAdminLeaveTestEnvironment()

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
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()

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
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()

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
    expect(logs[0].details).toMatchObject({
      previous_status: 'pending',
      student_user_id: 'student-1',
      category: 'sakit',
      date: '2026-08-21',
      actor_name: 'Kepala Sekolah',
      actor_role: 'school_admin',
      duration_days: 3,
      requested_start_date: '2026-08-21',
      original_end_date: '2026-08-23',
      effective_end_date: '2026-08-23',
    })
  })

  it('rejects approval when its duration intersects another approved Leave Period', async () => {
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()
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

  it('prevents a teacher from extending an approved legacy period while preserving it on read', async () => {
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()

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
    ).rejects.toMatchObject({ code: 'CONFLICT' })

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
      const { domainStore, providers } = setupAdminLeaveTestEnvironment()
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
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()
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

  it('allows platform administrators to approve, reject, and reopen Leave Requests', async () => {
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()
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
      actorRole: 'platform_admin',
      actorId: 'platform-admin-1',
      durationDays: 1,
      providers,
    })
    expect(approved.approval_status).toBe('approved')

    const secondPermit = await domainStore.insertPermit({
      user_id: 'student-1',
      kategori_izin: 'sakit',
      deskripsi: 'Kontrol lanjutan',
      status: false,
      link_foto: null,
      tanggal: '2026-08-22T00:00:00+07:00',
    })

    const rejected = await rejectLeaveRequest({
      id: secondPermit.id,
      actorRole: 'platform_admin',
      actorId: 'platform-admin-1',
      reason: 'Tidak disetujui',
      providers,
    })
    expect(rejected.approval_status).toBe('rejected')

    const reopened = await reopenLeaveRequest({
      id: secondPermit.id,
      actorRole: 'platform_admin',
      actorId: 'platform-admin-1',
      providers,
    })
    expect(reopened.approval_status).toBe('pending')
  })

  it('allows only one concurrent approval and records one set of side effects', async () => {
    const { domainStore, providers } = setupAdminLeaveTestEnvironment()
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
