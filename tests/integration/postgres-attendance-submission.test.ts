import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { AppError } from '../../src/lib/errors/app-error.js'
import { getTodayWIB } from '../../src/modules/dashboard/service.js'
import { PostgresDomainStore } from '../../src/providers/postgres/domain-store.js'

describe.skipIf(!process.env.TEST_POSTGRES_URL)(
  'PostgreSQL Attendance submission transaction',
  () => {
    const schema = `qa_attendance_${randomUUID().replaceAll('-', '')}`
    const setupSql = postgres(process.env.TEST_POSTGRES_URL ?? '', { max: 1 })
    const sql = postgres(process.env.TEST_POSTGRES_URL ?? '', {
      max: 4,
      connection: { search_path: schema },
    })
    const store = new PostgresDomainStore({ sql })

    beforeAll(async () => {
      await setupSql.unsafe(`CREATE SCHEMA "${schema}"`)
      for (const table of [
        'attendances',
        'attendance_attempts',
        'leave_requests',
        'schedules',
        'audit_logs',
      ]) {
        await setupSql.unsafe(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING DEFAULTS)`,
        )
      }
    })

    afterAll(async () => {
      await sql.end()
      await setupSql.unsafe(`DROP SCHEMA "${schema}" CASCADE`)
      await setupSql.end()
    })

    it('rolls back Attendance if its success Attempt cannot be persisted', async () => {
      const userId = randomUUID()
      await sql.unsafe(
        "ALTER TABLE attendance_attempts ADD CONSTRAINT qa_reject_success_attempt CHECK (status <> 'success') NOT VALID",
      )

      await expect(
        store.saveAttendanceRecord({
          userId,
          actionType: 'check_in',
          latitude: -6.2,
          longitude: 106.816666,
          successAttempt: {
            reason: 'synthetic verified face',
            processTimeMs: 12,
          },
        }),
      ).rejects.toMatchObject<AppError>({ code: 'INTERNAL_ERROR', httpStatus: 500 })

      const attendances = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM attendances WHERE user_id = ${userId}
    `
      const attempts = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM attendance_attempts WHERE user_id = ${userId}
    `
      expect(attendances[0]?.count).toBe(0)
      expect(attempts[0]?.count).toBe(0)
      await sql`ALTER TABLE attendance_attempts DROP CONSTRAINT qa_reject_success_attempt`
    })

    it('allows only one same-action write under concurrent Mobile and Manual callers', async () => {
      const userId = randomUUID()
      const date = getTodayWIB(new Date())
      const results = await Promise.allSettled([
        store.saveAttendanceRecord({
          userId,
          actionType: 'check_in',
          latitude: -6.2,
          longitude: 106.816666,
          successAttempt: {
            reason: 'synthetic verified face',
            processTimeMs: 12,
          },
        }),
        store.createManualAttendance({
          userId,
          actionType: 'check_in',
          status: 'Hadir',
          reason: 'synthetic duplicate-safe test',
          date,
          attemptId: 'synthetic-attempt',
          actorId: 'synthetic-admin',
          auditDetails: {},
        }),
      ])

      const attendanceCount = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM attendances WHERE user_id = ${userId}
    `
      const successAttemptCount = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM attendance_attempts
      WHERE user_id = ${userId} AND status = 'success'
    `
      const mobileSucceeded =
        results[0]?.status === 'fulfilled' && results[0].value.success === true
      const manualSucceeded = results[1]?.status === 'fulfilled'
      expect(Number(mobileSucceeded) + Number(manualSucceeded)).toBe(1)
      expect(attendanceCount[0]?.count).toBe(1)
      expect(successAttemptCount[0]?.count).toBe(mobileSucceeded ? 1 : 0)
    })
  },
)
