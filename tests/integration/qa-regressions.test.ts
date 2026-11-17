import { describe, expect, it } from 'vitest'
import { createMobileContractEnvironment } from './helpers/mobile-contract-fixture.js'
import {
  createIntegrationEnvironment as createLeaveIntegrationEnvironment,
  setupTestUsers as setupLeaveUsers,
  tokenFor,
} from './helpers/leave-requests-fixture.js'

describe('QA regression tests for BFF boundary & upload validation', () => {
  it('returns 422 VALIDATION_ERROR (not 500) when JSON body is null on permits, admin leave PATCH, and notification retry', async () => {
    const mobileEnv = createMobileContractEnvironment()
    const mobilePermitRes = await mobileEnv.app.request('/v1/mobile/permits', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer student-123',
        'Content-Type': 'application/json',
      },
      body: 'null',
    })
    expect(mobilePermitRes.status).toBe(422)
    // SAFETY: error responses from Astra always conform to the standard error envelope
    const mobilePermitBody = (await mobilePermitRes.json()) as { error: { code: string } }
    expect(mobilePermitBody.error.code).toBe('VALIDATION_ERROR')

    const leaveEnv = createLeaveIntegrationEnvironment()
    await setupLeaveUsers(leaveEnv.domainStore, leaveEnv.identityProvider)
    const adminToken = tokenFor({
      sub: 'admin-1',
      roles: ['school_admin'],
      scope: 'openid profile admin:read admin:write leave:read leave:approve',
      mfa_verified: true,
      must_change_password: false,
    })

    const permit = await leaveEnv.domainStore.insertPermit({
      user_id: 'student-1',
      kategori_izin: 'sakit',
      deskripsi: 'Demam tinggi',
      status: false,
      link_foto: null,
      tanggal: '2026-08-22T00:00:00+07:00',
    })

    const patchLeaveRes = await leaveEnv.app.request(`/v1/admin/leave-requests/${permit.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: 'null',
    })
    expect(patchLeaveRes.status).toBe(422)
    // SAFETY: error responses from Astra always conform to the standard error envelope
    const patchLeaveBody = (await patchLeaveRes.json()) as { error: { code: string } }
    expect(patchLeaveBody.error.code).toBe('VALIDATION_ERROR')

    const notif = await leaveEnv.domainStore.enqueueNotification({
      userId: 'student-1',
      channel: 'push',
      payload: { title: 'Test', body: 'Test' },
    })

    const retryNotifRes = await leaveEnv.app.request(`/v1/admin/notifications/${notif.id}/retry`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: 'null',
    })
    expect(retryNotifRes.status).toBe(422)
    // SAFETY: error responses from Astra always conform to the standard error envelope
    const retryNotifBody = (await retryNotifRes.json()) as { error: { code: string } }
    expect(retryNotifBody.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects empty 0-byte uploads for avatar and permit attachments', async () => {
    const { app } = createMobileContractEnvironment()

    const emptyAvatarForm = new FormData()
    emptyAvatarForm.append('file', new Blob([], { type: 'image/jpeg' }), 'empty.jpg')
    const avatarRes = await app.request('/v1/mobile/profile/avatar', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer student-123' },
      body: emptyAvatarForm,
    })
    expect(avatarRes.status).toBe(422)

    const emptyPermitForm = new FormData()
    emptyPermitForm.append('category', 'sakit')
    emptyPermitForm.append('description', 'Sakit demam dan batuk berdahak')
    emptyPermitForm.append('date', '2026-08-22')
    emptyPermitForm.append('attachment', new Blob([], { type: 'image/jpeg' }), 'empty.jpg')
    const permitRes = await app.request('/v1/mobile/permits', {
      method: 'POST',
      headers: { Authorization: 'Bearer student-123' },
      body: emptyPermitForm,
    })
    expect(permitRes.status).toBe(422)
  })

  it('enforces bodyLimit on face enrollment and avatar endpoints and normalizes MIME parameters', async () => {
    const { app } = createMobileContractEnvironment()

    const bigEnrollmentRes = await app.request('/v1/mobile/face/enrollment', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer student-123',
        'Content-Type': 'multipart/form-data; boundary=abc',
        'Content-Length': String(23 * 1024 * 1024),
      },
      body: 'x',
    })
    expect(bigEnrollmentRes.status).toBe(413)

    const bigAvatarRes = await app.request('/v1/mobile/profile/avatar', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer student-123',
        'Content-Type': 'multipart/form-data; boundary=abc',
        'Content-Length': String(7 * 1024 * 1024),
      },
      body: 'x',
    })
    expect(bigAvatarRes.status).toBe(413)

    const charsetEnrollmentForm = new FormData()
    for (let i = 0; i < 10; i++) {
      charsetEnrollmentForm.append(
        'files',
        new Blob(['fake-jpeg'], { type: 'image/jpeg; charset=utf-8' }),
        `face_${i}.jpg`,
      )
    }
    const charsetEnrollmentRes = await app.request('/v1/mobile/face/enrollment', {
      method: 'POST',
      headers: { Authorization: 'Bearer student-123' },
      body: charsetEnrollmentForm,
    })
    expect(charsetEnrollmentRes.status).toBe(201)
  })
})
