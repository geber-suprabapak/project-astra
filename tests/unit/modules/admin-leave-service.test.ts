import { describe, expect, it } from 'vitest'
import {
  approveLeaveRequest,
  deleteAdminLeaveRequest,
  getAdminLeaveRequest,
  listAdminLeaveRequests,
  rejectLeaveRequest,
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
    getEnrollmentStatus: async () => ({ status: 'enrolled', embeddingCount: 10, message: 'Ready.' }),
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
      actorRole: 'teacher',
      actorId: 'teacher-1',
      providers,
    })

    expect(approved.id).toBe(permit.id)
    expect(approved.approval_status).toBe('approved')
    expect(approved.status).toBe(true)

    // Verify audit log created
    const logs = await domainStore.getAuditLogs('leave_request', permit.id)
    expect(logs).toHaveLength(1)
    expect(logs[0].action).toBe('approve_leave_request')
    expect(logs[0].actor_id).toBe('teacher-1')
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
    expect(rejected.rejection_reason).toBe('Izin liburan pribadi tidak dapat disetujui saat hari efektif KBM')
    expect(rejected.rejected_at).toBeDefined()

    // Verify audit log created
    const logs = await domainStore.getAuditLogs('leave_request', permit.id)
    expect(logs).toHaveLength(1)
    expect(logs[0].action).toBe('reject_leave_request')
    expect(logs[0].actor_id).toBe('admin-1')
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
})
