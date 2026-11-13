import { describe, expect, it } from 'vitest'
import { PostgresDomainStore } from '../../../src/providers/postgres/domain-store.js'
import { AppError } from '../../../src/lib/errors/app-error.js'
import { createMockSql } from './postgres-mock-sql.js'

describe('PostgresDomainStore (Profiles, School & Bootstrap)', () => {
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

  it('acceptRosterReport performs its writes inside one SQL transaction', async () => {
    let beginCalls = 0
    let inTransaction = false
    let writesOutsideTransaction = 0
    let reportStatus = 'staged'
    let acceptedBy: string | null = null
    const report = {
      id: 'report-1',
      school_id: 'school-1',
      academic_period_id: 'period-1',
      total_rows: 1,
      valid_rows: 1,
      rejected_rows: 0,
      review_state: 'pending',
      rows: [
        {
          nis: '1001',
          full_name: 'Student',
          class_name: 'XII RPL 1',
          class_id: 'class-1',
          gender: 'L',
          absence_number: '1',
        },
      ],
      rejected_items: [],
      accepted_at: null,
      accepted_by: null,
      created_at: '2026-08-21T00:00:00Z',
      updated_at: '2026-08-21T00:00:00Z',
    }
    const mockSql = createMockSql(
      (strings: TemplateStringsArray) => {
        const query = strings.join('?')
        if (/\b(INSERT|UPDATE|DELETE)\b/i.test(query) && !inTransaction) {
          writesOutsideTransaction += 1
        }
        if (query.includes('FROM roster_reports')) {
          return [{ ...report, status: reportStatus, accepted_by: acceptedBy }]
        }
        if (query.includes('FROM schools')) {
          return [{ id: 'school-1', name: 'SMKN 2', slug: 'smkn2', timezone: 'Asia/Jakarta' }]
        }
        if (query.includes('FROM academic_periods')) {
          return [{ id: 'period-1', school_id: 'school-1', name: '2026/2027 Ganjil' }]
        }
        if (query.includes('SELECT id FROM classes')) return [{ id: 'class-1' }]
        if (query.includes('INSERT INTO students')) return [{ id: 'student-1' }]
        if (query.includes('UPDATE roster_reports')) {
          reportStatus = 'accepted'
          acceptedBy = 'school-admin-1'
          return []
        }
        return []
      },
      (active) => {
        inTransaction = active
        if (active) beginCalls += 1
      },
    )

    const store = new PostgresDomainStore({ sql: mockSql })
    const accepted = await store.acceptRosterReport('report-1', 'school-admin-1')

    expect(beginCalls).toBe(1)
    expect(writesOutsideTransaction).toBe(0)
    expect(accepted.status).toBe('accepted')
    expect(accepted.accepted_by).toBe('school-admin-1')
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
})
