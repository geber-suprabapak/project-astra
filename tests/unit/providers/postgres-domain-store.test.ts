import { describe, expect, it } from 'vitest'
import { PostgresDomainStore } from '../../../src/providers/postgres/domain-store.js'
import { AppError } from '../../../src/lib/errors/app-error.js'
import type { Sql } from 'postgres'

type MockQueryHandler = (
  strings: TemplateStringsArray,
  ..._values: readonly unknown[]
) => Promise<readonly unknown[]> | readonly unknown[]

type MockSqlTarget = MockQueryHandler & {
  begin?: <T>(cb: (sql: Sql) => Promise<T>) => Promise<T>
}

function createMockSql(handler: MockQueryHandler): Sql {
  let proxyInstance: Sql
  const targetHandler: MockSqlTarget = Object.assign(handler, {
    begin: async <T>(cb: (sql: Sql) => Promise<T>): Promise<T> => {
      return cb(proxyInstance)
    },
  })
  const proxy = new Proxy(targetHandler, {
    apply(_target, _thisArg, [strings, ...values]: [TemplateStringsArray, ...unknown[]]) {
      return handler(strings, ...values)
    },
    get(target, prop) {
      if (prop === 'begin') {
        return target.begin
      }
      return undefined
    },
  })
  // SAFETY: Mock SQL proxy provides the template tag execution contract required by PostgresDomainStore
  proxyInstance = proxy as Sql
  return proxyInstance
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

  it('getRoles, getRoleById, and getRoleByName query roles table', async () => {
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('FROM roles')) {
        return [
          {
            id: 'role-1',
            name: 'teacher',
            description: 'Teacher role',
            is_active: true,
            permissions: ['attendance:read'],
            created_at: '2026-08-21T00:00:00Z',
            updated_at: '2026-08-21T00:00:00Z',
          },
        ]
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const roles = await store.getRoles()
    expect(roles.length).toBe(1)
    expect(roles[0].name).toBe('teacher')

    const byId = await store.getRoleById('role-1')
    expect(byId?.name).toBe('teacher')

    const byName = await store.getRoleByName('teacher')
    expect(byName?.id).toBe('role-1')
  })

  it('createRole and updateRole manage roles in database', async () => {
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('INSERT INTO roles')) {
        return [{ id: 'role-2' }]
      }
      if (query.includes('WHERE r.id =')) {
        return [
          {
            id: 'role-2',
            name: 'staff',
            description: 'Staff member',
            is_active: true,
            permissions: [],
            created_at: '2026-08-21T00:00:00Z',
            updated_at: '2026-08-21T00:00:00Z',
          },
        ]
      }
      if (query.includes('WHERE LOWER(r.name) =')) {
        return []
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const created = await store.createRole({ name: 'staff', description: 'Staff member' })
    expect(created.name).toBe('staff')
  })

  it('getPermissions and createPermission query and insert permissions', async () => {
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('INSERT INTO permissions')) {
        return [
          {
            id: 'perm-1',
            name: 'reports:export',
            description: 'Export reports',
            created_at: '2026-08-21T00:00:00Z',
            updated_at: '2026-08-21T00:00:00Z',
          },
        ]
      }
      if (query.includes('FROM permissions')) {
        return [
          {
            id: 'perm-1',
            name: 'reports:export',
            description: 'Export reports',
            created_at: '2026-08-21T00:00:00Z',
            updated_at: '2026-08-21T00:00:00Z',
          },
        ]
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const perm = await store.createPermission({
      name: 'reports:export',
      description: 'Export reports',
    })
    expect(perm.name).toBe('reports:export')

    const list = await store.getPermissions()
    expect(list.length).toBe(1)
  })

  it('getUserRoles, assignUserRoles, and getUserEffectivePermissions query multi-role state', async () => {
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('FROM permissions p')) {
        return [{ name: 'attendance:read' }, { name: 'leave:read' }]
      }
      if (query.includes('FROM roles r')) {
        return [{ name: 'teacher' }, { name: 'staff' }]
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const roles = await store.getUserRoles('user-1')
    expect(roles).toEqual(['teacher', 'staff'])

    const perms = await store.getUserEffectivePermissions('user-1')
    expect(perms).toEqual(['attendance:read', 'leave:read'])
  })

  it('createStaffProfile, getStaffProfiles, and updateStaffProfile handle staff lifecycle', async () => {
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('INSERT INTO profiles')) {
        return [
          {
            user_id: 'staff-1',
            full_name: 'Pak Budi',
            email: 'budi@school.sch.id',
            role: 'teacher',
            lifecycle_status: 'approved',
            gender: 'L',
          },
        ]
      }
      if (query.includes('FROM profiles') && query.includes("role != 'student'")) {
        return [
          {
            user_id: 'staff-1',
            full_name: 'Pak Budi',
            email: 'budi@school.sch.id',
            role: 'teacher',
            lifecycle_status: 'approved',
            gender: 'L',
          },
        ]
      }
      if (query.includes('FROM profiles WHERE user_id =')) {
        return [
          {
            user_id: 'staff-1',
            full_name: 'Pak Budi',
            email: 'budi@school.sch.id',
            role: 'teacher',
            lifecycle_status: 'approved',
            gender: 'L',
          },
        ]
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const created = await store.createStaffProfile({
      userId: 'staff-1',
      fullName: 'Pak Budi',
      email: 'budi@school.sch.id',
      role: 'teacher',
      gender: 'L',
    })
    expect(created.user_id).toBe('staff-1')
    expect(created.full_name).toBe('Pak Budi')

    const staffList = await store.getStaffProfiles()
    expect(staffList.length).toBe(1)

    const staffMember = await store.getStaffProfile('staff-1')
    expect(staffMember?.user_id).toBe('staff-1')
  })

  it('revokeUserSessions and isSessionRevoked check revoked sessions table', async () => {
    let sessionRevoked = false
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('INSERT INTO revoked_sessions')) {
        sessionRevoked = true
        return []
      }
      if (query.includes('FROM revoked_sessions')) {
        return [{ count: sessionRevoked ? '1' : '0' }]
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    expect(await store.isSessionRevoked('user-1')).toBe(false)

    await store.revokeUserSessions('user-1')
    expect(await store.isSessionRevoked('user-1')).toBe(true)
  })

  it('manages academic periods with getActiveAcademicPeriod, create, update, setActive', async () => {
    let activePeriodId = 'period-1'
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('FROM academic_periods') && query.includes('is_active = true')) {
        return [
          {
            id: activePeriodId,
            school_id: 'school-1',
            name: '2026/2027 Ganjil',
            start_date: '2026-07-01',
            end_date: '2026-12-31',
            is_active: true,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ]
      }
      if (query.includes('FROM academic_periods') && query.includes('WHERE id =')) {
        return [
          {
            id: 'period-2',
            school_id: 'school-1',
            name: '2026/2027 Genap',
            start_date: '2027-01-01',
            end_date: '2027-06-30',
            is_active: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ]
      }
      if (query.includes('INSERT INTO academic_periods')) {
        return [
          {
            id: 'period-2',
            school_id: 'school-1',
            name: '2026/2027 Genap',
            start_date: '2027-01-01',
            end_date: '2027-06-30',
            is_active: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ]
      }
      if (query.includes('UPDATE academic_periods') && query.includes('is_active = false')) {
        return []
      }
      if (query.includes('UPDATE academic_periods') && query.includes('is_active = true')) {
        activePeriodId = 'period-2'
        return [
          {
            id: 'period-2',
            school_id: 'school-1',
            name: '2026/2027 Genap',
            start_date: '2027-01-01',
            end_date: '2027-06-30',
            is_active: true,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ]
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const active = await store.getActiveAcademicPeriod()
    expect(active?.id).toBe('period-1')
    expect(active?.name).toBe('2026/2027 Ganjil')

    const created = await store.createAcademicPeriod({
      name: '2026/2027 Genap',
      startDate: '2027-01-01',
      endDate: '2027-06-30',
    })
    expect(created.id).toBe('period-2')

    const activated = await store.setActiveAcademicPeriod('period-2')
    expect(activated.is_active).toBe(true)
  })

  it('manages class enrollments lifecycle with enroll, transfer, promote, and exit', async () => {
    let currentStatus = 'active'
    let currentClassId = 'class-1'
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('FROM class_enrollments') && query.includes("status = 'active'")) {
        return [
          {
            id: 'enroll-1',
            user_id: 'student-1',
            class_id: currentClassId,
            academic_period_id: 'period-1',
            status: currentStatus,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ]
      }
      if (query.includes('FROM classes') && query.includes('WHERE id =')) {
        return [
          {
            id: 'class-2',
            school_id: 'school-1',
            academic_period_id: 'period-1',
            name: 'XII RPL 2',
            grade: 12,
          },
        ]
      }
      if (query.includes('UPDATE class_enrollments') && query.includes("status = 'transferred'")) {
        return [
          {
            id: 'enroll-1',
            user_id: 'student-1',
            class_id: 'class-1',
            academic_period_id: 'period-1',
            status: 'transferred',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ]
      }
      if (query.includes('INSERT INTO class_enrollments')) {
        currentClassId = 'class-2'
        return [
          {
            id: 'enroll-2',
            user_id: 'student-1',
            class_id: 'class-2',
            academic_period_id: 'period-1',
            status: 'active',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ]
      }
      if (query.includes('UPDATE profiles') && query.includes('class_name =')) {
        return []
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const active = await store.getActiveClassEnrollment('student-1', 'period-1')
    expect(active?.status).toBe('active')

    const transfer = await store.transferStudentEnrollment({
      userId: 'student-1',
      toClassId: 'class-2',
      academicPeriodId: 'period-1',
    })
    expect(transfer.previous.status).toBe('transferred')
    expect(transfer.current.status).toBe('active')
  })

  it('manages locations and calendar exceptions in postgres domain store', async () => {
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('FROM locations')) {
        return [
          {
            id: 'loc-1',
            school_id: 'school-1',
            name: 'Kampus Utama',
            latitude: -3.316694,
            longitude: 114.590111,
            radius_meters: 100.0,
            is_active: true,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ]
      }
      if (query.includes('FROM calendar_exceptions')) {
        return [
          {
            id: 'exc-1',
            school_id: 'school-1',
            academic_period_id: 'period-1',
            date: '2026-08-17',
            reason: 'HUT RI',
            is_holiday: true,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ]
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const locations = await store.listLocations()
    expect(locations.length).toBe(1)
    expect(locations[0].name).toBe('Kampus Utama')

    const exception = await store.getCalendarExceptionByDate('2026-08-17', 'period-1')
    expect(exception?.reason).toBe('HUT RI')
    expect(exception?.is_holiday).toBe(true)
  })

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
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
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
    })

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

    const list = await store.listAttendances({ userId: 'student-1' })
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('att-manual-1')
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
    const mockSql = createMockSql((strings: TemplateStringsArray, ...values: readonly unknown[]) => {
      const query = strings.join('?')
      if (query.includes('FROM schedules')) return [existing]
      if (query.includes('UPDATE schedules')) {
        observedUpdates.push({ query, values })
        return [{ ...existing, mulai_masuk: '06:30:00', kompensasi_waktu: 20 }]
      }
      return []
    })

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
