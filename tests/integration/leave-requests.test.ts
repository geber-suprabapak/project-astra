import { describe, expect, it } from 'vitest'
import type { JWTPayload } from 'jose'
import { createApp } from '../../src/app.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../src/providers/memory/index.js'
import type { RobinClient } from '../../src/clients/robin/client.js'

function tokenFor(payload: JWTPayload): string {
  const fullPayload = {
    scope: 'openid profile',
    ...payload,
  }
  const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url')
  return `header.${encodedPayload}.signature`
}

function createIntegrationEnvironment() {
  const domainStore = new MemoryDomainStore()
  const objectStorage = new MemoryObjectStorage()
  const identityProvider = new MemoryIdentityProvider()

  const robinClient: RobinClient = {
    checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
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
    robinClient,
  }

  const app = createApp({ providers })

  return { domainStore, identityProvider, objectStorage, robinClient, providers, app }
}

async function setupTestUsers(domainStore: MemoryDomainStore, identityProvider: MemoryIdentityProvider) {
  // 1. School
  await domainStore.createSchool({
    name: 'SMK Negeri 2 Banjarmasin',
    slug: 'smkn2-bjm',
  })

  // 2. Student 1 (Approved)
  domainStore.profiles.set('student-1', {
    user_id: 'student-1',
    full_name: 'Budi Santoso',
    email: 'student1@school.sch.id',
    nis: '1001',
    class_name: 'XII RPL 1',
    absence_number: '05',
    role: 'student',
    lifecycle_status: 'approved',
    gender: 'L',
  })
  identityProvider.users.set('student-1', {
    userId: 'student-1',
    email: 'student1@school.sch.id',
    roles: ['student'],
    scopes: ['openid', 'profile', 'leave:submit', 'leave:read'],
  })

  // 3. Student 2 (Approved)
  domainStore.profiles.set('student-2', {
    user_id: 'student-2',
    full_name: 'Siti Aminah',
    email: 'student2@school.sch.id',
    nis: '1002',
    class_name: 'XII RPL 1',
    absence_number: '12',
    role: 'student',
    lifecycle_status: 'approved',
    gender: 'P',
  })
  identityProvider.users.set('student-2', {
    userId: 'student-2',
    email: 'student2@school.sch.id',
    roles: ['student'],
    scopes: ['openid', 'profile', 'leave:submit', 'leave:read'],
  })

  // 4. Student Pending
  domainStore.profiles.set('student-pending', {
    user_id: 'student-pending',
    full_name: 'Pending Student',
    email: 'pending@school.sch.id',
    nis: '1003',
    class_name: 'XII RPL 1',
    role: 'student',
    lifecycle_status: 'pending',
    gender: 'L',
  })
  identityProvider.users.set('student-pending', {
    userId: 'student-pending',
    email: 'pending@school.sch.id',
    roles: ['student'],
    scopes: ['openid', 'profile'],
  })

  // 5. School Admin
  domainStore.profiles.set('admin-1', {
    user_id: 'admin-1',
    full_name: 'Kepala Sekolah',
    email: 'admin@school.sch.id',
    role: 'school_admin',
    lifecycle_status: 'approved',
  })
  identityProvider.users.set('admin-1', {
    userId: 'admin-1',
    email: 'admin@school.sch.id',
    roles: ['school_admin'],
    scopes: ['openid', 'profile', 'admin:read', 'admin:write', 'leave:read', 'leave:approve'],
    mfaVerified: true,
    mustChangePassword: false,
  })

  // 6. Teacher
  domainStore.profiles.set('teacher-1', {
    user_id: 'teacher-1',
    full_name: 'Wali Kelas XII RPL 1',
    email: 'teacher@school.sch.id',
    role: 'school_admin',
    lifecycle_status: 'approved',
  })
  identityProvider.users.set('teacher-1', {
    userId: 'teacher-1',
    email: 'teacher@school.sch.id',
    roles: ['school_admin'],
    scopes: ['openid', 'profile', 'admin:read', 'leave:read', 'leave:approve'],
    mfaVerified: true,
    mustChangePassword: false,
  })
}

