import { describe, it, expect } from 'vitest'
import { CreatePermitSchema } from '../../../src/modules/permits/schema.js'
import {
  AttendanceHistoryQuerySchema,
  PrecheckBodySchema,
  SubmitBodySchema,
} from '../../../src/modules/attendance/schema.js'
import { createAdminLeaveRequestSchema } from '../../../src/modules/admin/schema.js'
import { base64ByteSize } from '../../../src/modules/attendance/mapper.js'

describe('Attendance PrecheckBodySchema', () => {
  it('accepts valid latitude and longitude', () => {
    const result = PrecheckBodySchema.safeParse({ latitude: -7.123, longitude: 112.456 })
    expect(result.success).toBe(true)
  })

  it('rejects missing latitude', () => {
    const result = PrecheckBodySchema.safeParse({ longitude: 112.456 })
    expect(result.success).toBe(false)
  })

  it('rejects missing longitude', () => {
    const result = PrecheckBodySchema.safeParse({ latitude: -7.123 })
    expect(result.success).toBe(false)
  })

  it('rejects non-numeric latitude', () => {
    const result = PrecheckBodySchema.safeParse({ latitude: 'abc', longitude: 112.456 })
    expect(result.success).toBe(false)
  })
})

describe('Attendance SubmitBodySchema', () => {
  it('accepts valid submit payload', () => {
    const result = SubmitBodySchema.safeParse({
      action_type: 'check_in',
      image_base64: 'aGk=',
      latitude: -7.123,
      longitude: 112.456,
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid action_type', () => {
    const result = SubmitBodySchema.safeParse({
      action_type: 'invalid',
      image_base64: 'aGk=',
      latitude: -7.123,
      longitude: 112.456,
    })
    expect(result.success).toBe(false)
  })

  it('rejects image_base64 exceeding 5MB', () => {
    // Create a base64 string that decodes to > 5MB
    // 5MB = 5 * 1024 * 1024 = 5242880 bytes
    // base64 overhead ~4/3, so we need a string > 5242880 * 4/3 ≈ 6990507 chars
    // Using a much larger string to be safe
    const hugeB64 = 'A'.repeat(7_000_000)
    const size = base64ByteSize(hugeB64)
    expect(size).toBeGreaterThan(5 * 1024 * 1024)

    const result = SubmitBodySchema.safeParse({
      action_type: 'check_in',
      image_base64: hugeB64,
      latitude: -7.123,
      longitude: 112.456,
    })
    expect(result.success).toBe(false)
  })
})

describe('CreatePermitSchema', () => {
  it('accepts valid permit with sakit category', () => {
    const result = CreatePermitSchema.safeParse({
      category: 'sakit',
      description: 'Saya sakit demam dan perlu istirahat',
      date: '2026-04-21',
    })
    expect(result.success).toBe(true)
  })

  it('accepts valid permit with pergi category', () => {
    const result = CreatePermitSchema.safeParse({
      category: 'pergi',
      description: 'Keperluan keluarga mendadak hari ini',
      date: '2026-04-21',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid category', () => {
    const result = CreatePermitSchema.safeParse({
      category: 'libur',
      description: 'Libur panjang edisi spesial',
      date: '2026-04-21',
    })
    expect(result.success).toBe(false)
  })

  it('rejects description shorter than 10 characters', () => {
    const result = CreatePermitSchema.safeParse({
      category: 'sakit',
      description: 'halo',
      date: '2026-04-21',
    })
    expect(result.success).toBe(false)
  })

  it('rejects description longer than 500 characters', () => {
    const result = CreatePermitSchema.safeParse({
      category: 'sakit',
      description: 'x'.repeat(501),
      date: '2026-04-21',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid date format', () => {
    const result = CreatePermitSchema.safeParse({
      category: 'sakit',
      description: 'Saya sakit demam tinggi hari ini',
      date: '21-04-2026',
    })
    expect(result.success).toBe(false)
  })
})

describe('AttendanceHistoryQuerySchema normalization', () => {
  it('parses camelCase query parameters', () => {
    const result = AttendanceHistoryQuerySchema.safeParse({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.startDate).toBe('2026-08-01')
      expect(result.data.endDate).toBe('2026-08-31')
    }
  })

  it('parses snake_case query parameters and normalizes them', () => {
    const result = AttendanceHistoryQuerySchema.safeParse({
      start_date: '2026-08-01',
      end_date: '2026-08-31',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.startDate).toBe('2026-08-01')
      expect(result.data.endDate).toBe('2026-08-31')
    }
  })
})

describe('createAdminLeaveRequestSchema', () => {
  it('accepts valid admin leave request input', () => {
    const result = createAdminLeaveRequestSchema.safeParse({
      user_id: 'student-1',
      category: 'sakit',
      description: 'Sakit flu',
      date: '2026-08-28',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.approval_status).toBe('approved')
    }
  })

  it('accepts camelCase userId and explicit approvalStatus', () => {
    const result = createAdminLeaveRequestSchema.safeParse({
      userId: 'student-1',
      category: 'dispensasi',
      description: 'Lomba karya ilmiah',
      date: '2026-08-28',
      approvalStatus: 'pending',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing user_id', () => {
    const result = createAdminLeaveRequestSchema.safeParse({
      category: 'sakit',
      description: 'Sakit flu',
      date: '2026-08-28',
    })
    expect(result.success).toBe(false)
  })
})
