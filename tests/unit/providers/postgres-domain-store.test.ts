import { describe, expect, it } from 'vitest'
import { PostgresDomainStore } from '../../../src/providers/postgres/domain-store.js'
import { AppError } from '../../../src/lib/errors/app-error.js'
import type { Sql } from 'postgres'

type MockQueryHandler = (
  strings: TemplateStringsArray,
  ..._values: readonly unknown[]
) => Promise<readonly unknown[]> | readonly unknown[]

function createMockSql(handler: MockQueryHandler): Sql {
  const proxy = new Proxy(handler, {
    apply(_target, _thisArg, [strings, ...values]: [TemplateStringsArray, ...unknown[]]) {
      return handler(strings, ...values)
    },
  })
  // SAFETY: Mock SQL proxy provides the template tag execution contract required by PostgresDomainStore
  return proxy as Sql
}

describe('PostgresDomainStore (Greenfield)', () => {
  it('getUserProfile queries profiles table and returns result', async () => {
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
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
          lifecycle_status: 'approved',
          gender: 'L',
        },
      ]
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const profile = await store.getUserProfile('user-123')

    expect(profile.user_id).toBe('user-123')
    expect(profile.full_name).toBe('Test Student')
    expect(profile.nis).toBe('12345')
    expect(profile.lifecycle_status).toBe('approved')
  })

  it('getUserProfile throws notFound when profile does not exist', async () => {
    const mockSql = createMockSql(() => [])
    const store = new PostgresDomainStore({ sql: mockSql })

    await expect(store.getUserProfile('non-existent')).rejects.toThrow('User profile not found.')
  })

  it('getUserProfile throws sanitized internal AppError on database failure without leaking raw message', async () => {
    const mockSql = createMockSql(() => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:5432')
    })
    const store = new PostgresDomainStore({ sql: mockSql })

    try {
      await store.getUserProfile('user-123')
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      // SAFETY: err is verified as AppError by expect(err).toBeInstanceOf(AppError)
      const appErr = err as AppError
      expect(appErr.httpStatus).toBe(500)
      expect(appErr.message).toBe('An unexpected database error occurred.')
      expect(appErr.message).not.toContain('ECONNREFUSED')
    }
  })

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

  it('getProfileByNis queries profiles table by nis', async () => {
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      expect(query).toContain('FROM profiles')
      expect(query).toContain('WHERE nis =')
      return [
        {
          user_id: 'student-1001',
          full_name: 'Ahmad Fauzi',
          email: null,
          nis: '1001',
          class_name: 'XII RPL 1',
          absence_number: '1',
          avatar_url: null,
          role: 'student',
          lifecycle_status: 'approved',
          gender: 'L',
        },
      ]
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const profile = await store.getProfileByNis('1001')

    expect(profile).not.toBeNull()
    expect(profile?.nis).toBe('1001')
    expect(profile?.full_name).toBe('Ahmad Fauzi')
  })

  it('getSchool and createSchool manage school entity and initial academic period', async () => {
    let insertedPeriod = false
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('INSERT INTO schools')) {
        return [
          {
            id: 'school-1',
            name: 'SMKN 2 Banjarmasin',
            slug: 'smkn2bjm',
            timezone: 'Asia/Jakarta',
            signup_open: false,
            created_at: '2026-08-21T00:00:00Z',
            updated_at: '2026-08-21T00:00:00Z',
          },
        ]
      }
      if (query.includes('INSERT INTO academic_periods')) {
        insertedPeriod = true
        return []
      }
      if (query.includes('FROM schools')) {
        return [
          {
            id: 'school-1',
            name: 'SMKN 2 Banjarmasin',
            slug: 'smkn2bjm',
            timezone: 'Asia/Jakarta',
            signup_open: false,
            created_at: '2026-08-21T00:00:00Z',
            updated_at: '2026-08-21T00:00:00Z',
          },
        ]
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const created = await store.createSchool({
      name: 'SMKN 2 Banjarmasin',
      slug: 'smkn2bjm',
    })

    expect(created.id).toBe('school-1')
    expect(created.timezone).toBe('Asia/Jakarta')
    expect(insertedPeriod).toBe(true)

    const school = await store.getSchool()
    expect(school?.name).toBe('SMKN 2 Banjarmasin')
  })

  it('createInitialSchoolAdmin inserts or updates profile with school_admin role', async () => {
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      expect(query).toContain('INSERT INTO profiles')
      expect(query).toContain('school_admin')
      return [
        {
          user_id: 'school-admin-1',
          full_name: 'Admin Name',
          email: 'admin@school.sch.id',
          nis: null,
          class_name: null,
          absence_number: null,
          avatar_url: null,
          role: 'school_admin',
          lifecycle_status: 'approved',
          gender: null,
        },
      ]
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const profile = await store.createInitialSchoolAdmin({
      userId: 'school-admin-1',
      fullName: 'Admin Name',
      email: 'admin@school.sch.id',
    })

    expect(profile.user_id).toBe('school-admin-1')
    expect(profile.role).toBe('school_admin')
    expect(profile.lifecycle_status).toBe('approved')
  })

  it('stageRosterReport and getRosterReport persist staged reports', async () => {
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('INSERT INTO roster_reports')) {
        return [
          {
            id: 'report-1',
            school_id: 'school-1',
            total_rows: 1,
            valid_rows: 1,
            rejected_rows: 0,
            status: 'staged',
            review_state: 'pending',
            rows: [{ nis: '1001', full_name: 'Student', class_name: 'XII RPL 1', grade: 12 }],
            rejected_items: [],
            accepted_at: null,
            accepted_by: null,
            created_at: '2026-08-21T00:00:00Z',
            updated_at: '2026-08-21T00:00:00Z',
          },
        ]
      }
      if (query.includes('FROM roster_reports')) {
        return [
          {
            id: 'report-1',
            school_id: 'school-1',
            total_rows: 1,
            valid_rows: 1,
            rejected_rows: 0,
            status: 'staged',
            review_state: 'pending',
            rows: [{ nis: '1001', full_name: 'Student', class_name: 'XII RPL 1', grade: 12 }],
            rejected_items: [],
            accepted_at: null,
            accepted_by: null,
            created_at: '2026-08-21T00:00:00Z',
            updated_at: '2026-08-21T00:00:00Z',
          },
        ]
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const report = await store.stageRosterReport({
      schoolId: 'school-1',
      totalRows: 1,
      validRows: 1,
      rejectedRows: 0,
      status: 'staged',
      reviewState: 'pending',
      rows: [{ nis: '1001', full_name: 'Student', class_name: 'XII RPL 1', grade: 12 }],
      rejectedItems: [],
    })

    expect(report.id).toBe('report-1')
    expect(report.status).toBe('staged')

    const fetched = await store.getRosterReport('report-1')
    expect(fetched?.id).toBe('report-1')
  })

  it('openSignup and getBootstrapStatus return proper status', async () => {
    let signupOpened = false
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('UPDATE schools') && query.includes('signup_open = true')) {
        signupOpened = true
        return []
      }
      if (query.includes('FROM schools')) {
        return [
          {
            id: 'school-1',
            name: 'SMKN 2',
            slug: 'smkn2',
            timezone: 'Asia/Jakarta',
            signup_open: signupOpened,
            created_at: '2026-08-21T00:00:00Z',
            updated_at: '2026-08-21T00:00:00Z',
          },
        ]
      }
      if (query.includes('FROM academic_periods')) {
        return [
          {
            id: 'period-1',
            school_id: 'school-1',
            name: '2026/2027 Ganjil',
            start_date: '2026-07-01',
            end_date: '2026-12-31',
            is_active: true,
          },
        ]
      }
      if (query.includes('COUNT(*) as count FROM profiles')) {
        return [{ count: '1' }]
      }
      if (query.includes('FROM roster_reports') && query.includes('LIMIT 1')) {
        return [
          {
            id: 'report-1',
            school_id: 'school-1',
            total_rows: 1,
            valid_rows: 1,
            rejected_rows: 0,
            status: 'accepted',
            review_state: 'accepted',
            rows: [],
            rejected_items: [],
          },
        ]
      }
      if (query.includes('COUNT(*) as count FROM roster_reports')) {
        return [{ count: '1' }]
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    await store.openSignup()
    expect(signupOpened).toBe(true)

    const status = await store.getBootstrapStatus()
    expect(status.school_configured).toBe(true)
    expect(status.school_admin_created).toBe(true)
    expect(status.active_academic_period).toBe(true)
    expect(status.roster_accepted).toBe(true)
    expect(status.signup_open).toBe(true)
  })

  it('insertAuditLog and getAuditLogs store and query audit entries', async () => {
    let insertedAudit = false
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('INSERT INTO audit_logs')) {
        insertedAudit = true
        return []
      }
      if (query.includes('FROM audit_logs')) {
        return [
          {
            id: 'audit-1',
            actor_id: 'admin-1',
            action: 'bootstrap_school',
            entity_type: 'school',
            entity_id: 'school-1',
            details: { name: 'SMKN 2' },
            created_at: '2026-08-21T00:00:00Z',
          },
        ]
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    await store.insertAuditLog({
      actor_id: 'admin-1',
      action: 'bootstrap_school',
      entity_type: 'school',
      entity_id: 'school-1',
      details: { name: 'SMKN 2' },
    })

    expect(insertedAudit).toBe(true)

    const logs = await store.getAuditLogs('school', 'school-1')
    expect(logs.length).toBe(1)
    expect(logs[0].action).toBe('bootstrap_school')
  })
})
