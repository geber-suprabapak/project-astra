import { describe, expect, it } from 'vitest'
import { computeAttendanceStatus } from '../../../src/modules/dashboard/service.js'
import { getAttendanceCalendar } from '../../../src/modules/attendance/service.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import { PostgresDomainStore } from '../../../src/providers/postgres/domain-store.js'
import {
  normalizeAttendanceRecord,
  type Absence,
  type AppProviders,
  type AttendanceRecord,
  type AttendanceStatus,
} from '../../../src/providers/types.js'
import type { RobinClient } from '../../../src/clients/robin/client.js'
import type { Sql } from 'postgres'

const mockRobinClient: RobinClient = {
  checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
  getEnrollmentStatus: async () => ({
    status: 'not_enrolled',
    embeddingCount: 0,
    message: 'No enrollment found.',
  }),
  enroll: async () => ({
    status: 'ok',
    userId: 'mock-user',
    samplesReceived: 0,
    embeddingsCreated: 0,
    message: 'Mock enrolled',
  }),
  verifyFace: async () => ({
    matched: false,
    confidence: 0,
    qualityScore: 0,
    processTimeMs: 0,
  }),
}

function toLegacyAttendanceStatus(status: string): AttendanceStatus {
  // SAFETY: Intentionally testing legacy attendance record with historical status 'Datang'
  return status as AttendanceStatus
}

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
    begin: async <T>(cb: (sql: Sql) => Promise<T>): Promise<T> => cb(proxyInstance),
  })
  const proxy = new Proxy(targetHandler, {
    apply(_target, _thisArg, [strings, ...values]: [TemplateStringsArray, ...unknown[]]) {
      return handler(strings, ...values)
    },
    get(target, prop) {
      if (prop === 'begin') return target.begin
      return undefined
    },
  })
  // SAFETY: Mock SQL proxy fulfills the postgres Sql interface for testing PostgresDomainStore
  proxyInstance = proxy as Sql
  return proxyInstance
}

