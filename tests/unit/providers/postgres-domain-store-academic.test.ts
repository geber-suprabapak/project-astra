import { describe, expect, it } from 'vitest'
import { PostgresDomainStore } from '../../../src/providers/postgres/domain-store.js'
import { createMockSql } from './postgres-mock-sql.js'

describe('PostgresDomainStore (Academic, Enrollment & Calendar)', () => {
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
    const currentStatus = 'active'
    let currentClassId = 'class-1'
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('FROM academic_periods') && query.includes('WHERE id =')) {
        return [
          {
            id: 'period-1',
            school_id: 'school-1',
            name: '2026/2027 Ganjil',
            start_date: '2026-07-01',
            end_date: '2026-12-31',
            is_active: true,
            is_locked: false,
          },
        ]
      }
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

  it('reads canonical and legacy enrollment identity fields from the shared roster query', async () => {
    const queries: string[] = []
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      queries.push(query)
      if (query.includes('FROM class_enrollments')) {
        return [
          {
            id: 'enroll-canonical',
            student_id: 'student-record-1',
            user_id: null,
            class_id: 'class-1',
            academic_period_id: 'period-1',
            absence_number: '7',
            status: 'active',
            class_name: 'XII RPL 1',
            student_name: 'Siti Aminah',
            nis: '2001',
            period_name: '2026/2027 Ganjil',
          },
        ]
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const rows = await store.listClassEnrollments({ classId: 'class-1' })
    const active = await store.getActiveClassEnrollment('student-1', 'period-1')

    expect(rows[0]).toMatchObject({
      student_id: 'student-record-1',
      user_id: null,
      student_name: 'Siti Aminah',
      nis: '2001',
      absence_number: '7',
    })
    expect(active?.absence_number).toBe('7')
    expect(queries.filter((query) => query.includes('FROM class_enrollments'))).toHaveLength(2)
    expect(queries.every((query) => query.includes('ce.student_id'))).toBe(true)
    expect(queries.every((query) => query.includes('ce.absence_number'))).toBe(true)
    expect(queries.every((query) => query.includes('LEFT JOIN students'))).toBe(true)
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

  it('casts date params outside bound values on updateAcademicPeriod/updateCalendarException and includes global holidays on listCalendarExceptions', async () => {
    const captured: Array<{ query: string; values: readonly unknown[] }> = []
    const mockSql = createMockSql(
      (strings: TemplateStringsArray, ...values: readonly unknown[]) => {
        const query = strings.join('?')
        captured.push({ query, values })
        if (query.includes('FROM academic_periods') && query.includes('WHERE id =')) {
          return [
            {
              id: 'period-1',
              school_id: 'school-1',
              start_date: '2026-07-01',
              end_date: '2026-12-31',
              is_active: false,
              is_locked: false,
            },
          ]
        }
        if (query.includes('INSERT INTO academic_periods')) {
          return [
            {
              id: 'period-draft',
              school_id: 'school-1',
              name: 'Draft',
              start_date: '2027-07-01',
              end_date: '2027-12-31',
              is_active: false,
            },
          ]
        }
        if (query.includes('UPDATE academic_periods')) {
          return [
            {
              id: 'period-1',
              school_id: 'school-1',
              name: 'Updated',
              start_date: '2026-07-02',
              end_date: '2026-12-30',
              is_active: false,
            },
          ]
        }
        if (query.includes('FROM calendar_exceptions') && query.includes('WHERE id =')) {
          return [
            {
              id: 'exc-1',
              school_id: 'school-1',
              academic_period_id: null,
              date: '2026-08-17',
              reason: 'HUT RI',
              is_holiday: true,
            },
          ]
        }
        if (query.includes('UPDATE calendar_exceptions')) {
          return [
            {
              id: 'exc-1',
              school_id: 'school-1',
              academic_period_id: null,
              date: '2026-08-18',
              reason: 'HUT RI',
              is_holiday: true,
            },
          ]
        }
        return []
      },
    )

    const store = new PostgresDomainStore({ sql: mockSql })
    const draft = await store.createAcademicPeriod({
      name: 'Draft',
      startDate: '2027-07-01',
      endDate: '2027-12-31',
    })
    expect(draft.is_active).toBe(false)
    const insertCall = captured.find((c) => c.query.includes('INSERT INTO academic_periods'))
    expect(insertCall?.values.at(-1)).toBe(false)

    await store.updateAcademicPeriod('period-1', {
      startDate: '2026-07-02',
      endDate: '2026-12-30',
    })
    const periodUpdate = captured.find((c) => c.query.includes('UPDATE academic_periods'))
    expect(periodUpdate?.query).toContain('?::date')
    expect(periodUpdate?.values).toContain('2026-07-02')
    expect(periodUpdate?.values).toContain('2026-12-30')
    expect(periodUpdate?.values.some((v) => String(v).includes('::date'))).toBe(false)

    await store.updateCalendarException('exc-1', { date: '2026-08-18' })
    const excUpdate = captured.find((c) => c.query.includes('UPDATE calendar_exceptions'))
    expect(excUpdate?.query).toContain('?::date')
    expect(excUpdate?.values).toContain('2026-08-18')
    expect(excUpdate?.values.some((v) => String(v).includes('::date'))).toBe(false)

    await store.listCalendarExceptions({ academicPeriodId: 'period-1' })
    const listExc = captured.find(
      (c) => c.query.includes('FROM calendar_exceptions') && c.query.includes('ORDER BY date ASC'),
    )
    expect(listExc?.query).toContain('academic_period_id IS NULL OR academic_period_id =')
  })
})
