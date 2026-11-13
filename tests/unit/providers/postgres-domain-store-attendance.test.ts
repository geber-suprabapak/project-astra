import { describe, expect, it } from 'vitest'
import { PostgresDomainStore } from '../../../src/providers/postgres/domain-store.js'
import { AppError } from '../../../src/lib/errors/app-error.js'
import { createMockSql } from './postgres-mock-sql.js'

describe('PostgresDomainStore (Attendance & Schedules)', () => {
  it('getTodayAbsences queries attendances table', async () => {
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      expect(query).toContain('FROM attendances')
      expect(query).not.toContain('FROM absences')
      return [
        {
          status: 'Hadir',
          created_at: '2026-08-20T07:00:00Z',
          date: '2026-08-20',
          user_id: 'user-123',
        },
      ]
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const records = await store.getTodayAbsences('user-123', '2026-08-20')

    expect(records.length).toBe(1)
    expect(records[0].status).toBe('Hadir')
  })

  it('insertAttendance inserts into attendances table', async () => {
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      expect(query).toContain('INSERT INTO attendances')
      return [
        {
          status: 'Hadir',
          created_at: '2026-08-20T07:00:00Z',
          date: '2026-08-20',
          user_id: 'user-123',
        },
      ]
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const inserted = await store.insertAttendance({
      user_id: 'user-123',
      date: '2026-08-20',
      status: 'Hadir',
    })

    expect(inserted.status).toBe('Hadir')
    expect(inserted.user_id).toBe('user-123')
  })

  it('getActiveSchedule queries schedules table', async () => {
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      expect(query).toContain('FROM schedules')
      expect(query).not.toContain('jadwal_absensi')
      return [
        {
          hari: 'senin',
          mulai_masuk: '06:00:00',
          selesai_masuk: '07:15:00',
          mulai_pulang: '15:00:00',
          selesai_pulang: '18:00:00',
          kompensasi_waktu: 15,
          is_active: true,
        },
      ]
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const schedule = await store.getActiveSchedule('senin')

    expect(schedule).not.toBeNull()
    expect(schedule?.hari).toBe('senin')
    expect(schedule?.mulai_masuk).toBe('06:00:00')
  })

  it('saveAttendanceRecord surfaces persistence failures as errors and never reports synthetic success', async () => {
    const mockSql = createMockSql(() => {
      throw new Error('Database connection failed during attendance insert')
    })

    const store = new PostgresDomainStore({ sql: mockSql })

    await expect(
      store.saveAttendanceRecord({
        userId: 'user-123',
        actionType: 'check_in',
        latitude: -6.2,
        longitude: 106.8,
      }),
    ).rejects.toThrow(AppError)
  })

  it('validateAttendanceAction surfaces persistence failures as errors and never reports synthetic success', async () => {
    const mockSql = createMockSql(() => {
      throw new Error('Database connection failed during location check')
    })

    const store = new PostgresDomainStore({ sql: mockSql })

    await expect(
      store.validateAttendanceAction({
        userId: 'user-123',
        latitude: -6.2,
        longitude: 106.8,
      }),
    ).rejects.toThrow(AppError)
  })

  it('validateAttendanceAction checks location radius and returns blocked if outside', async () => {
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('FROM locations')) {
        return [
          {
            id: 'loc-1',
            name: 'Campus Central',
            latitude: -6.2,
            longitude: 106.816666,
            radius_meters: 100,
          },
        ]
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    // Latitude/longitude far away (e.g. Bali: -8.4, 115.1)
    const result = await store.validateAttendanceAction({
      userId: 'user-123',
      latitude: -8.409518,
      longitude: 115.188919,
    })

    expect(result.actionable).toBe(false)
    expect(result.action_type).toBe('none')
    expect(result.message).toContain('Di luar radius lokasi sekolah')
  })

  it('recordAttendanceAttempt, listAttendanceAttempts, and getAttendanceAttempt operate on attendance_attempts table', async () => {
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('INSERT INTO attendance_attempts')) {
        return [
          {
            id: 'attempt-123',
            user_id: 'student-1',
            action_type: 'check_in',
            status: 'failed',
            reason: 'Face does not match enrolled face',
            quality_score: 0.45,
            confidence: 0.52,
            latitude: -6.2,
            longitude: 106.81,
            process_time_ms: 120,
            created_at: '2026-08-21T07:05:00Z',
          },
        ]
      }
      if (query.includes('SELECT') && query.includes('FROM attendance_attempts')) {
        return [
          {
            id: 'attempt-123',
            user_id: 'student-1',
            action_type: 'check_in',
            status: 'failed',
            reason: 'Face does not match enrolled face',
            quality_score: 0.45,
            confidence: 0.52,
            latitude: -6.2,
            longitude: 106.81,
            process_time_ms: 120,
            created_at: '2026-08-21T07:05:00Z',
          },
        ]
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const recorded = await store.recordAttendanceAttempt({
      userId: 'student-1',
      actionType: 'check_in',
      status: 'failed',
      reason: 'Face does not match enrolled face',
      qualityScore: 0.45,
      confidence: 0.52,
      latitude: -6.2,
      longitude: 106.81,
      processTimeMs: 120,
    })

    expect(recorded.id).toBe('attempt-123')
    expect(recorded.status).toBe('failed')
    expect(recorded.confidence).toBe(0.52)

    const list = await store.listAttendanceAttempts({ userId: 'student-1', status: 'failed' })
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('attempt-123')

    const single = await store.getAttendanceAttempt('attempt-123')
    expect(single?.id).toBe('attempt-123')
  })

  it('createManualAttendance and listAttendances operate on attendances table', async () => {
    let inTransaction = false
    const writes: { query: string; inTransaction: boolean }[] = []
    const mockSql = createMockSql(
      (strings: TemplateStringsArray) => {
        const query = strings.join('?')
        if (query.includes('INSERT INTO attendances') || query.includes('INSERT INTO audit_logs')) {
          writes.push({ query, inTransaction })
        }
        if (query.includes('INSERT INTO attendances')) {
          return [
            {
              id: 'att-manual-1',
              user_id: 'student-1',
              date: '2026-08-21',
              status: 'Hadir',
              action_type: 'check_in',
              latitude: -6.2,
              longitude: 106.81,
              created_at: '2026-08-21T07:10:00Z',
            },
          ]
        }
        if (query.includes('INSERT INTO audit_logs')) return [{ id: 'audit-manual-1' }]
        if (query.includes('SELECT status, action_type')) return []
        if (query.includes('SELECT') && query.includes('FROM attendances')) {
          return [
            {
              id: 'att-manual-1',
              user_id: 'student-1',
              date: '2026-08-21',
              status: 'Hadir',
              action_type: 'check_in',
              latitude: -6.2,
              longitude: 106.81,
              created_at: '2026-08-21T07:10:00Z',
            },
          ]
        }
        return []
      },
      (active) => {
        inTransaction = active
      },
    )

    const store = new PostgresDomainStore({ sql: mockSql })
    const manual = await store.createManualAttendance({
      userId: 'student-1',
      actionType: 'check_in',
      status: 'Hadir',
      reason: 'Face camera broken',
      actorId: 'admin-1',
    })

    expect(manual.id).toBe('att-manual-1')
    expect(manual.status).toBe('Hadir')
    expect(manual.action_type).toBe('check_in')
    expect(writes).toHaveLength(2)
    expect(writes.every((write) => write.inTransaction)).toBe(true)

    const list = await store.listAttendances({ userId: 'student-1' })
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('att-manual-1')
  })

  it('fails the manual attendance transaction if its audit insert fails', async () => {
    let inTransaction = false
    const writes: { query: string; inTransaction: boolean }[] = []
    const mockSql = createMockSql(
      (strings: TemplateStringsArray) => {
        const query = strings.join('?')
        if (query.includes('INSERT INTO attendances') || query.includes('INSERT INTO audit_logs')) {
          writes.push({ query, inTransaction })
        }
        if (query.includes('INSERT INTO attendances')) {
          return [
            {
              id: 'att-manual-2',
              user_id: 'student-1',
              date: '2026-08-21',
              status: 'Hadir',
              action_type: 'check_in',
              latitude: null,
              longitude: null,
              created_at: '2026-08-21T07:10:00Z',
            },
          ]
        }
        if (query.includes('INSERT INTO audit_logs')) throw new Error('synthetic audit failure')
        return []
      },
      (active) => {
        inTransaction = active
      },
    )
    const store = new PostgresDomainStore({ sql: mockSql })

    await expect(
      store.createManualAttendance({
        userId: 'student-1',
        actionType: 'check_in',
        status: 'Hadir',
        reason: 'Verified in person',
        actorId: 'school-admin-1',
      }),
    ).rejects.toThrow('An unexpected database error occurred.')

    expect(writes).toHaveLength(2)
    expect(writes.every((write) => write.inTransaction)).toBe(true)
    expect(writes[1]?.query).toContain('INSERT INTO audit_logs')
  })

  it('updateSchedule casts partial time edits in SQL and preserves omitted columns', async () => {
    const scheduleId = 'd85474f9-9d2b-4f13-bc55-18f2c66f82f4'
    const existing = {
      id: scheduleId,
      school_id: 'b1246237-46ec-44ae-abff-1c3eb9b3c899',
      class_id: 'e043a145-a0f8-4b21-b53c-5ddb8042ab20',
      academic_period_id: '42de502f-3a7e-412e-a1c3-5af2b4cc40da',
      location_id: '0e7bb61c-8267-4b94-84ca-e165007a23bc',
      day_of_week: 'senin',
      hari: 'senin',
      mulai_masuk: '06:00:00',
      selesai_masuk: '07:15:00',
      mulai_pulang: '15:00:00',
      selesai_pulang: '18:00:00',
      kompensasi_waktu: 15,
      is_active: true,
      created_at: '2026-08-21T00:00:00Z',
      updated_at: '2026-08-21T00:00:00Z',
    }
    const observedUpdates: Array<{ query: string; values: readonly unknown[] }> = []
    const mockSql = createMockSql(
      (strings: TemplateStringsArray, ...values: readonly unknown[]) => {
        const query = strings.join('?')
        if (query.includes('FROM schedules')) return [existing]
        if (query.includes('UPDATE schedules')) {
          observedUpdates.push({ query, values })
          return [{ ...existing, mulai_masuk: '06:30:00', kompensasi_waktu: 20 }]
        }
        return []
      },
    )

    const store = new PostgresDomainStore({ sql: mockSql })
    const updated = await store.updateSchedule(scheduleId, {
      startTime: '06:30',
      gracePeriodMinutes: 20,
    })

    expect(updated.mulai_masuk).toBe('06:30:00')
    expect(updated.kompensasi_waktu).toBe(20)
    expect(observedUpdates).toHaveLength(1)
    expect(observedUpdates[0].query).toContain('start_time = COALESCE(?::time, start_time)')
    expect(observedUpdates[0].query).toContain('end_time = COALESCE(?::time, end_time)')
    expect(observedUpdates[0].query).toContain('start_checkout = COALESCE(?::time, start_checkout)')
    expect(observedUpdates[0].query).toContain('end_checkout = COALESCE(?::time, end_checkout)')
    expect(observedUpdates[0].values).toEqual([
      null,
      '06:30',
      null,
      null,
      null,
      20,
      null,
      null,
      null,
      null,
      scheduleId,
    ])
  })

  it('deleteAttendances locks and deletes the requested attendance records', async () => {
    const record = {
      id: 'att-manual-1',
      user_id: 'student-1',
      date: '2026-08-21',
      status: 'Hadir',
      action_type: 'check_in',
      latitude: -6.2,
      longitude: 106.81,
      created_at: '2026-08-21T07:10:00Z',
    }
    const queries: string[] = []
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      queries.push(query)
      if (query.includes('FOR UPDATE')) return [record]
      if (query.includes('DELETE FROM attendances')) return [record]
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const deleted = await store.deleteAttendances(['att-manual-1'])

    expect(deleted).toEqual([record])
    expect(queries.some((query) => query.includes('FOR UPDATE'))).toBe(true)
    expect(queries.some((query) => query.includes('DELETE FROM attendances'))).toBe(true)
  })
})