describe('Ticket 10 Integration: Submit and Review Leave Requests', () => {
  it('Student creates upload intent, uploads attachment, and submits leave request referencing file_id', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupTestUsers(domainStore, identityProvider)

    const studentToken = tokenFor({
      sub: 'student-1',
      roles: ['student'],
      scope: 'openid profile',
    })

    // 1. Create file upload intent
    const intentRes = await app.request('/v1/mobile/files/upload-intent', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        purpose: 'permit_attachment',
        content_type: 'application/pdf',
        size_bytes: 10240,
      }),
    })

    expect(intentRes.status).toBe(201)
    const intentBody = await intentRes.json()
    expect(intentBody.data.file_id).toBeDefined()
    expect(intentBody.data.upload_url).toBeDefined()
    const fileId = intentBody.data.file_id

    // 2. Submit leave request referencing file_id via JSON
    const leaveRes = await app.request('/v1/mobile/leave-requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        category: 'dispensasi',
        description: 'Mengikuti lomba debat bahasa inggris tingkat provinsi',
        date: '2026-08-25',
        file_id: fileId,
      }),
    })

    expect(leaveRes.status).toBe(201)
    const leaveBody = await leaveRes.json()
    expect(leaveBody.data.id).toBeDefined()
    expect(leaveBody.data.category).toBe('dispensasi')
    expect(leaveBody.data.approval_status).toBe('pending')
    expect(leaveBody.data.attachment_url).toContain('https://storage.local/signed/')

    // Verify Astra file lifecycle is available
    const fileRecord = await domainStore.getFileRecord(fileId)
    expect(fileRecord?.lifecycle).toBe('available')
  })

  it('Student submits leave request with multipart form data and file attachment', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupTestUsers(domainStore, identityProvider)

    const studentToken = tokenFor({
      sub: 'student-1',
      roles: ['student'],
      scope: 'openid profile',
    })

    const formData = new FormData()
    formData.append('category', 'sakit')
    formData.append('description', 'Demam tinggi dan batuk berdahak')
    formData.append('date', '2026-08-22')
    formData.append('attachment', new Blob(['fake-image-bytes'], { type: 'image/jpeg' }), 'doctor_note.jpg')

    const res = await app.request('/v1/mobile/permits', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
      },
      body: formData,
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.id).toBeDefined()
    expect(body.data.category).toBe('sakit')
    expect(body.data.approval_status).toBe('pending')
    expect(body.data.attachment_url).toContain('https://storage.local/signed/')

    // Verify file record was recorded in Astra files table
    const files = await domainStore.listFiles({ userId: 'student-1', purpose: 'permit_attachment' })
    expect(files.length).toBeGreaterThan(0)
  })

  it('Pending or unapproved student is forbidden from submitting or viewing leave requests', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupTestUsers(domainStore, identityProvider)

    const pendingToken = tokenFor({
      sub: 'student-pending',
      roles: ['student'],
      scope: 'openid profile',
    })

    // 1. Submit attempt
    const postRes = await app.request('/v1/mobile/leave-requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pendingToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        category: 'sakit',
        description: 'Sakit gigi tidak bisa masuk',
        date: '2026-08-22',
      }),
    })
    expect(postRes.status).toBe(403)
    const postBody = await postRes.json()
    expect(postBody.error.code).toBe('FORBIDDEN')

    // 2. List attempt
    const getRes = await app.request('/v1/mobile/leave-requests', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${pendingToken}`,
      },
    })
    expect(getRes.status).toBe(403)
  })

  it('Student can list only their own leave requests and cannot view another student leave request', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupTestUsers(domainStore, identityProvider)

    const student1Token = tokenFor({ sub: 'student-1', roles: ['student'], scope: 'openid profile' })
    const student2Token = tokenFor({ sub: 'student-2', roles: ['student'], scope: 'openid profile' })

    // Create leave request for student 1
    const s1Res = await app.request('/v1/mobile/permits', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${student1Token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        category: 'sakit',
        description: 'Sakit flu berat hari pertama',
        date: '2026-08-21',
      }),
    })
    const s1Body = await s1Res.json()
    const s1PermitId = s1Body.data.id

    // Create leave request for student 2
    await app.request('/v1/mobile/permits', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${student2Token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        category: 'pergi',
        description: 'Acara pernikahan kakak kandung',
        date: '2026-08-21',
      }),
    })

    // Student 1 lists permits -> receives only 1
    const listRes = await app.request('/v1/mobile/permits', {
      method: 'GET',
      headers: { Authorization: `Bearer ${student1Token}` },
    })
    expect(listRes.status).toBe(200)
    const listBody = await listRes.json()
    expect(listBody.data.items).toHaveLength(1)
    expect(listBody.data.items[0].id).toBe(s1PermitId)

    // Student 1 views their own permit -> 200
    const singleRes = await app.request(`/v1/mobile/permits/${s1PermitId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${student1Token}` },
    })
    expect(singleRes.status).toBe(200)

    // Student 2 tries to view student 1 permit -> 403 FORBIDDEN
    const forbiddenRes = await app.request(`/v1/mobile/permits/${s1PermitId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${student2Token}` },
    })
    expect(forbiddenRes.status).toBe(403)
  })

  it('School administrator reviews, approves, rejects, and manages leave request lifecycle', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupTestUsers(domainStore, identityProvider)

    const studentToken = tokenFor({ sub: 'student-1', roles: ['student'], scope: 'openid profile' })
    const adminToken = tokenFor({
      sub: 'admin-1',
      roles: ['school_admin'],
      scope: 'openid profile admin:read leave:read leave:approve',
      mfa_verified: true,
      must_change_password: false,
    })

    // Student creates leave request 1
    const create1Res = await app.request('/v1/mobile/leave-requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        category: 'sakit',
        description: 'Sakit tipes rawat jalan dokter',
        date: '2026-08-23',
      }),
    })
    const leave1 = (await create1Res.json()).data

    // Student creates leave request 2
    const create2Res = await app.request('/v1/mobile/leave-requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        category: 'pergi',
        description: 'Liburan ke pantai bersama teman',
        date: '2026-08-24',
      }),
    })
    const leave2 = (await create2Res.json()).data

    // Admin lists all leave requests
    const adminListRes = await app.request('/v1/admin/leave-requests', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(adminListRes.status).toBe(200)
    const adminListBody = await adminListRes.json()
    expect(adminListBody.data).toHaveLength(2)
    expect(adminListBody.data[0].student_name).toBe('Budi Santoso')
    expect(adminListBody.data[0].student_nis).toBe('1001')
    expect(adminListBody.data[0].student_class).toBe('XII RPL 1')

    // Admin approves leave request 1
    const approveRes = await app.request(`/v1/admin/leave-requests/${leave1.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(approveRes.status).toBe(200)
    const approveBody = await approveRes.json()
    expect(approveBody.data.approval_status).toBe('approved')
    expect(approveBody.data.status).toBe(true)

    // Student cannot delete approved leave request
    const studentDeleteRes = await app.request(`/v1/mobile/leave-requests/${leave1.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${studentToken}` },
    })
    expect(studentDeleteRes.status).toBe(409)

    // Admin rejects leave request 2 with reason
    const rejectRes = await app.request(`/v1/admin/leave-requests/${leave2.id}/reject`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reason: 'Liburan pribadi tidak diizinkan pada hari efektif sekolah.',
      }),
    })
    expect(rejectRes.status).toBe(200)
    const rejectBody = await rejectRes.json()
    expect(rejectBody.data.approval_status).toBe('rejected')
    expect(rejectBody.data.rejection_reason).toBe('Liburan pribadi tidak diizinkan pada hari efektif sekolah.')
    expect(rejectBody.data.rejected_at).toBeDefined()

    // Student cancels pending or admin deletes leave request
    const adminDeleteRes = await app.request(`/v1/admin/leave-requests/${leave2.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(adminDeleteRes.status).toBe(200)
  })
})
