import { describe, expect, it } from 'vitest'
import { MemoryDomainStore } from '../../../src/providers/memory/index.js'
import type { AttendanceRecord } from '../../../src/providers/types.js'

function createAttendances(count: number, baseDate = '2026-09-04'): AttendanceRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `attendance-${index.toString().padStart(5, '0')}`,
    user_id: `student-${index % 10}`,
    date: baseDate,
    status: 'Hadir',
    action_type: 'check_in',
    latitude: null,
    longitude: null,
    created_at: new Date(Date.UTC(2026, 8, 4, 0, 0, index)).toISOString(),
  }))
}

describe('MemoryDomainStore attendance pagination and boundaries', () => {
  for (const count of [0, 99, 100, 101, 1_501]) {
    it(`returns complete stable pages for ${count} records`, async () => {
      const store = new MemoryDomainStore()
      store.attendancesList = createAttendances(count)
      const received: AttendanceRecord[] = []

      for (let offset = 0; ; offset += 100) {
        const page = await store.listAttendances({ limit: 100, offset })
        received.push(...page)
        if (page.length < 100) break
      }

      expect(received).toHaveLength(count)
      expect(new Set(received.map((record) => record.id)).size).toBe(count)
      expect(received).toEqual(
        [...received].sort(
          (left, right) =>
            right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id),
        ),
      )
    })
  }

  it('handles exact multiples of page limit correctly', async () => {
    const store = new MemoryDomainStore()
    const count = 200
    store.attendancesList = createAttendances(count)

    const page1 = await store.listAttendances({ limit: 100, offset: 0 })
    const page2 = await store.listAttendances({ limit: 100, offset: 100 })
    const page3 = await store.listAttendances({ limit: 100, offset: 200 })

    expect(page1).toHaveLength(100)
    expect(page2).toHaveLength(100)
    expect(page3).toHaveLength(0)

    const combined = [...page1, ...page2]
    expect(new Set(combined.map((r) => r.id)).size).toBe(200)
  })

  it('filters by date bounds with startDate and endDate inclusive', async () => {
    const store = new MemoryDomainStore()
    store.attendancesList = [
      ...createAttendances(5, '2026-09-01'),
      ...createAttendances(5, '2026-09-02'),
      ...createAttendances(5, '2026-09-03'),
      ...createAttendances(5, '2026-09-04'),
      ...createAttendances(5, '2026-09-05'),
    ]

    const rangeRecords = await store.listAttendances({
      startDate: '2026-09-02',
      endDate: '2026-09-04',
      limit: 100,
    })
    expect(rangeRecords).toHaveLength(15)
    expect(rangeRecords.every((r) => r.date >= '2026-09-02' && r.date <= '2026-09-04')).toBe(true)

    const singleDate = await store.listAttendances({
      date: '2026-09-03',
      limit: 100,
    })
    expect(singleDate).toHaveLength(5)
    expect(singleDate.every((r) => r.date === '2026-09-03')).toBe(true)
  })

  it('supports direct lookup by ID via getAttendance', async () => {
    const store = new MemoryDomainStore()
    const records = createAttendances(3)
    store.attendancesList = records

    const found = await store.getAttendance(records[1]!.id)
    expect(found).not.toBeNull()
    expect(found?.id).toBe(records[1]!.id)
    expect(found?.user_id).toBe(records[1]!.user_id)

    const missing = await store.getAttendance('non-existent-id')
    expect(missing).toBeNull()
  })
})
