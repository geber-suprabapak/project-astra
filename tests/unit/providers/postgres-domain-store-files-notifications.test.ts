import { describe, expect, it } from 'vitest'
import { PostgresDomainStore } from '../../../src/providers/postgres/domain-store.js'
import { createMockSql } from './postgres-mock-sql.js'

describe('PostgresDomainStore (Files, Face & Notifications)', () => {
  it('createFileRecord, getFileRecord, listFiles, and updateFileLifecycle operate on files table', async () => {
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('INSERT INTO files')) {
        return [
          {
            id: 'file-123',
            user_id: 'student-1',
            purpose: 'face_enrollment',
            object_path: 'student-1/face_1.jpg',
            content_type: 'image/jpeg',
            size_bytes: 1024,
            lifecycle: 'available',
            created_at: '2026-08-21T00:00:00Z',
            updated_at: '2026-08-21T00:00:00Z',
          },
        ]
      }
      if (query.includes('SELECT') && query.includes('FROM files')) {
        return [
          {
            id: 'file-123',
            user_id: 'student-1',
            purpose: 'face_enrollment',
            object_path: 'student-1/face_1.jpg',
            content_type: 'image/jpeg',
            size_bytes: 1024,
            lifecycle: 'available',
            created_at: '2026-08-21T00:00:00Z',
            updated_at: '2026-08-21T00:00:00Z',
          },
        ]
      }
      if (query.includes('UPDATE files')) {
        return [
          {
            id: 'file-123',
            user_id: 'student-1',
            purpose: 'face_enrollment',
            object_path: 'student-1/face_1.jpg',
            content_type: 'image/jpeg',
            size_bytes: 1024,
            lifecycle: 'deleted',
            created_at: '2026-08-21T00:00:00Z',
            updated_at: '2026-08-21T00:00:00Z',
          },
        ]
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const created = await store.createFileRecord({
      userId: 'student-1',
      purpose: 'face_enrollment',
      objectPath: 'student-1/face_1.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 1024,
    })
    expect(created.id).toBe('file-123')
    expect(created.purpose).toBe('face_enrollment')

    const fetched = await store.getFileRecord('file-123')
    expect(fetched?.id).toBe('file-123')

    const list = await store.listFiles({ userId: 'student-1', purpose: 'face_enrollment' })
    expect(list).toHaveLength(1)

    const updated = await store.updateFileLifecycle('file-123', 'deleted')
    expect(updated.lifecycle).toBe('deleted')
  })

  it('saveFaceEnrollment, getFaceEnrollment, and deleteFaceEnrollment operate on face_enrollments table', async () => {
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('INSERT INTO face_enrollments')) {
        return [
          {
            id: 'fe-123',
            user_id: 'student-1',
            status: 'enrolled',
            sample_count: 10,
            created_at: '2026-08-21T00:00:00Z',
            updated_at: '2026-08-21T00:00:00Z',
          },
        ]
      }
      if (query.includes('SELECT') && query.includes('FROM face_enrollments')) {
        return [
          {
            id: 'fe-123',
            user_id: 'student-1',
            status: 'enrolled',
            sample_count: 10,
            created_at: '2026-08-21T00:00:00Z',
            updated_at: '2026-08-21T00:00:00Z',
          },
        ]
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const saved = await store.saveFaceEnrollment({
      userId: 'student-1',
      status: 'enrolled',
      sampleCount: 10,
    })
    expect(saved.status).toBe('enrolled')
    expect(saved.sample_count).toBe(10)

    const fetched = await store.getFaceEnrollment('student-1')
    expect(fetched?.status).toBe('enrolled')

    await expect(store.deleteFaceEnrollment('student-1')).resolves.toBeUndefined()
  })

  it('handles notification outbox operations: enqueue, get, list, claim, updateStatus, and delete', async () => {
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('INSERT INTO notification_outbox')) {
        return [
          {
            id: 'notif-123',
            user_id: 'user-1',
            channel: 'push',
            payload: { title: 'Test Title', body: 'Test Body' },
            status: 'pending',
            retry_count: 0,
            next_retry_at: null,
            error_message: null,
            created_at: '2026-08-21T07:00:00Z',
            updated_at: '2026-08-21T07:00:00Z',
          },
        ]
      }
      if (query.includes('FOR UPDATE SKIP LOCKED')) {
        return [
          {
            id: 'notif-123',
            user_id: 'user-1',
            channel: 'push',
            payload: { title: 'Test Title', body: 'Test Body' },
            status: 'processing',
            retry_count: 0,
            next_retry_at: null,
            error_message: null,
            created_at: '2026-08-21T07:00:00Z',
            updated_at: '2026-08-21T07:00:00Z',
          },
        ]
      }
      if (
        query.includes('SELECT') &&
        query.includes('FROM notification_outbox') &&
        query.includes('WHERE id =')
      ) {
        return [
          {
            id: 'notif-123',
            user_id: 'user-1',
            channel: 'push',
            payload: { title: 'Test Title', body: 'Test Body' },
            status: 'pending',
            retry_count: 0,
            next_retry_at: null,
            error_message: null,
            created_at: '2026-08-21T07:00:00Z',
            updated_at: '2026-08-21T07:00:00Z',
          },
        ]
      }
      if (query.includes('SELECT') && query.includes('FROM notification_outbox')) {
        return [
          {
            id: 'notif-123',
            user_id: 'user-1',
            channel: 'push',
            payload: { title: 'Test Title', body: 'Test Body' },
            status: 'pending',
            retry_count: 0,
            next_retry_at: null,
            error_message: null,
            created_at: '2026-08-21T07:00:00Z',
            updated_at: '2026-08-21T07:00:00Z',
          },
        ]
      }
      if (query.includes('UPDATE notification_outbox')) {
        return [
          {
            id: 'notif-123',
            user_id: 'user-1',
            channel: 'push',
            payload: { title: 'Test Title', body: 'Test Body' },
            status: 'delivered',
            retry_count: 0,
            next_retry_at: null,
            error_message: null,
            created_at: '2026-08-21T07:00:00Z',
            updated_at: '2026-08-21T07:00:00Z',
          },
        ]
      }
      if (query.includes('DELETE FROM notification_outbox')) {
        return []
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })

    const enqueued = await store.enqueueNotification({
      userId: 'user-1',
      channel: 'push',
      payload: { title: 'Test Title', body: 'Test Body' },
    })
    expect(enqueued.id).toBe('notif-123')
    expect(enqueued.channel).toBe('push')
    expect(enqueued.status).toBe('pending')

    const fetched = await store.getNotificationById('notif-123')
    expect(fetched?.id).toBe('notif-123')

    const list = await store.listNotifications({ userId: 'user-1', channel: 'push' })
    expect(list).toHaveLength(1)

    const claimed = await store.claimPendingNotifications({ limit: 5, maxRetries: 3 })
    expect(claimed).toHaveLength(1)
    expect(claimed[0].status).toBe('processing')

    const updated = await store.updateNotificationStatus({
      id: 'notif-123',
      status: 'delivered',
    })
    expect(updated.status).toBe('delivered')

    await expect(store.deleteNotification('notif-123')).resolves.toBeUndefined()
  })
})