describe('Adversarial Challenge M0 Iteration 2: Astra Attendance Taxonomy & Normalization', () => {
  describe('1. normalizeAttendanceRecord Helper (ADR-002)', () => {
    it('normalizes legacy status "Datang" with null action_type to "Hadir" and "check_in"', () => {
      const legacy = {
        id: 'att-1',
        user_id: 'user-1',
        date: '2026-09-01',
        status: 'Datang',
        action_type: null,
        created_at: '2026-09-01T07:00:00.000Z',
      }
      const normalized = normalizeAttendanceRecord(legacy)
      expect(normalized.status).toBe('Hadir')
      expect(normalized.action_type).toBe('check_in')
      expect(normalized.id).toBe('att-1')
      expect(normalized.user_id).toBe('user-1')
    })

    it('preserves action_type if Datang row already had action_type check_in', () => {
      const legacy = {
        id: 'att-2',
        user_id: 'user-2',
        date: '2026-09-01',
        status: 'Datang',
        action_type: 'check_in' as const,
        created_at: '2026-09-01T07:00:00.000Z',
      }
      const normalized = normalizeAttendanceRecord(legacy)
      expect(normalized.status).toBe('Hadir')
      expect(normalized.action_type).toBe('check_in')
    })

    it('leaves canonical records (Hadir, Terlambat, Pulang, Alpha) untouched', () => {
      const hadir = normalizeAttendanceRecord({
        id: 'h1',
        status: 'Hadir',
        action_type: 'check_in' as const,
      })
      expect(hadir.status).toBe('Hadir')
      expect(hadir.action_type).toBe('check_in')

      const terlambat = normalizeAttendanceRecord({
        id: 't1',
        status: 'Terlambat',
        action_type: 'check_in' as const,
      })
      expect(terlambat.status).toBe('Terlambat')
      expect(terlambat.action_type).toBe('check_in')

      const pulang = normalizeAttendanceRecord({
        id: 'p1',
        status: 'Pulang',
        action_type: 'check_out' as const,
      })
      expect(pulang.status).toBe('Pulang')
      expect(pulang.action_type).toBe('check_out')

      const alpha = normalizeAttendanceRecord({
        id: 'a1',
        status: 'Alpha',
        action_type: null,
      })
      expect(alpha.status).toBe('Alpha')
      expect(alpha.action_type).toBe(null)
    })
  })

  describe('2. computeAttendanceStatus with Legacy Datang', () => {
    it('evaluates single Datang record as present, hasCheckedIn: true, checkInStatus: Hadir', () => {
      const absences: Absence[] = [
        {
          status: 'Datang',
          created_at: '2026-09-05T07:15:00.000Z',
          date: '2026-09-05',
          user_id: 'user-1',
        },
      ]
      const status = computeAttendanceStatus(absences)
      expect(status.hasCheckedIn).toBe(true)
      expect(status.hasCheckedOut).toBe(false)
      expect(status.today).toBe('present')
      expect(status.checkInStatus).toBe('Hadir')
    })

    it('evaluates Datang check-in followed by Pulang check-out correctly', () => {
      const absences: Absence[] = [
        {
          status: 'Datang',
          created_at: '2026-09-05T07:15:00.000Z',
          date: '2026-09-05',
          user_id: 'user-1',
        },
        {
          status: 'Pulang',
          created_at: '2026-09-05T15:30:00.000Z',
          date: '2026-09-05',
          user_id: 'user-1',
        },
      ]
      const status = computeAttendanceStatus(absences)
      expect(status.hasCheckedIn).toBe(true)
      expect(status.hasCheckedOut).toBe(true)
      expect(status.today).toBe('present')
      expect(status.checkInStatus).toBe('Hadir')
    })

    it('evaluates Alpha record as absent, hasCheckedIn: false', () => {
      const absences: Absence[] = [
        {
          status: 'Alpha',
          created_at: '2026-09-05T08:00:00.000Z',
          date: '2026-09-05',
          user_id: 'user-2',
        },
      ]
      const status = computeAttendanceStatus(absences)
      expect(status.hasCheckedIn).toBe(false)
      expect(status.hasCheckedOut).toBe(false)
      expect(status.today).toBe('absent')
      expect(status.checkInStatus).toBe(null)
    })

    it('evaluates empty absences as pending, hasCheckedIn: false', () => {
      const status = computeAttendanceStatus([])
      expect(status.hasCheckedIn).toBe(false)
      expect(status.hasCheckedOut).toBe(false)
      expect(status.today).toBe('pending')
      expect(status.checkInStatus).toBe(null)
    })
  })

  describe('3. getAttendanceCalendar with Legacy Datang', () => {
    it('correctly populates check_in_time and counts Datang in stats.hadir', async () => {
      const legacyDate = '2026-04-01'
      const legacyCreatedAt = '2026-04-01T07:05:00.000Z'

      const mockRawRecord: AttendanceRecord = {
        id: 'att-raw-datang',
        user_id: 'user-cal-2',
        date: legacyDate,
        status: toLegacyAttendanceStatus('Datang'),
        action_type: null,
        created_at: legacyCreatedAt,
      }

      const domainStore = new MemoryDomainStore()
      domainStore.attendancesList.push(mockRawRecord)

      // Seed student profile so requireApprovedStudent passes
      domainStore.profiles.set('user-cal-2', {
        user_id: 'user-cal-2',
        full_name: 'Student Cal',
        role: 'student',
        lifecycle_status: 'approved',
      })

      const providers: AppProviders = {
        domainStore,
        objectStorage: new MemoryObjectStorage(),
        identityProvider: new MemoryIdentityProvider(),
        robinClient: mockRobinClient,
      }

      const result = await getAttendanceCalendar({
        userId: 'user-cal-2',
        year: 2026,
        month: 4,
        providers,
      })

      expect(result.stats.hadir).toBe(1)
      expect(result.stats.terlambat).toBe(0)
      expect(result.stats.alpha).toBe(0)
      const dayItem = result.items.find((i) => i.date === legacyDate)
      expect(dayItem).toBeDefined()
      expect(dayItem?.status).toBe('present')
      expect(dayItem?.check_in_time).toBe(legacyCreatedAt)
    })
  })

  describe('4. MemoryDomainStore Attendance Action Validation & Queries', () => {
    it('validateAttendanceAction returns action_type: check_out after a Datang check-in', async () => {
      const store = new MemoryDomainStore()
      const now = new Date()
      const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000)
      const todayWIB = wib.toISOString().slice(0, 10)
      const dayKeyMap = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'] as const
      const dayKey = dayKeyMap[wib.getUTCDay()]

      // Seed an active location
      await store.createLocation({
        name: 'Kampus Utama',
        latitude: -6.2,
        longitude: 106.8,
        radiusMeters: 500,
        isActive: true,
      })

      // Seed schedule
      await store.createSchedule({
        dayOfWeek: dayKey,
        startTime: '06:00:00',
        endTime: '08:00:00',
        startCheckout: '14:00:00',
        endCheckout: '17:00:00',
        isActive: true,
      })

      // Seed legacy Datang record
      store.absences.push({
        status: 'Datang',
        created_at: `${todayWIB}T07:15:00.000Z`,
        date: todayWIB,
        user_id: 'user-mem-1',
      })

      const validation = await store.validateAttendanceAction({
        userId: 'user-mem-1',
        latitude: -6.2,
        longitude: 106.8,
      })

      expect(validation.actionable).toBe(true)
      expect(validation.action_type).toBe('check_out')
    })

    it('listAttendances with status=Hadir returns normalized Datang records', async () => {
      const store = new MemoryDomainStore()
      store.attendancesList.push({
        id: 'legacy-mem-1',
        user_id: 'u-1',
        date: '2026-09-01',
        status: toLegacyAttendanceStatus('Datang'),
        action_type: null,
        created_at: '2026-09-01T07:00:00.000Z',
      })
      store.attendancesList.push({
        id: 'canonical-hadir',
        user_id: 'u-2',
        date: '2026-09-01',
        status: 'Hadir',
        action_type: 'check_in',
        created_at: '2026-09-01T07:05:00.000Z',
      })
      store.attendancesList.push({
        id: 'canonical-terlambat',
        user_id: 'u-3',
        date: '2026-09-01',
        status: 'Terlambat',
        action_type: 'check_in',
        created_at: '2026-09-01T07:35:00.000Z',
      })

      const rows = await store.listAttendances({ status: 'Hadir' })
      expect(rows.length).toBe(2)
      const legacyRow = rows.find((r) => r.id === 'legacy-mem-1')
      expect(legacyRow).toBeDefined()
      expect(legacyRow?.status).toBe('Hadir')
      expect(legacyRow?.action_type).toBe('check_in')
    })

    it('listAttendances with actionType=check_in includes Datang records with null action_type', async () => {
      const store = new MemoryDomainStore()
      store.attendancesList.push({
        id: 'legacy-mem-action',
        user_id: 'u-1',
        date: '2026-09-01',
        status: toLegacyAttendanceStatus('Datang'),
        action_type: null,
        created_at: '2026-09-01T07:00:00.000Z',
      })
      store.attendancesList.push({
        id: 'canonical-pulang',
        user_id: 'u-1',
        date: '2026-09-01',
        status: 'Pulang',
        action_type: 'check_out',
        created_at: '2026-09-01T15:00:00.000Z',
      })

      const rows = await store.listAttendances({ actionType: 'check_in' })
      expect(rows.length).toBe(1)
      expect(rows[0].id).toBe('legacy-mem-action')
      expect(rows[0].status).toBe('Hadir')
      expect(rows[0].action_type).toBe('check_in')
    })

    it('getAttendance normalizes a legacy Datang record by id', async () => {
      const store = new MemoryDomainStore()
      store.attendancesList.push({
        id: 'get-legacy-1',
        user_id: 'u-get',
        date: '2026-09-01',
        status: toLegacyAttendanceStatus('Datang'),
        action_type: null,
        created_at: '2026-09-01T07:10:00.000Z',
      })

      const record = await store.getAttendance('get-legacy-1')
      expect(record).not.toBeNull()
      expect(record?.status).toBe('Hadir')
      expect(record?.action_type).toBe('check_in')
    })

    it('getTodayAbsences maps status Datang to Hadir', async () => {
      const store = new MemoryDomainStore()
      store.absences.push({
        status: 'Datang',
        created_at: '2026-09-05T07:10:00.000Z',
        date: '2026-09-05',
        user_id: 'u-today',
      })

      const absences = await store.getTodayAbsences('u-today', '2026-09-05')
      expect(absences.length).toBe(1)
      expect(absences[0].status).toBe('Hadir')
    })
  })

  describe('5. PostgresDomainStore Attendance Action Validation with Datang', () => {
    it('validateAttendanceAction returns action_type: check_out after a Datang check-in', async () => {
      const mockSql = createMockSql((strings: TemplateStringsArray) => {
        const query = strings.join('?')

        // 1. Location query
        if (query.includes('FROM locations')) {
          return [
            {
              id: 'loc-1',
              name: 'SMKN 2 Banjarmasin',
              latitude: -6.2,
              longitude: 106.8,
              radius_meters: 500,
              is_active: true,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ]
        }

        // 2. Attendances query
        if (query.includes('FROM attendances') && query.includes('status, action_type')) {
          return [
            {
              status: 'Datang',
              action_type: null,
            },
          ]
        }

        // 3. Schedules query
        if (query.includes('FROM schedules')) {
          return [
            {
              id: 'sch-1',
              hari: 'senin',
              mulai_masuk: '06:00:00',
              selesai_masuk: '08:00:00',
              mulai_pulang: '14:00:00',
              selesai_pulang: '17:00:00',
              kompensasi_waktu: 15,
              is_active: true,
            },
          ]
        }

        return []
      })

      const store = new PostgresDomainStore({ sql: mockSql })
      const validation = await store.validateAttendanceAction({
        userId: 'user-pg-1',
        latitude: -6.2,
        longitude: 106.8,
      })

      expect(validation.actionable).toBe(true)
      expect(validation.action_type).toBe('check_out')
    })
  })
})
