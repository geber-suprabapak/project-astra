import { beforeEach, describe, expect, it } from 'vitest'
import { MockNotificationTransport } from '../../../src/modules/notifications/transport.js'
import { MemoryDomainStore } from '../../../src/providers/memory/index.js'
import { NotificationWorker } from '../../../src/workers/notification-worker.js'

describe('NotificationWorker Unit Tests', () => {
  let domainStore: MemoryDomainStore
  let transport: MockNotificationTransport
  let worker: NotificationWorker

  beforeEach(async () => {
    domainStore = new MemoryDomainStore()
    transport = new MockNotificationTransport()
    worker = new NotificationWorker({
      domainStore,
      transport,
      pollIntervalMs: 100,
      batchSize: 5,
      maxRetries: 3,
      backoffBaseMs: 1000,
    })

    // Setup a test profile
    domainStore.profiles.set('user-1', {
      user_id: 'user-1',
      full_name: 'Budi Santoso',
      email: 'budi@school.sch.id',
      role: 'student',
      lifecycle_status: 'approved',
    })

    domainStore.profiles.set('user-2', {
      user_id: 'user-2',
      full_name: 'Siti Aminah',
      email: 'siti@school.sch.id',
      role: 'student',
      lifecycle_status: 'approved',
    })
  })

  it('processes and delivers push and email notifications in batch', async () => {
    const pushNotif = await domainStore.enqueueNotification({
      userId: 'user-1',
      channel: 'push',
      payload: { title: 'Presensi Masuk', body: 'Presensi Anda telah tercatat.' },
    })

    const emailNotif = await domainStore.enqueueNotification({
      userId: 'user-2',
      channel: 'email',
      payload: { title: 'Reset Kata Sandi', body: 'Kode reset: 123456' },
    })

    const batchResult = await worker.processBatch()

    expect(batchResult.claimed).toBe(2)
    expect(batchResult.delivered).toBe(2)
    expect(batchResult.retried).toBe(0)
    expect(batchResult.failed).toBe(0)

    const updatedPush = await domainStore.getNotificationById(pushNotif.id)
    expect(updatedPush?.status).toBe('delivered')
    expect(updatedPush?.error_message).toBeNull()

    const updatedEmail = await domainStore.getNotificationById(emailNotif.id)
    expect(updatedEmail?.status).toBe('delivered')
    expect(updatedEmail?.error_message).toBeNull()

    expect(transport.deliveredPushes).toHaveLength(1)
    expect(transport.deliveredEmails).toHaveLength(1)
  })

  it('handles delivery failure with exponential backoff retry scheduling', async () => {
    transport.failureChannel = 'push'
    transport.failureError = 'FCM connection timeout'

    const pushNotif = await domainStore.enqueueNotification({
      userId: 'user-1',
      channel: 'push',
      payload: { title: 'Pemberitahuan', body: 'Uji coba retry' },
    })

    const batchResult = await worker.processBatch()

    expect(batchResult.claimed).toBe(1)
    expect(batchResult.delivered).toBe(0)
    expect(batchResult.retried).toBe(1)
    expect(batchResult.failed).toBe(0)

    const updated = await domainStore.getNotificationById(pushNotif.id)
    expect(updated?.status).toBe('pending')
    expect(updated?.retry_count).toBe(1)
    expect(updated?.error_message).toBe('FCM connection timeout')
    expect(updated?.next_retry_at).toBeDefined()
  })

  it('transitions to failed status when maxRetries is exceeded', async () => {
    transport.failureChannel = 'email'
    transport.failureError = 'SMTP mailbox full'

    const emailNotif = await domainStore.enqueueNotification({
      userId: 'user-2',
      channel: 'email',
      payload: { title: 'Tagihan SPP', body: 'Mohon selesaikan pembayaran.' },
    })

    // Attempt 1: retry_count becomes 1
    await worker.processBatch()
    let current = await domainStore.getNotificationById(emailNotif.id)
    expect(current?.status).toBe('pending')
    expect(current?.retry_count).toBe(1)

    // Reset next_retry_at so it can be claimed immediately
    await domainStore.updateNotificationStatus({
      id: emailNotif.id,
      status: 'pending',
      nextRetryAt: null,
    })

    // Attempt 2: retry_count becomes 2
    await worker.processBatch()
    current = await domainStore.getNotificationById(emailNotif.id)
    expect(current?.status).toBe('pending')
    expect(current?.retry_count).toBe(2)

    // Reset next_retry_at so it can be claimed immediately
    await domainStore.updateNotificationStatus({
      id: emailNotif.id,
      status: 'pending',
      nextRetryAt: null,
    })

    // Attempt 3: retry_count reaches maxRetries (3), status becomes failed
    const thirdResult = await worker.processBatch()
    expect(thirdResult.failed).toBe(1)
    current = await domainStore.getNotificationById(emailNotif.id)
    expect(current?.status).toBe('failed')
    expect(current?.retry_count).toBe(3)
    expect(current?.next_retry_at).toBeNull()
  })

  it('skips notifications scheduled for the future', async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    await domainStore.enqueueNotification({
      userId: 'user-1',
      channel: 'push',
      payload: { title: 'Pengingat Besok', body: 'Jangan lupa presensi' },
      nextRetryAt: futureDate,
    })

    const batchResult = await worker.processBatch()

    expect(batchResult.claimed).toBe(0)
    expect(batchResult.delivered).toBe(0)
  })

  it('respects batch size limits', async () => {
    for (let i = 0; i < 10; i++) {
      await domainStore.enqueueNotification({
        userId: 'user-1',
        channel: 'push',
        payload: { title: `Notif ${i}`, body: `Body ${i}` },
      })
    }

    const batchResult = await worker.processBatch()

    expect(batchResult.claimed).toBe(5) // batchSize is 5
    expect(batchResult.delivered).toBe(5)

    const remaining = await domainStore.listNotifications({ status: 'pending' })
    expect(remaining).toHaveLength(5)
  })

  it('starts and stops cleanly reporting running status', async () => {
    expect(worker.getRunningStatus().isRunning).toBe(false)

    worker.start()
    expect(worker.getRunningStatus().isRunning).toBe(true)

    // Starting while already running is idempotent
    worker.start()
    expect(worker.getRunningStatus().isRunning).toBe(true)

    await worker.stop()
    expect(worker.getRunningStatus().isRunning).toBe(false)
  })
})
