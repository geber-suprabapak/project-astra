import { describe, expect, it, vi } from 'vitest'
import { SignJWT, type JWTPayload } from 'jose'
import { createApp } from '../../src/app.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../src/providers/memory/index.js'
import type { RobinClient } from '../../src/clients/robin/client.js'

const OIDC_SECRET = 'test-secret-at-least-32-chars-long-12345'

async function signedOidcToken(
  claims: JWTPayload,
  audience = 'astra-api',
  expirationTime: string | number = '5m',
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('http://logto.test/oidc')
    .setAudience(audience)
    .setSubject(claims.sub ?? 'student-1')
    .setIssuedAt()
    .setExpirationTime(expirationTime)
    .sign(new TextEncoder().encode(OIDC_SECRET))
}

function createTestEnvironment() {
  const domainStore = new MemoryDomainStore()
  const objectStorage = new MemoryObjectStorage()
  const identityProvider = new MemoryIdentityProvider()

  let enrollmentStatus: 'enrolled' | 'not_enrolled' = 'not_enrolled'
  const mockRobinEnroll = vi.fn().mockImplementation(async () => {
    enrollmentStatus = 'enrolled'
    return {
      status: 'ok',
      userId: 'student-1',
      samplesReceived: 10,
      embeddingsCreated: 10,
      totalEmbeddings: 10,
      message: 'Face enrolled successfully.',
    }
  })

  const mockRobinDelete = vi.fn().mockImplementation(async () => {
    enrollmentStatus = 'not_enrolled'
  })

  const mockRobinClient: RobinClient = {
    checkReadiness: async () => ({ healthy: true }),
    getEnrollmentStatus: async () => ({
      status: enrollmentStatus,
      embeddingCount: enrollmentStatus === 'enrolled' ? 10 : 0,
      message: enrollmentStatus === 'enrolled' ? 'Enrolled.' : 'Not enrolled.',
    }),
    enroll: mockRobinEnroll,
    identify: async () => ({ processTimeMs: 12 }),
    deleteEnrollment: mockRobinDelete,
  }

  // Pre-seed helper
  const seedStudent = (id: string, lifecycleStatus: 'approved' | 'pending' | 'rejected' | 'disabled') => {
    domainStore.profiles.set(id, {
      user_id: id,
      full_name: `Student ${id}`,
      email: `${id}@school.sch.id`,
      nis: `NIS-${id}`,
      class_name: 'XII RPL 1',
      role: 'student',
      lifecycle_status: lifecycleStatus,
      gender: 'L',
    })
    identityProvider.users.set(id, {
      userId: id,
      email: `${id}@school.sch.id`,
      roles: ['student'],
      scopes: ['openid', 'profile'],
    })
  }

  seedStudent('student-approved', 'approved')
  seedStudent('student-pending', 'pending')
  seedStudent('student-rejected', 'rejected')
  seedStudent('student-disabled', 'disabled')
  seedStudent('student-reenroll', 'approved')
  seedStudent('student-del', 'approved')
  seedStudent('student-target', 'approved')
  seedStudent('student-files', 'approved')

  // Pre-seed school admin
  domainStore.profiles.set('school-admin-1', {
    user_id: 'school-admin-1',
    full_name: 'School Admin',
    email: 'admin@school.sch.id',
    role: 'school_admin',
    lifecycle_status: 'approved',
    gender: null,
  })
  identityProvider.users.set('school-admin-1', {
    userId: 'school-admin-1',
    email: 'admin@school.sch.id',
    roles: ['school_admin'],
    scopes: ['openid', 'profile', 'admin:read', 'student:manage'],
    mfaVerified: true,
    mustChangePassword: false,
  })

  const app = createApp({
    providers: {
      domainStore,
      objectStorage,
      identityProvider,
      robinClient: mockRobinClient,
    },
  })

  return { app, domainStore, objectStorage, mockRobinEnroll, mockRobinDelete }
}

