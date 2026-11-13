import { describe, expect, it } from 'vitest'
import { PostgresDomainStore } from '../../../src/providers/postgres/domain-store.js'
import { createMockSql } from './postgres-mock-sql.js'

describe('PostgresDomainStore (Adiwiyata)', () => {
  describe('Adiwiyata admin reports', () => {
    const report = {
      id: 'report-1',
      site_id: 'site-1',
      class_id: 'class-1',
      reported_by: 'student-1',
      file_id: 'file-1',
      report_date: '2026-09-30',
      created_at: '2026-09-30T01:00:00Z',
      verified_at: null,
      verified_by: null,
    }
    const params = {
      reportId: 'report-1',
      schoolId: 'school-1',
      actorId: 'admin-1',
      verified: true,
      at: '2026-09-30T02:00:00Z',
    }

    it('lists same-school historical reports with optional filters and canonical file timestamps', async () => {
      const calls: { query: string; values: readonly unknown[] }[] = []
      const sql = createMockSql((strings, ...values) => {
        calls.push({ query: strings.join('?'), values })
        return [
          {
            ...report,
            site_name: 'Tanaman kelas',
            category: 'tanaman',
            class_name: 'X RPL 1',
            uploader_name: null,
            file_user_id: 'student-1',
            file_purpose: 'adiwiyata_report',
            file_object_path: 'student-1/photo.jpg',
            file_content_type: 'image/jpeg',
            file_size_bytes: 1024,
            file_lifecycle: 'available',
            file_created_at: '2026-09-30T00:59:59Z',
            file_updated_at: '2026-09-30T01:00:00Z',
          },
        ]
      })
      const store = new PostgresDomainStore({ sql })

      const rows = await store.listAdiwiyataAdminReports({
        schoolId: 'school-1',
        reportDate: '2026-09-30',
        classId: 'class-1',
        siteId: 'site-1',
      })
      expect(rows).toEqual([
        {
          ...report,
          site_name: 'Tanaman kelas',
          category: 'tanaman',
          class_name: 'X RPL 1',
          uploader_name: null,
          photo_file: {
            id: 'file-1',
            user_id: 'student-1',
            purpose: 'adiwiyata_report',
            object_path: 'student-1/photo.jpg',
            content_type: 'image/jpeg',
            size_bytes: 1024,
            lifecycle: 'available',
            created_at: '2026-09-30T00:59:59Z',
            updated_at: '2026-09-30T01:00:00Z',
          },
        },
      ])
      const query = calls[0]!.query
      expect(query).toContain('s.school_id = ?::uuid')
      expect(query).toContain('c.school_id = s.school_id')
      expect(query).toContain("f.purpose = 'adiwiyata_report'")
      expect(query).toContain('LEFT JOIN profiles')
      expect(query).not.toMatch(/is_active|academic_period|class_enrollments/)
      expect(calls[0]!.values).toEqual([
        'school-1',
        '2026-09-30',
        'class-1',
        'class-1',
        'site-1',
        'site-1',
      ])

      await store.listAdiwiyataAdminReports({ schoolId: 'school-1', reportDate: '2026-09-30' })
      expect(calls[1]!.values).toEqual(['school-1', '2026-09-30', null, null, null, null])
    })

    it.each([
      { verified: true, hasVerified: true, expectedStatus: 'verified' },
      { verified: false, hasVerified: false, expectedStatus: 'reported' },
      { verified: false, hasVerified: true, expectedStatus: 'verified' },
    ])(
      'changes verification with atomic audit and pair coverage: $verified / $hasVerified',
      async ({ verified, hasVerified, expectedStatus }) => {
        let inTransaction = false
        const current = {
          ...report,
          school_id: 'school-1',
          verified_at: verified ? null : '2026-09-30T01:30:00Z',
          verified_by: verified ? null : 'previous-admin',
        }
        const updated = {
          ...report,
          verified_at: verified ? params.at : null,
          verified_by: verified ? params.actorId : null,
        }
        const calls: { query: string; values: readonly unknown[]; inTransaction: boolean }[] = []
        const sql = createMockSql(
          (strings, ...values) => {
            const query = strings.join('?')
            calls.push({ query, values, inTransaction })
            if (query.includes('FROM adiwiyata_reports r')) return [current]
            if (query.includes('UPDATE adiwiyata_reports')) return [updated]
            if (query.includes('INSERT INTO audit_logs')) return [{ id: 'audit-1' }]
            if (query.includes('AS has_verified')) return [{ has_verified: hasVerified }]
            return []
          },
          (active) => {
            inTransaction = active
          },
        )
        const store = new PostgresDomainStore({ sql })

        const result = await store.updateAdiwiyataReportVerification({ ...params, verified })
        expect(result).toMatchObject({
          report: updated,
          changed: true,
          coverage_status: expectedStatus,
        })
        expect(calls.every((call) => call.inTransaction)).toBe(true)
        expect(inTransaction).toBe(false)
        expect(calls[0]!.values).toEqual(['report-1', 'school-1'])
        expect(calls[1]!.query).toContain('pg_advisory_xact_lock')
        expect(calls[1]!.values).toEqual(['adiwiyata-report:class-1:site-1:2026-09-30'])
        expect(calls[2]!.query).toContain('FOR UPDATE OF r')
        expect(calls[2]!.query).toContain('c.school_id = s.school_id')
        expect(calls[2]!.values).toEqual(['report-1', 'school-1'])
        const audit = calls.find((call) => call.query.includes('INSERT INTO audit_logs'))!
        expect(audit.values.slice(0, 3)).toEqual([
          'admin-1',
          verified ? 'verify' : 'unverify',
          'report-1',
        ])
        expect(JSON.parse(String(audit.values[3]))).toEqual({
          site_id: 'site-1',
          class_id: 'class-1',
          report_date: '2026-09-30',
          prior_verified_at: current.verified_at,
          prior_verified_by: current.verified_by,
          next_verified_at: updated.verified_at,
          next_verified_by: updated.verified_by,
        })
        expect(calls.at(-1)!.values).toEqual(['class-1', 'site-1', '2026-09-30'])
      },
    )

    it.each([true, false])(
      'uses the locked state for idempotent verification: %s',
      async (verified) => {
        const locked = {
          ...report,
          school_id: 'school-1',
          verified_at: verified ? '2026-09-30T01:30:00Z' : null,
          verified_by: verified ? 'other-admin' : null,
        }
        const queries: string[] = []
        const sql = createMockSql((strings) => {
          const query = strings.join('?')
          queries.push(query)
          if (query.includes('FOR UPDATE OF r')) return [locked]
          if (query.includes('FROM adiwiyata_reports r')) {
            return [{ ...locked, verified_at: verified ? null : params.at }]
          }
          if (query.includes('AS has_verified')) return [{ has_verified: verified }]
          return []
        })
        const store = new PostgresDomainStore({ sql })

        expect(
          await store.updateAdiwiyataReportVerification({ ...params, verified }),
        ).toMatchObject({
          report: locked,
          changed: false,
          coverage_status: verified ? 'verified' : 'reported',
        })
        expect(
          queries.some((query) => /UPDATE adiwiyata_reports|INSERT INTO audit_logs/.test(query)),
        ).toBe(false)
      },
    )

    it.each([false, true])(
      'does not mutate a missing scoped report, including after locking: %s',
      async (disappearsAfterLock) => {
        const queries: string[] = []
        const sql = createMockSql((strings, ...values) => {
          const query = strings.join('?')
          queries.push(query)
          if (query.includes('FROM adiwiyata_reports r')) {
            expect(values).toEqual(['report-1', 'school-1'])
            if (disappearsAfterLock && !query.includes('FOR UPDATE'))
              return [{ ...report, school_id: 'school-1' }]
          }
          return []
        })
        const store = new PostgresDomainStore({ sql })

        expect(await store.updateAdiwiyataReportVerification(params)).toBeNull()
        expect(
          queries.some((query) => /UPDATE adiwiyata_reports|INSERT INTO audit_logs/.test(query)),
        ).toBe(false)
        expect(queries.some((query) => query.includes('pg_advisory_xact_lock'))).toBe(
          disappearsAfterLock,
        )
      },
    )

    it.each(['throw', 'empty'])(
      'fails the verification transaction if its required audit is not persisted: %s',
      async (failure) => {
        let inTransaction = false
        const writes: string[] = []
        const sql = createMockSql(
          (strings) => {
            const query = strings.join('?')
            if (query.includes('FROM adiwiyata_reports r'))
              return [{ ...report, school_id: 'school-1' }]
            if (query.includes('UPDATE adiwiyata_reports')) {
              expect(inTransaction).toBe(true)
              writes.push('report')
              return [{ ...report, verified_at: params.at, verified_by: params.actorId }]
            }
            if (query.includes('INSERT INTO audit_logs')) {
              expect(inTransaction).toBe(true)
              writes.push('audit')
              if (failure === 'throw') throw new Error('synthetic private database failure')
            }
            if (query.includes('AS has_verified'))
              throw new Error('Coverage must not be returned after failed audit')
            return []
          },
          (active) => {
            inTransaction = active
          },
        )
        const store = new PostgresDomainStore({ sql })

        await expect(store.updateAdiwiyataReportVerification(params)).rejects.toMatchObject({
          code: 'INTERNAL_ERROR',
        })
        expect(writes).toEqual(['report', 'audit'])
        expect(inTransaction).toBe(false)
      },
    )
  })

  it('lists, atomically reactivates by unique user_id, and soft-updates eligibility by row id', async () => {
    const statements: { query: string; values: readonly unknown[] }[] = []
    const mockSql = createMockSql((strings: TemplateStringsArray, ...values) => {
      const query = strings.join('?')
      statements.push({ query, values })
      if (query.includes('INSERT INTO adiwiyata_eligibility')) {
        return [
          {
            id: 'eligibility-1',
            user_id: 'student-1',
            added_by: 'original-admin',
            is_active: true,
            created_at: '2026-09-01T00:00:00Z',
            updated_at: '2026-09-02T00:00:00Z',
          },
        ]
      }
      if (query.includes('UPDATE adiwiyata_eligibility')) {
        return [
          {
            id: 'eligibility-1',
            user_id: 'student-1',
            added_by: 'original-admin',
            is_active: false,
            created_at: '2026-09-01T00:00:00Z',
            updated_at: '2026-09-03T00:00:00Z',
          },
        ]
      }
      return [
        {
          id: 'eligibility-1',
          user_id: 'student-1',
          added_by: 'original-admin',
          is_active: false,
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-03T00:00:00Z',
        },
      ]
    })
    const store = new PostgresDomainStore({ sql: mockSql })

    const listed = await store.listAdiwiyataEligibility()
    expect(listed[0]?.is_active).toBe(false)
    const reactivated = await store.upsertAdiwiyataEligibility('student-1', 'new-admin')
    expect(reactivated).toMatchObject({
      id: 'eligibility-1',
      user_id: 'student-1',
      added_by: 'original-admin',
      is_active: true,
    })
    const revoked = await store.setAdiwiyataEligibilityActive('eligibility-1', false)
    expect(revoked?.is_active).toBe(false)

    const insert = statements.find(({ query }) =>
      query.includes('INSERT INTO adiwiyata_eligibility'),
    )!
    const conflict = insert.query.split('ON CONFLICT')[1]!
    expect(conflict).toContain('SET is_active = TRUE, updated_at = NOW()')
    expect(conflict).not.toContain('added_by =')
    expect(insert.values).toEqual(['student-1', 'new-admin'])
    const update = statements.find(({ query }) => query.includes('UPDATE adiwiyata_eligibility'))!
    expect(update.query).toContain('WHERE id = ?::uuid')
    expect(update.values).toEqual([false, 'eligibility-1'])
  })

  it('maps only a database unique violation to an Adiwiyata report conflict', async () => {
    const params = {
      reportId: 'report-1',
      userId: 'student-1',
      siteId: 'site-1',
      classId: 'class-1',
      profileName: 'Student',
      className: 'Class',
      reportDate: '2026-10-02',
      createdAt: '2026-10-02T03:00:00Z',
      fileId: 'file-1',
      fileSizeBytes: 100,
    }
    for (const [error, code] of [
      [Object.assign(new Error('synthetic duplicate'), { code: '23505' }), 'CONFLICT'],
      [
        Object.assign(new Error('synthetic foreign-key failure'), { code: '23503' }),
        'INTERNAL_ERROR',
      ],
      [null, 'INTERNAL_ERROR'],
    ] as const) {
      const sql = createMockSql(() => {
        throw error
      })
      await expect(
        new PostgresDomainStore({ sql }).submitAdiwiyataReport(params),
      ).rejects.toMatchObject({ code })
    }
  })
})
