import { describe, expect, it } from 'vitest'
import {
  createPermit,
  deletePermit,
  getPermit,
  listPermits,
} from '../../../src/modules/permits/service.js'
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

  // Setup approved student profile
  domainStore.profiles.set('student-1', {
    user_id: 'student-1',
    full_name: 'Budi Santoso',
    nis: '1001',
    class_name: 'XII RPL 1',
    role: 'student',
    lifecycle_status: 'approved',
  })

  // Setup unapproved student profile
  domainStore.profiles.set('student-pending', {
    user_id: 'student-pending',
    full_name: 'Pending Student',
    nis: '1002',
    class_name: 'XII RPL 1',
    role: 'student',
    lifecycle_status: 'pending',
  })

  // Setup other student
  domainStore.profiles.set('student-2', {
    user_id: 'student-2',
    full_name: 'Siti Aminah',
    nis: '1003',
    class_name: 'XII RPL 1',
    role: 'student',
    lifecycle_status: 'approved',
  })

  // Setup teacher profile
  domainStore.profiles.set('teacher-1', {
    user_id: 'teacher-1',
    full_name: 'Pak Guru',
    role: 'teacher',
    lifecycle_status: 'approved',
  })

  return { domainStore, objectStorage, identityProvider, providers }
}

describe('Permits / Leave Requests Service - Student Flows', () => {
  it('creates a leave request with multipart attachment and creates Astra FileRecord', async () => {
    const { domainStore, providers } = setupTestEnvironment()

    const result = await createPermit({
      userId: 'student-1',
      category: 'sakit',
      description: 'Sakit flu berat butuh istirahat di rumah',
      date: '2026-08-22',
      attachment: {
        buffer: Buffer.from('fake-image-data'),
        contentType: 'image/jpeg',
      },
      providers,
    })

    expect(result.id).toBeDefined()
    expect(result.category).toBe('sakit')
    expect(result.description).toBe('Sakit flu berat butuh istirahat di rumah')
    expect(result.approval_status).toBe('pending')
    expect(result.attachment_url).toContain('https://storage.local/signed/')

    // Verify Astra file record was created
    const files = await domainStore.listFiles({ userId: 'student-1', purpose: 'permit_attachment' })
    expect(files).toHaveLength(1)
    expect(files[0].lifecycle).toBe('available')
    expect(files[0].content_type).toBe('image/jpeg')
  })

  it('creates a leave request referencing an existing Astra file_id', async () => {
    const { domainStore, providers } = setupTestEnvironment()

    // Create a pending Astra file
    const fileRecord = await domainStore.createFileRecord({
      userId: 'student-1',
      purpose: 'permit_attachment',
      objectPath: 'student-1/permit_attachment_doc.pdf',
      contentType: 'application/pdf',
      lifecycle: 'pending_upload',
    })

    const result = await createPermit({
      userId: 'student-1',
      category: 'dispensasi',
      description: 'Mengikuti lomba olimpiade sains tingkat kota',
      date: '2026-08-25',
      fileId: fileRecord.id,
      providers,
    })

    expect(result.category).toBe('dispensasi')
    expect(result.approval_status).toBe('pending')
    expect(result.attachment_url).toContain('student-1%2Fpermit_attachment_doc.pdf')

    // File lifecycle transitioned to available
    const updatedFile = await domainStore.getFileRecord(fileRecord.id)
    expect(updatedFile?.lifecycle).toBe('available')
  })

  it('rejects leave request creation for pending or unapproved students', async () => {
    const { providers } = setupTestEnvironment()

    await expect(
      createPermit({
        userId: 'student-pending',
        category: 'sakit',
        description: 'Sakit demam tinggi tidak bisa masuk',
        date: '2026-08-22',
        providers,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('rejects leave request creation for non-student profiles', async () => {
    const { providers } = setupTestEnvironment()

    await expect(
      createPermit({
        userId: 'teacher-1',
        category: 'sakit',
        description: 'Guru izin sakit hari ini',
        date: '2026-08-22',
        providers,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('rejects attaching a file owned by another user', async () => {
    const { domainStore, providers } = setupTestEnvironment()

    const otherUserFile = await domainStore.createFileRecord({
      userId: 'student-2',
      purpose: 'permit_attachment',
      objectPath: 'student-2/permit_doc.jpg',
      contentType: 'image/jpeg',
      lifecycle: 'available',
    })

    await expect(
      createPermit({
        userId: 'student-1',
        category: 'sakit',
        description: 'Sakit demam tinggi butuh istirahat',
        date: '2026-08-22',
        fileId: otherUserFile.id,
        providers,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('lists only the student own leave requests', async () => {
    const { providers } = setupTestEnvironment()

    await createPermit({
      userId: 'student-1',
      category: 'sakit',
      description: 'Sakit flu batuk pilek',
      date: '2026-08-21',
      providers,
    })

    await createPermit({
      userId: 'student-2',
      category: 'pergi',
      description: 'Acara keluarga mendadak di luar kota',
      date: '2026-08-21',
      providers,
    })

    const student1Permits = await listPermits('student-1', providers)
    expect(student1Permits).toHaveLength(1)
    expect(student1Permits[0].category).toBe('sakit')

    const student2Permits = await listPermits('student-2', providers)
    expect(student2Permits).toHaveLength(1)
    expect(student2Permits[0].category).toBe('pergi')
  })

  it('allows student to view single permit by id and forbids viewing other student permit', async () => {
    const { providers } = setupTestEnvironment()

    const permit = await createPermit({
      userId: 'student-1',
      category: 'sakit',
      description: 'Sakit flu batuk pilek',
      date: '2026-08-21',
      providers,
    })

    const fetched = await getPermit('student-1', permit.id, providers)
    expect(fetched.id).toBe(permit.id)

    await expect(getPermit('student-2', permit.id, providers)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    await expect(getPermit('student-1', 'non-existent-id', providers)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    })
  })

  it('allows student to delete pending leave request and cleans up file/attachment', async () => {
    const { domainStore, providers } = setupTestEnvironment()

    const permit = await createPermit({
      userId: 'student-1',
      category: 'lainnya',
      description: 'Ada keperluan penting di dinas pendidikan',
      date: '2026-08-23',
      attachment: {
        buffer: Buffer.from('attachment-content'),
        contentType: 'image/jpeg',
      },
      providers,
    })

    const filesBefore = await domainStore.listFiles({ userId: 'student-1', purpose: 'permit_attachment' })
    expect(filesBefore).toHaveLength(1)
    expect(filesBefore[0].lifecycle).toBe('available')

    await deletePermit('student-1', permit.id, providers)

    // Verify permit deleted
    const history = await listPermits('student-1', providers)
    expect(history).toHaveLength(0)

    // Verify file lifecycle updated to deleted
    const filesAfter = await domainStore.listFiles({ userId: 'student-1', purpose: 'permit_attachment' })
    expect(filesAfter[0].lifecycle).toBe('deleted')
  })

  it('forbids deleting another student permit or an already processed permit', async () => {
    const { domainStore, providers } = setupTestEnvironment()

    const permit = await createPermit({
      userId: 'student-1',
      category: 'sakit',
      description: 'Sakit batuk parah butuh istirahat',
      date: '2026-08-22',
      providers,
    })

    // Another student cannot delete it
    await expect(deletePermit('student-2', permit.id, providers)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    // Process the permit (approve it)
    await domainStore.updateLeaveRequestStatus({
      id: permit.id,
      approvalStatus: 'approved',
    })

    // Now deleting should fail with 409 CONFLICT
    await expect(deletePermit('student-1', permit.id, providers)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
  })
})