function createTenJpegFormData(): FormData {
  const formData = new FormData()
  for (let i = 0; i < 10; i++) {
    const file = new File([Buffer.from(`test-jpeg-sample-${i}`)], `image_${i + 1}.jpg`, {
      type: 'image/jpeg',
    })
    formData.append('files', file)
  }
  return formData
}

describe('Face Enrollment & Authorized Files Integration (Ticket 08)', () => {
  it('rejects pending, rejected, or disabled students from face enrollment with 403', async () => {
    const { app } = createTestEnvironment()

    for (const sub of ['student-pending', 'student-rejected', 'student-disabled']) {
      const token = await signedOidcToken({
        sub,
        roles: ['student'],
        scope: 'openid profile',
      })

      const statusRes = await app.request('/v1/mobile/face/enrollment/status', {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(statusRes.status).toBe(403)

      const enrollRes = await app.request('/v1/mobile/face/enrollment', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: createTenJpegFormData(),
      })
      expect(enrollRes.status).toBe(403)
    }
  })

  it('allows approved student to enroll face with 10 JPEG images, persisting files and domain state', async () => {
    const { app, domainStore, mockRobinEnroll } = createTestEnvironment()
    const token = await signedOidcToken({
      sub: 'student-approved',
      roles: ['student'],
      scope: 'openid profile',
    })

    // 1. Initial status is not_enrolled
    const initialStatusRes = await app.request('/v1/mobile/face/enrollment/status', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(initialStatusRes.status).toBe(200)
    const initialBody = await initialStatusRes.json()
    expect(initialBody.data.status).toBe('not_enrolled')

    // 2. Submit 10 JPEG images
    const formData = createTenJpegFormData()
    const enrollRes = await app.request('/v1/mobile/face/enrollment', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })

    expect(enrollRes.status).toBe(201)
    const enrollBody = await enrollRes.json()
    expect(enrollBody.success).toBe(true)
    expect(mockRobinEnroll).toHaveBeenCalled()

    // 3. Astra domain store owns 10 files with lifecycle: 'available'
    const storedFiles = await domainStore.listFiles({
      userId: 'student-approved',
      purpose: 'face_enrollment',
      lifecycle: 'available',
    })
    expect(storedFiles).toHaveLength(10)

    // 4. Astra owns face_enrollments record
    const faceEnrollment = await domainStore.getFaceEnrollment('student-approved')
    expect(faceEnrollment?.status).toBe('enrolled')
    expect(faceEnrollment?.sample_count).toBe(10)

    // 5. Audit log is created
    const auditLogs = await domainStore.getAuditLogs('face_enrollment', 'student-approved')
    expect(auditLogs.some((l) => l.action === 'face_enrollment:enrolled')).toBe(true)

    // 6. Status is now enrolled
    const updatedStatusRes = await app.request('/v1/mobile/face/enrollment/status', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(updatedStatusRes.status).toBe(200)
    const updatedBody = await updatedStatusRes.json()
    expect(updatedBody.data.status).toBe('enrolled')
  })

  it('re-enrollment replaces previous face enrollment files idempotently', async () => {
    const { app, domainStore } = createTestEnvironment()
    const token = await signedOidcToken({
      sub: 'student-reenroll',
      roles: ['student'],
      scope: 'openid profile',
    })

    // First enrollment
    const firstRes = await app.request('/v1/mobile/face/enrollment', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: createTenJpegFormData(),
    })
    expect(firstRes.status).toBe(201)

    // Second enrollment (re-enrollment / replacement)
    const reEnrollRes = await app.request('/v1/mobile/face/enrollment', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: createTenJpegFormData(),
    })
    expect(reEnrollRes.status).toBe(201)

    // Active files in domain store must be exactly 10
    const activeFiles = await domainStore.listFiles({
      userId: 'student-reenroll',
      purpose: 'face_enrollment',
      lifecycle: 'available',
    })
    expect(activeFiles).toHaveLength(10)
  })

  it('student can delete face enrollment, clearing Robin/Qdrant and Astra file records', async () => {
    const { app, domainStore, mockRobinDelete } = createTestEnvironment()
    const token = await signedOidcToken({
      sub: 'student-del',
      roles: ['student'],
      scope: 'openid profile',
    })

    // Enroll first
    const enrollRes = await app.request('/v1/mobile/face/enrollment', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: createTenJpegFormData(),
    })
    expect(enrollRes.status).toBe(201)

    // Delete enrollment
    const deleteRes = await app.request('/v1/mobile/face/enrollment', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(deleteRes.status).toBe(200)
    expect(mockRobinDelete).toHaveBeenCalled()

    // Active files are cleared
    const activeFiles = await domainStore.listFiles({
      userId: 'student-del',
      purpose: 'face_enrollment',
      lifecycle: 'available',
    })
    expect(activeFiles).toHaveLength(0)

    // Status returns not_enrolled
    const faceEnrollment = await domainStore.getFaceEnrollment('student-del')
    expect(faceEnrollment?.status).toBe('not_enrolled')

    // Audit log records deletion
    const auditLogs = await domainStore.getAuditLogs('face_enrollment', 'student-del')
    expect(auditLogs.some((l) => l.action === 'face_enrollment:deleted')).toBe(true)
  })

  it('school administrator can reset a student face enrollment', async () => {
    const { app, domainStore, mockRobinDelete } = createTestEnvironment()
    const studentToken = await signedOidcToken({
      sub: 'student-target',
      roles: ['student'],
      scope: 'openid profile',
    })
    const adminToken = await signedOidcToken({
      sub: 'school-admin-1',
      roles: ['school_admin'],
      scope: 'openid profile admin:read student:manage',
      mfa_verified: true,
      must_change_password: false,
    })

    // Student enrolls
    const enrollRes = await app.request('/v1/mobile/face/enrollment', {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: createTenJpegFormData(),
    })
    expect(enrollRes.status).toBe(201)

    // Admin resets student face enrollment
    const resetRes = await app.request('/v1/admin/students/student-target/face-enrollment', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    })

    expect(resetRes.status).toBe(200)
    expect(mockRobinDelete).toHaveBeenCalled()

    const activeFiles = await domainStore.listFiles({
      userId: 'student-target',
      purpose: 'face_enrollment',
      lifecycle: 'available',
    })
    expect(activeFiles).toHaveLength(0)

    const auditLogs = await domainStore.getAuditLogs('face_enrollment', 'student-target')
    expect(auditLogs.some((l) => l.action === 'reset_student_face_enrollment')).toBe(true)
  })

  it('authorized file upload intent and confirmation lifecycle workflow', async () => {
    const { app, domainStore } = createTestEnvironment()
    const token = await signedOidcToken({
      sub: 'student-files',
      roles: ['student'],
      scope: 'openid profile',
    })

    // 1. Create upload intent
    const intentRes = await app.request('/v1/mobile/files/upload-intent', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        purpose: 'avatar',
        content_type: 'image/jpeg',
        size_bytes: 500000,
      }),
    })

    expect(intentRes.status).toBe(201)
    const intentBody = await intentRes.json()
    expect(intentBody.data.file_id).toBeDefined()
    expect(intentBody.data.upload_url).toBeDefined()

    const fileId = intentBody.data.file_id
    const fileRecord = await domainStore.getFileRecord(fileId)
    expect(fileRecord?.lifecycle).toBe('pending_upload')

    // 2. Confirm upload
    const confirmRes = await app.request(`/v1/mobile/files/${fileId}/confirm`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(confirmRes.status).toBe(200)
    const confirmBody = await confirmRes.json()
    expect(confirmBody.data.lifecycle).toBe('available')

    // 3. Get file with signed download URL
    const getRes = await app.request(`/v1/mobile/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(getRes.status).toBe(200)
    const getBody = await getRes.json()
    expect(getBody.data.file.id).toBe(fileId)
    expect(getBody.data.download_url).toBeDefined()

    // 4. Delete file
    const delRes = await app.request(`/v1/mobile/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(delRes.status).toBe(200)

    const deletedRecord = await domainStore.getFileRecord(fileId)
    expect(deletedRecord?.lifecycle).toBe('deleted')
  })
})
