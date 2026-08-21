import { beforeEach, describe, expect, it } from 'vitest'
import {
  deleteAdminNotification,
  enqueueAdminNotification,
  getAdminNotification,
  listAdminNotifications,
  retryAdminNotification,
} from '../../../src/modules/admin/service.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { AppProviders } from '../../../src/providers/types.js'

describe('Admin Notifications Service Unit Tests', () => {
  let domainStore: MemoryDomainStore
  let objectStorage: MemoryObjectStorage
  let identityProvider: MemoryIdentityProvider
  let providers: AppProviders

  beforeEach(() => {
    domainStore = new MemoryDomainStore()
    objectStorage = new MemoryObjectStorage()
    identityProvider = new MemoryIdentityProvider()

    const mockRobinClient = {
      checkReadiness: async () => ({ healthy: true }),
      getEnrollmentStatus: async () => ({
        status: 'enrolled' as const,
        embeddingCount: 10,
        message: 'Ready.',
      }),
      enroll: async () => ({ imagesProcessed: 10, imagesFailed: 0, totalEmbeddings: 10 }),
      identify: async () => ({
        status: 'ok' as const,
        confidence: 0.95,
        qualityScore: 0.9,
        processTimeMs: 40,
      }),
      deleteEnrollment: async () => {},
    }

    providers = {
      domainStore,
      objectStorage,
      identityProvider,
      robinClient: mockRobinClient,
    }

    // Setup student profile
    domainStore.profiles.set('student-1', {
      user_id: 'student-1',
      full_name: 'Budi Santoso',
      email: 'budi@school.sch.id',
      role: 'student',
      lifecycle_status: 'approved',
    })
  })

  it('enqueues a push notification and writes an audit log', async () => {
    const notification = await enqueueAdminNotification({
      userId: 'student-1',
      channel: 'push',
      payload: {
        title: 'Pengumuman Libur',
        body: 'Besok sekolah diliburkan.',
      },
      actorId: 'admin-1',
      actorRole: 'school_admin',
      providers,
    })

    expect(notification.id).toBeDefined()
    expect(notification.user_id).toBe('student-1')
    expect(notification.channel).toBe('push')
    expect(notification.status).toBe('pending')
    expect(notification.payload.title).toBe('Pengumuman Libur')

    const auditLogs = await domainStore.getAuditLogs('notification', notification.id)
    expect(auditLogs).toHaveLength(1)
    expect(auditLogs[0].action).toBe('enqueue_notification')
    expect(auditLogs[0].actor_id).toBe('admin-1')
  })

  it('throws notFound when enqueuing notification for non-existent user', async () => {
    await expect(
      enqueueAdminNotification({
        userId: 'non-existent-user',
        channel: 'email',
        payload: { title: 'Test', body: 'Test' },
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      }),
    ).rejects.toThrow('User profile not found.')
  })

  it('lists notifications with filter by channel and status', async () => {
    await domainStore.enqueueNotification({
      userId: 'student-1',
      channel: 'push',
      payload: { title: 'Notif 1', body: 'Body 1' },
      status: 'pending',
    })

    await domainStore.enqueueNotification({
      userId: 'student-1',
      channel: 'email',
      payload: { title: 'Notif 2', body: 'Body 2' },
      status: 'delivered',
    })

    const pendingPush = await listAdminNotifications({
      filter: { channel: 'push', status: 'pending' },
      actorId: 'admin-1',
      actorRole: 'school_admin',
      providers,
    })

    expect(pendingPush).toHaveLength(1)
    expect(pendingPush[0].channel).toBe('push')
    expect(pendingPush[0].status).toBe('pending')
  })

  it('retrieves single notification by ID', async () => {
    const created = await domainStore.enqueueNotification({
      userId: 'student-1',
      channel: 'push',
      payload: { title: 'Detail Test', body: 'Checking getById' },
    })

    const found = await getAdminNotification({
      id: created.id,
      actorId: 'admin-1',
      actorRole: 'staff',
      providers,
    })

    expect(found.id).toBe(created.id)
    expect(found.payload.title).toBe('Detail Test')
  })

  it('throws notFound for non-existent notification ID', async () => {
    await expect(
      getAdminNotification({
        id: 'non-existent-notif',
        actorId: 'admin-1',
        actorRole: 'school_admin',
        providers,
      }),
    ).rejects.toThrow('Notification not found.')
  })

  it('retries a failed notification and resets retry count', async () => {
    const failedNotif = await domainStore.enqueueNotification({
      userId: 'student-1',
      channel: 'email',
      payload: { title: 'Retry Test', body: 'Was failed' },
      status: 'failed',
    })
    await domainStore.updateNotificationStatus({
      id: failedNotif.id,
      status: 'failed',
      errorMessage: 'SMTP Error 550',
      retryCount: 3,
    })

    const retried = await retryAdminNotification({
      id: failedNotif.id,
      resetCount: true,
      actorId: 'admin-1',
      actorRole: 'platform_admin',
      providers,
    })

    expect(retried.status).toBe('pending')
    expect(retried.retry_count).toBe(0)
    expect(retried.error_message).toBeNull()
    expect(retried.next_retry_at).toBeNull()

    const auditLogs = await domainStore.getAuditLogs('notification', failedNotif.id)
    expect(auditLogs).toHaveLength(1)
    expect(auditLogs[0].action).toBe('retry_notification')
  })

  it('deletes notification and writes audit log', async () => {
    const notif = await domainStore.enqueueNotification({
      userId: 'student-1',
      channel: 'push',
      payload: { title: 'Delete Test', body: 'To be removed' },
    })

    await deleteAdminNotification({
      id: notif.id,
      actorId: 'admin-1',
      actorRole: 'school_admin',
      providers,
    })

    const found = await domainStore.getNotificationById(notif.id)
    expect(found).toBeNull()

    const auditLogs = await domainStore.getAuditLogs('notification', notif.id)
    expect(auditLogs).toHaveLength(1)
    expect(auditLogs[0].action).toBe('delete_notification')
  })

  it('forbids unauthorized actors from managing notifications', async () => {
    await expect(
      listAdminNotifications({
        actorId: 'student-1',
        actorRole: 'student',
        providers,
      }),
    ).rejects.toThrow('Access denied.')

    await expect(
      enqueueAdminNotification({
        userId: 'student-1',
        channel: 'push',
        payload: { title: 'Unauthorized', body: 'Hack' },
        actorId: 'student-1',
        actorRole: 'student',
        providers,
      }),
    ).rejects.toThrow('Access denied.')
  })
})
