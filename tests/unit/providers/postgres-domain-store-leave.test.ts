import { describe, expect, it } from 'vitest'
import { PostgresDomainStore } from '../../../src/providers/postgres/domain-store.js'
import { createMockSql } from './postgres-mock-sql.js'

describe('PostgresDomainStore (Leave Requests)', () => {
  it('getActivePermitsToday and getPermitHistory query leave_requests table', async () => {
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      expect(query).toContain('leave_requests')
      expect(query).not.toContain('perizinan')
      return [
        {
          id: 'permit-1',
          approval_status: 'pending',
          kategori_izin: 'sakit',
        },
      ]
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const permits = await store.getActivePermitsToday(
      'user-123',
      '2026-08-20T00:00:00+07:00',
      '2026-08-20T23:59:59+07:00',
    )

    expect(permits.length).toBe(1)
    expect(permits[0].kategori_izin).toBe('sakit')
  })

  it('preserves a committed write when optional profile enrichment fails but propagates read failures', async () => {
    let committed = false
    const row = {
      id: 'leave-projection',
      user_id: 'projection-user',
      category: 'sakit',
      description: 'Projection test',
      date: '2035-02-01',
      status: false,
      approval_status: 'pending',
    }
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('INSERT INTO leave_requests')) {
        committed = true
        return [row]
      }
      if (committed && query.includes('FROM leave_requests'))
        throw new Error('Projection unavailable')
      return []
    })
    const store = new PostgresDomainStore({ sql: mockSql })
    expect(
      await store.createLeaveRequest({
        user_id: row.user_id,
        category: 'sakit',
        description: row.description,
        date: row.date,
      }),
    ).toMatchObject({ id: row.id, status: false, approval_status: 'pending' })
    await expect(store.getLeaveRequestById(row.id)).rejects.toThrow()
  })

  it('getLeaveRequestById, listLeaveRequests, updateLeaveRequestStatus, and deleteLeaveRequest operate on leave_requests table', async () => {
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('UPDATE leave_requests')) {
        return [
          {
            id: 'leave-123',
            user_id: 'student-1',
            category: 'sakit',
            description: 'Sakit tifus',
            status: true,
            attachment_url: 'student-1/doc.jpg',
            date: '2026-08-21T00:00:00+07:00',
            approval_status: 'approved',
            rejection_reason: null,
            rejected_at: null,
            created_at: '2026-08-21T07:00:00Z',
            updated_at: '2026-08-21T07:30:00Z',
          },
        ]
      }
      if (
        query.includes('SELECT') &&
        query.includes('FROM profiles') &&
        query.includes('user_id = ?')
      ) {
        return [
          {
            user_id: 'student-1',
            full_name: 'Budi Santoso',
            nis: '1001',
            class_name: 'XII RPL 1',
            absence_number: '05',
            role: 'student',
            lifecycle_status: 'approved',
          },
        ]
      }
      if (query.includes('SELECT') && query.includes('FROM leave_requests')) {
        return [
          {
            id: 'leave-123',
            user_id: 'student-1',
            category: 'sakit',
            description: 'Sakit tifus',
            status: false,
            attachment_url: 'student-1/doc.jpg',
            date: '2026-08-21T00:00:00+07:00',
            approval_status: 'pending',
            rejection_reason: null,
            rejected_at: null,
            created_at: '2026-08-21T07:00:00Z',
            updated_at: '2026-08-21T07:00:00Z',
            student_name: 'Budi Santoso',
            student_nis: '1001',
            student_class: 'XII RPL 1',
            absence_number: '05',
          },
        ]
      }
      if (query.includes('DELETE FROM leave_requests')) {
        return []
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })

    const single = await store.getLeaveRequestById('leave-123')
    expect(single).not.toBeNull()
    expect(single?.id).toBe('leave-123')
    expect(single?.student_name).toBe('Budi Santoso')

    const list = await store.listLeaveRequests({ userId: 'student-1', approvalStatus: 'pending' })
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('leave-123')

    const updated = await store.updateLeaveRequestStatus({
      id: 'leave-123',
      approvalStatus: 'approved',
      status: true,
    })
    expect(updated.id).toBe('leave-123')
    expect(updated.approval_status).toBe('approved')
    expect(updated.status).toBe(true)

    await expect(store.deleteLeaveRequest('leave-123')).resolves.toBeUndefined()
  })

  it('runs an approved status update and its required audit insert in one transaction', async () => {
    let transactionActive = false
    const statements: { query: string; inTransaction: boolean }[] = []
    const mockSql = createMockSql(
      (strings: TemplateStringsArray) => {
        const query = strings.join('?')
        statements.push({ query, inTransaction: transactionActive })

        if (query.includes('SELECT user_id FROM leave_requests')) {
          return [{ user_id: 'student-1' }]
        }
        if (query.includes('FOR UPDATE')) {
          return [
            {
              id: 'leave-123',
              user_id: 'student-1',
              category: 'sakit',
              description: 'Synthetic Leave Request',
              status: false,
              attachment_url: null,
              date: '2026-08-21',
              approval_status: 'pending',
            },
          ]
        }
        if (query.includes('SELECT id') && query.includes('FROM leave_requests')) return []
        if (query.includes('FROM attendances')) return []
        if (query.includes('UPDATE leave_requests')) {
          return [
            {
              id: 'leave-123',
              user_id: 'student-1',
              category: 'sakit',
              description: 'Synthetic Leave Request',
              status: true,
              attachment_url: null,
              date: '2026-08-21',
              approval_status: 'approved',
              original_end_date: '2026-08-23',
              effective_end_date: '2026-08-23',
              duration_days: 3,
            },
          ]
        }
        if (query.includes('INSERT INTO audit_logs')) {
          throw new Error('synthetic audit database failure')
        }
        return []
      },
      (active) => {
        transactionActive = active
      },
    )
    const store = new PostgresDomainStore({ sql: mockSql })

    await expect(
      store.updateLeaveRequestStatus({
        id: 'leave-123',
        approvalStatus: 'approved',
        durationDays: 3,
        audit: { actorId: 'admin-1', action: 'approve_leave_request' },
      }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' })

    const statusWrite = statements.find(({ query }) => query.includes('UPDATE leave_requests'))
    const auditWrite = statements.find(({ query }) => query.includes('INSERT INTO audit_logs'))
    expect(statusWrite?.inTransaction).toBe(true)
    expect(auditWrite?.inTransaction).toBe(true)
  })

  it('runs a rejection status update and its required audit insert in one transaction', async () => {
    let transactionActive = false
    const statements: { query: string; inTransaction: boolean; values: readonly unknown[] }[] = []
    const mockSql = createMockSql(
      (strings: TemplateStringsArray, ...values: readonly unknown[]) => {
        const query = strings.join('?')
        statements.push({ query, inTransaction: transactionActive, values })
        if (query.includes('FOR UPDATE')) {
          return [
            {
              id: 'leave-123',
              user_id: 'student-1',
              category: 'sakit',
              description: 'Synthetic Leave Request',
              status: false,
              attachment_url: null,
              date: '2026-08-21',
              approval_status: 'pending',
            },
          ]
        }
        if (query.includes('UPDATE leave_requests')) {
          return [
            {
              id: 'leave-123',
              user_id: 'student-1',
              category: 'sakit',
              description: 'Synthetic Leave Request',
              status: false,
              attachment_url: null,
              date: '2026-08-21',
              approval_status: 'rejected',
              rejection_reason: 'Synthetic reason',
              rejected_at: '2026-08-22T12:00:00.000Z',
            },
          ]
        }
        if (query.includes('INSERT INTO audit_logs')) return [{ id: 'audit-123' }]
        return []
      },
      (active) => {
        transactionActive = active
      },
    )
    const store = new PostgresDomainStore({ sql: mockSql })

    const updated = await store.updateLeaveRequestStatus({
      id: 'leave-123',
      approvalStatus: 'rejected',
      rejectionReason: 'Synthetic reason',
      rejectedAt: '2026-08-22T12:00:00.000Z',
      audit: {
        actorId: 'admin-1',
        actorName: 'History Actor',
        actorRole: 'teacher',
        action: 'reject_leave_request',
      },
    })

    expect(updated.approval_status).toBe('rejected')
    expect(
      statements.find(({ query }) => query.includes('UPDATE leave_requests'))?.inTransaction,
    ).toBe(true)
    expect(
      statements.find(({ query }) => query.includes('INSERT INTO audit_logs'))?.inTransaction,
    ).toBe(true)
    const auditWrite = statements.find(({ query }) => query.includes('INSERT INTO audit_logs'))
    expect(JSON.parse(String(auditWrite?.values[3]))).toMatchObject({
      actor_name: 'History Actor',
      actor_role: 'teacher',
    })
  })

  it('persists the force-finish actor snapshot in the audit transaction', async () => {
    const statements: { query: string; values: readonly unknown[] }[] = []
    const mockSql = createMockSql(
      (strings: TemplateStringsArray, ...values: readonly unknown[]) => {
        const query = strings.join('?')
        statements.push({ query, values })
        if (query.includes('SELECT user_id FROM leave_requests')) return [{ user_id: 'student-1' }]
        if (query.includes('FOR UPDATE')) {
          return [
            {
              id: 'leave-force-finish',
              user_id: 'student-1',
              category: 'sakit',
              description: 'Synthetic approved Leave Period',
              status: true,
              attachment_url: null,
              date: '2026-08-21',
              approval_status: 'approved',
              original_end_date: '2026-08-23',
              effective_end_date: '2026-08-23',
            },
          ]
        }
        if (query.includes('UPDATE leave_requests')) {
          return [
            {
              id: 'leave-force-finish',
              user_id: 'student-1',
              category: 'sakit',
              description: 'Synthetic approved Leave Period',
              status: true,
              attachment_url: null,
              date: '2026-08-21',
              approval_status: 'approved',
              original_end_date: '2026-08-23',
              effective_end_date: '2026-08-22',
            },
          ]
        }
        if (query.includes('INSERT INTO audit_logs')) return [{ id: 'audit-force-finish' }]
        return []
      },
    )
    const store = new PostgresDomainStore({ sql: mockSql })

    const finished = await store.forceFinishLeaveRequest({
      id: 'leave-force-finish',
      effectiveEndDate: '2026-08-22',
      actorId: 'teacher-1',
      actorName: 'History Actor',
      actorRole: 'teacher',
      reason: 'Student returned early',
    })

    expect(finished.effective_end_date).toBe('2026-08-22')
    const auditWrite = statements.find(({ query }) => query.includes('INSERT INTO audit_logs'))
    expect(JSON.parse(String(auditWrite?.values[2]))).toMatchObject({
      actor_name: 'History Actor',
      actor_role: 'teacher',
    })
  })

  it('lists leave periods by inclusive overlap using WIB date boundaries', async () => {
    const calls: { query: string; values: readonly unknown[] }[] = []
    const mockSql = createMockSql((strings: TemplateStringsArray, ...queryValues) => {
      calls.push({ query: strings.join('?'), values: queryValues })
      return [
        {
          id: 'leave-cross-month',
          user_id: 'student-1',
          category: 'sakit',
          description: 'Sakit lintas bulan',
          status: true,
          attachment_url: null,
          date: '2026-08-25',
          approval_status: 'approved',
          original_end_date: '2026-09-05',
          effective_end_date: '2026-09-05',
          duration_days: 12,
        },
      ]
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const rows = await store.listLeaveRequests({
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].requested_start_date).toBe('2026-08-25')
    const endBound = calls.find(({ query }) =>
      query.includes("(lr.date AT TIME ZONE 'Asia/Jakarta')::date <= ?::date"),
    )
    const startBound = calls.find(({ query }) =>
      query.includes(
        "COALESCE(lr.effective_end_date, lr.original_end_date, (lr.date AT TIME ZONE 'Asia/Jakarta')::date) >= ?::date",
      ),
    )
    expect(endBound?.values).toEqual(['2026-09-30'])
    expect(startBound?.values).toEqual(['2026-09-01'])
    expect(
      calls.every(({ query }) => !query.includes('lr.date >=') && !query.includes('lr.date <=')),
    ).toBe(true)
  })

  it('rejects approval when the locked leave request is no longer pending', async () => {
    const queries: string[] = []
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      queries.push(query)
      if (query.includes('SELECT user_id FROM leave_requests')) {
        return [{ user_id: 'student-1' }]
      }
      if (query.includes('FOR UPDATE')) {
        return [
          {
            id: 'leave-processed',
            user_id: 'student-1',
            category: 'sakit',
            description: 'Sakit demam',
            status: true,
            attachment_url: null,
            date: '2026-08-21',
            approval_status: 'approved',
          },
        ]
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })

    await expect(
      store.updateLeaveRequestStatus({
        id: 'leave-processed',
        approvalStatus: 'approved',
        status: true,
        durationDays: 1,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(queries.some((query) => query.includes('FOR UPDATE'))).toBe(true)
    expect(queries.some((query) => query.includes('UPDATE leave_requests'))).toBe(false)
  })
})
