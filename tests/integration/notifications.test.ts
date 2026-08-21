import { describe, expect, it } from 'vitest'
import type { JWTPayload } from 'jose'
import { createApp } from '../../src/app.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../src/providers/memory/index.js'
import type { RobinClient } from '../../src/clients/robin/client.js'
import { MockNotificationTransport } from '../../src/modules/notifications/transport.js'
import { NotificationWorker } from '../../src/workers/notification-worker.js'

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
  const transport = new MockNotificationTransport()

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

  const worker = new NotificationWorker({
    domainStore,
    transport,
    pollIntervalMs: 100,
    batchSize: 10,
    maxRetries: 3,
    backoffBaseMs: 1000,
  })

  return { domainStore, identityProvider, objectStorage, robinClient, transport, providers, app, worker }
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
    scopes: ['openid', 'profile'],
  })

  // 3. Student Pending
  domainStore.profiles.set('student-pending', {
    user_id: 'student-pending',
    full_name: 'Pending Student',
    email: 'pending@school.sch.id',
    nis: '1003',
    class_name: 'X RPL 1',
    absence_number: '20',
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

  // 4. School Admin
  domainStore.profiles.set('admin-1', {
    user_id: 'admin-1',
    full_name: 'Admin Sekolah',
    email: 'admin@school.sch.id',
    role: 'school_admin',
    lifecycle_status: 'approved',
  })
  identityProvider.users.set('admin-1', {
    userId: 'admin-1',
    email: 'admin@school.sch.id',
    roles: ['school_admin'],
    scopes: ['openid', 'profile', 'admin:read', 'admin:write'],
    mfaVerified: true,
  })
}

describe('Ticket 11 — Notification Outbox & Worker Integration Tests', () => {
  it('enqueues push notifications when admin approves or rejects leave requests and worker delivers them', async () => {
    const { domainStore, identityProvider, app, worker, transport } = createIntegrationEnvironment()
    await setupTestUsers(domainStore, identityProvider)

    const adminToken = tokenFor({
      sub: 'admin-1',
      roles: ['school_admin'],
      scope: 'openid profile admin:read admin:write leave:read leave:approve',
      mfa_verified: true,
      must_change_password: false,
    })

    // Create a leave request for student-1
    const permit = await domainStore.insertPermit({
      user_id: 'student-1',
      kategori_izin: 'sakit',
      deskripsi: 'Sakit demam',
      status: false,
      link_foto: null,
      tanggal: '2026-08-21T00:00:00+07:00',
    })

    // Admin approves leave request via API
    const approveRes = await app.request(`/v1/admin/leave-requests/${permit.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(approveRes.status).toBe(200)

    // Verify notification was placed in outbox
    const notifications = await domainStore.listNotifications({ userId: 'student-1' })
    expect(notifications.length).toBeGreaterThanOrEqual(1)
    const approveNotif = notifications.find((n) => n.payload.type === 'leave_approved')
    expect(approveNotif).toBeDefined()
    expect(approveNotif?.channel).toBe('push')
    expect(approveNotif?.status).toBe('pending')

    // Run worker batch processing
    const workerResult = await worker.processBatch()
    expect(workerResult.claimed).toBeGreaterThanOrEqual(1)
    expect(workerResult.delivered).toBeGreaterThanOrEqual(1)

    // Verify status transitioned to delivered
    const deliveredNotif = await domainStore.getNotificationById(approveNotif!.id)
    expect(deliveredNotif?.status).toBe('delivered')
    expect(transport.deliveredPushes.length).toBeGreaterThanOrEqual(1)
  })

  it('enqueues email notification when admin generates student password reset code', async () => {
    const { domainStore, identityProvider, app, worker, transport } = createIntegrationEnvironment()
    await setupTestUsers(domainStore, identityProvider)

    const adminToken = tokenFor({
      sub: 'admin-1',
      roles: ['school_admin'],
      scope: 'openid profile admin:read admin:write leave:read leave:approve',
      mfa_verified: true,
      must_change_password: false,
    })

    const resetRes = await app.request('/v1/admin/students/student-1/reset-code', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(resetRes.status).toBe(201)
    // SAFETY: Response shape is validated by endpoint schema
    const resetBody = (await resetRes.json()) as any
    expect(resetBody.success).toBe(true)

    // Verify outbox has reset code email notification
    const notifications = await domainStore.listNotifications({ userId: 'student-1', channel: 'email' })
    expect(notifications).toHaveLength(1)
    expect(notifications[0].payload.type).toBe('password_reset_code')
    expect(notifications[0].payload.code).toBe(resetBody.data.code)

    // Worker delivers the email
    const batchResult = await worker.processBatch()
    expect(batchResult.delivered).toBe(1)
    expect(transport.deliveredEmails).toHaveLength(1)
    expect(transport.deliveredEmails[0].recipient?.email).toBe('student1@school.sch.id')
  })

  it('supports admin notification outbox API: enqueue, list, inspect, retry, delete', async () => {
    const { domainStore, identityProvider, app, worker, transport } = createIntegrationEnvironment()
    await setupTestUsers(domainStore, identityProvider)

    const adminToken = tokenFor({
      sub: 'admin-1',
      roles: ['school_admin'],
      scope: 'openid profile admin:read admin:write leave:read leave:approve',
      mfa_verified: true,
      must_change_password: false,
    })

    // 1. Enqueue manual notification via POST /v1/admin/notifications
    const createRes = await app.request('/v1/admin/notifications', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: 'student-1',
        channel: 'email',
        payload: {
          title: 'Pengumuman Penting',
          body: 'Ujian akhir semester dimulai minggu depan.',
        },
      }),
    })
    expect(createRes.status).toBe(200)
    // SAFETY: Response shape is validated by endpoint schema
    const createBody = (await createRes.json()) as any
    expect(createBody.success).toBe(true)
    const notificationId = createBody.data.id
    expect(notificationId).toBeDefined()

    // 2. List notifications via GET /v1/admin/notifications
    const listRes = await app.request('/v1/admin/notifications?channel=email&status=pending', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(listRes.status).toBe(200)
    // SAFETY: Response shape is validated by endpoint schema
    const listBody = (await listRes.json()) as any
    expect(listBody.data.length).toBeGreaterThanOrEqual(1)

    // 3. Get notification by ID via GET /v1/admin/notifications/:id
    const getRes = await app.request(`/v1/admin/notifications/${notificationId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(getRes.status).toBe(200)
    // SAFETY: Response shape is validated by endpoint schema
    const getBody = (await getRes.json()) as any
    expect(getBody.data.id).toBe(notificationId)
    expect(getBody.data.payload.title).toBe('Pengumuman Penting')

    // 4. Simulate transport failure -> worker marks retry with backoff -> max retries -> failed
    transport.failureChannel = 'email'
    transport.failureError = 'SMTP host unreachable'

    // First attempt: retry count becomes 1
    await worker.processBatch()
    let current = await domainStore.getNotificationById(notificationId)
    expect(current?.status).toBe('pending')
    expect(current?.retry_count).toBe(1)

    // Clear next_retry_at for fast test execution
    await domainStore.updateNotificationStatus({ id: notificationId, status: 'pending', nextRetryAt: null })
    await worker.processBatch()

    await domainStore.updateNotificationStatus({ id: notificationId, status: 'pending', nextRetryAt: null })
    await worker.processBatch()

    current = await domainStore.getNotificationById(notificationId)
    expect(current?.status).toBe('failed')
    expect(current?.retry_count).toBe(3)

    // 5. Admin retries failed notification via POST /v1/admin/notifications/:id/retry
    transport.failureChannel = undefined // transport is healthy again
    const retryRes = await app.request(`/v1/admin/notifications/${notificationId}/retry`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(retryRes.status).toBe(200)
    // SAFETY: Response shape is validated by endpoint schema
    const retryBody = (await retryRes.json()) as any
    expect(retryBody.data.status).toBe('pending')
    expect(retryBody.data.retry_count).toBe(0)

    // Worker processes retried notification -> delivered
    const workerDeliverResult = await worker.processBatch()
    expect(workerDeliverResult.delivered).toBe(1)

    current = await domainStore.getNotificationById(notificationId)
    expect(current?.status).toBe('delivered')

    // 6. Delete notification via DELETE /v1/admin/notifications/:id
    const deleteRes = await app.request(`/v1/admin/notifications/${notificationId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(deleteRes.status).toBe(200)

    const afterDelete = await domainStore.getNotificationById(notificationId)
    expect(afterDelete).toBeNull()
  })
})
