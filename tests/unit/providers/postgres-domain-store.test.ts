import { describe, expect, it, vi } from 'vitest'
import { PostgresDomainStore } from '../../../src/providers/postgres/domain-store.js'
import { AppError } from '../../../src/lib/errors/app-error.js'
import type { Sql } from 'postgres'

describe('PostgresDomainStore (Greenfield)', () => {
  it('getUserProfile queries profiles table and returns result', async () => {
    const mockSql = vi.fn().mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join('?')
      expect(query).toContain('FROM profiles')
      expect(query).not.toContain('user_profiles')
      return [
        {
          user_id: 'user-123',
          full_name: 'Test Student',
          email: 'test@school.sch.id',
          nis: '12345',
          class_name: 'XII RPL 1',
          absence_number: '1',
          avatar_url: null,
          role: 'student',
          gender: 'L',
        },
      ]
    }) as unknown as Sql

    const store = new PostgresDomainStore({ sql: mockSql })
    const profile = await store.getUserProfile('user-123')

    expect(profile.user_id).toBe('user-123')
    expect(profile.full_name).toBe('Test Student')
    expect(profile.nis).toBe('12345')
  })

  it('getUserProfile throws notFound when profile does not exist', async () => {
    const mockSql = vi.fn().mockImplementation(async () => []) as unknown as Sql
    const store = new PostgresDomainStore({ sql: mockSql })

    await expect(store.getUserProfile('non-existent')).rejects.toThrow('User profile not found.')
  })

  it('getUserProfile throws sanitized internal AppError on database failure without leaking raw message', async () => {
    const mockSql = vi.fn().mockImplementation(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:5432')
    }) as unknown as Sql
    const store = new PostgresDomainStore({ sql: mockSql })

    try {
      await store.getUserProfile('user-123')
      expect.unreachable()
    } catch (err: any) {
      expect(err).toBeInstanceOf(AppError)
      expect(err.httpStatus).toBe(500)
      expect(err.message).toBe('An unexpected database error occurred.')
      expect(err.message).not.toContain('ECONNREFUSED')
    }
  })

  it('getTodayAbsences queries attendances table', async () => {
    const mockSql = vi.fn().mockImplementation(async (strings: TemplateStringsArray) => {
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
    }) as unknown as Sql

    const store = new PostgresDomainStore({ sql: mockSql })
    const records = await store.getTodayAbsences('user-123', '2026-08-20')

    expect(records.length).toBe(1)
    expect(records[0].status).toBe('Hadir')
  })

  it('insertAttendance inserts into attendances table', async () => {
    const mockSql = vi.fn().mockImplementation(async (strings: TemplateStringsArray) => {
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
    }) as unknown as Sql

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
    const mockSql = vi.fn().mockImplementation(async (strings: TemplateStringsArray) => {
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
    }) as unknown as Sql

    const store = new PostgresDomainStore({ sql: mockSql })
    const schedule = await store.getActiveSchedule('senin')

    expect(schedule).not.toBeNull()
    expect(schedule?.hari).toBe('senin')
    expect(schedule?.mulai_masuk).toBe('06:00:00')
  })

  it('getActivePermitsToday and getPermitHistory query leave_requests table', async () => {
    const mockSql = vi.fn().mockImplementation(async (strings: TemplateStringsArray) => {
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
    }) as unknown as Sql

    const store = new PostgresDomainStore({ sql: mockSql })
    const permits = await store.getActivePermitsToday('user-123', '2026-08-20T00:00:00+07:00', '2026-08-20T23:59:59+07:00')

    expect(permits.length).toBe(1)
    expect(permits[0].kategori_izin).toBe('sakit')
  })

  it('saveAttendanceRecord surfaces persistence failures as errors and never reports synthetic success', async () => {
    const mockSql = vi.fn().mockImplementation(async () => {
      throw new Error('Database connection failed during attendance insert')
    }) as unknown as Sql

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
    const mockSql = vi.fn().mockImplementation(async () => {
      throw new Error('Database connection failed during location check')
    }) as unknown as Sql

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
    const mockSql = vi.fn().mockImplementation(async (strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('FROM locations')) {
        return [
          {
            id: 'loc-1',
            name: 'Campus Central',
            latitude: -6.200000,
            longitude: 106.816666,
            radius_meters: 100,
          },
        ]
      }
      return []
    }) as unknown as Sql

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
})
