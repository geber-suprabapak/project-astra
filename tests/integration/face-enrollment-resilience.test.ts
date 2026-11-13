import { describe, expect, it } from 'vitest'
import { AppError } from '../../src/lib/errors/app-error.js'
import {
  createTenJpegFormData,
  createTestEnvironment,
  signedOidcToken,
} from './helpers/face-enrollment-fixture.js'

describe('Face Enrollment Resilience & Authorized Files Integration (Ticket 08)', () => {
  it('admin reset fails closed when Robin delete fails and a retry completes', async () => {
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

    const enrollRes = await app.request('/v1/mobile/face/enrollment', {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: createTenJpegFormData(),
    })
    expect(enrollRes.status).toBe(201)

    // A07: a Robin delete failure must surface as 503 and must not clear the
    // Astra-side enrollment (previously the error was swallowed and Astra
    // continued cleanup while reporting success).
    mockRobinDelete.mockRejectedValueOnce(AppError.dependencyUnavailable('Robin'))
    const failedReset = await app.request('/v1/admin/students/student-target/face-enrollment', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(failedReset.status).toBe(503)

    const filesAfterFailure = await domainStore.listFiles({
      userId: 'student-target',
      purpose: 'face_enrollment',
      lifecycle: 'available',
    })
    expect(filesAfterFailure).toHaveLength(10)

    const retryRes = await app.request('/v1/admin/students/student-target/face-enrollment', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(retryRes.status).toBe(200)

    const activeFiles = await domainStore.listFiles({
      userId: 'student-target',
      purpose: 'face_enrollment',
      lifecycle: 'available',
    })
    expect(activeFiles).toHaveLength(0)

    const auditLogs = await domainStore.getAuditLogs('face_enrollment', 'student-target')
    expect(auditLogs.some((l) => l.action === 'reset_student_face_enrollment')).toBe(true)
  })

  // A07 failure-injection coverage at the HTTP boundary: replacement and
  // deletion failures leave an explicit recoverable state and retries complete
  // without claiming an incomplete replacement succeeded.
  it('replacement survives a Robin enroll failure leaving the previous enrollment intact', async () => {
    const { app, domainStore, mockRobinEnroll } = createTestEnvironment()
    const token = await signedOidcToken({
      sub: 'student-reenroll',
      roles: ['student'],
      scope: 'openid profile',
    })

    const firstRes = await app.request('/v1/mobile/face/enrollment', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: createTenJpegFormData(),
    })
    expect(firstRes.status).toBe(201)

    mockRobinEnroll.mockRejectedValueOnce(AppError.dependencyUnavailable('Robin'))
    const failedRes = await app.request('/v1/mobile/face/enrollment', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: createTenJpegFormData(),
    })
    expect(failedRes.status).toBe(503)

    // The previous enrollment is untouched: ten active files and the status
    // read still reports Robin-supported 'enrolled'.
    const filesAfterFailure = await domainStore.listFiles({
      userId: 'student-reenroll',
      purpose: 'face_enrollment',
      lifecycle: 'available',
    })
    expect(filesAfterFailure).toHaveLength(10)

    const statusRes = await app.request('/v1/mobile/face/enrollment/status', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(statusRes.status).toBe(200)
    const statusBody = await statusRes.json()
    expect(statusBody.data.status).toBe('enrolled')
  })

  it('retry after a Robin enroll failure completes with exactly ten files', async () => {
    const { app, domainStore, mockRobinEnroll } = createTestEnvironment()
    const token = await signedOidcToken({
      sub: 'student-reenroll',
      roles: ['student'],
      scope: 'openid profile',
    })

    // First attempt fails at the Robin boundary (rate limit allows 2 posts).
    mockRobinEnroll.mockRejectedValueOnce(AppError.dependencyUnavailable('Robin'))
    const failedRes = await app.request('/v1/mobile/face/enrollment', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: createTenJpegFormData(),
    })
    expect(failedRes.status).toBe(503)

    // The failed attempt left no files and no Astra enrollment state.
    const filesAfterFailure = await domainStore.listFiles({
      userId: 'student-reenroll',
      purpose: 'face_enrollment',
      lifecycle: 'available',
    })
    expect(filesAfterFailure).toHaveLength(0)
    expect(await domainStore.getFaceEnrollment('student-reenroll')).toBeNull()

    // The retry completes the enrollment.
    const retryRes = await app.request('/v1/mobile/face/enrollment', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: createTenJpegFormData(),
    })
    expect(retryRes.status).toBe(201)

    const activeFiles = await domainStore.listFiles({
      userId: 'student-reenroll',
      purpose: 'face_enrollment',
      lifecycle: 'available',
    })
    expect(activeFiles).toHaveLength(10)
    const faceEnrollment = await domainStore.getFaceEnrollment('student-reenroll')
    expect(faceEnrollment?.status).toBe('enrolled')
  })

  it('mobile deletion is not reported when Robin delete fails and a retry completes', async () => {
    const { app, domainStore, mockRobinDelete } = createTestEnvironment()
    const token = await signedOidcToken({
      sub: 'student-del',
      roles: ['student'],
      scope: 'openid profile',
    })

    const enrollRes = await app.request('/v1/mobile/face/enrollment', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: createTenJpegFormData(),
    })
    expect(enrollRes.status).toBe(201)

    mockRobinDelete.mockRejectedValueOnce(AppError.dependencyUnavailable('Robin'))
    const failedRes = await app.request('/v1/mobile/face/enrollment', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(failedRes.status).toBe(503)

    const filesAfterFailure = await domainStore.listFiles({
      userId: 'student-del',
      purpose: 'face_enrollment',
      lifecycle: 'available',
    })
    expect(filesAfterFailure).toHaveLength(10)
    const faceAfterFailure = await domainStore.getFaceEnrollment('student-del')
    expect(faceAfterFailure?.status).toBe('enrolled')

    const retryRes = await app.request('/v1/mobile/face/enrollment', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(retryRes.status).toBe(200)

    const activeFiles = await domainStore.listFiles({
      userId: 'student-del',
      purpose: 'face_enrollment',
      lifecycle: 'available',
    })
    expect(activeFiles).toHaveLength(0)
    const faceAfterRetry = await domainStore.getFaceEnrollment('student-del')
    expect(faceAfterRetry?.status).toBe('not_enrolled')
  })

  it('authorized file upload intent and confirmation lifecycle workflow', async () => {
    const { app, domainStore, objectStorage } = createTestEnvironment()
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

    // 2. Complete the upload (the client PUT against the presigned intent URL)
    objectStorage.objects.set(fileRecord!.object_path, {
      buffer: Buffer.alloc(500000),
      contentType: 'image/jpeg',
    })

    // 3. Confirm upload
    const confirmRes = await app.request(`/v1/mobile/files/${fileId}/confirm`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(confirmRes.status).toBe(200)
    const confirmBody = await confirmRes.json()
    expect(confirmBody.data.lifecycle).toBe('available')

    // 4. Get file with signed download URL
    const getRes = await app.request(`/v1/mobile/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(getRes.status).toBe(200)
    const getBody = await getRes.json()
    expect(getBody.data.file.id).toBe(fileId)
    expect(getBody.data.download_url).toBeDefined()

    // 5. Delete file
    const delRes = await app.request(`/v1/mobile/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(delRes.status).toBe(200)

    const deletedRecord = await domainStore.getFileRecord(fileId)
    expect(deletedRecord?.lifecycle).toBe('deleted')
  })
})
