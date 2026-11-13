import { describe, expect, it } from 'vitest'
import {
  createTenJpegFormData,
  createTestEnvironment,
  signedOidcToken,
} from './helpers/face-enrollment-fixture.js'

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
})
