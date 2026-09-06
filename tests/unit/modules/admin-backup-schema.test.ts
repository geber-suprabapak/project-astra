import { describe, expect, it } from 'vitest'
import {
  backupLogDetailsSchema,
  backupStatusQuerySchema,
  createBackupSchema,
  getDaysInMonth,
  isValidDateInMonth,
  isValidRealYearMonth,
} from '../../../src/modules/admin/schema.js'

describe('admin backup schema validation', () => {
  const validPayload = {
    year_month: '2026-04',
    scope: 'absences' as const,
    format: 'xlsx' as const,
    start_date: '2026-04-01',
    end_date: '2026-04-30',
    checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    record_count: 150,
    byte_length: 4096,
    result: 'completed' as const,
  }

  describe('helper functions', () => {
    it('validates real YYYY-MM correctly', () => {
      expect(isValidRealYearMonth('2026-04')).toBe(true)
      expect(isValidRealYearMonth('2024-02')).toBe(true)
      expect(isValidRealYearMonth('1999-12')).toBe(true)
      expect(isValidRealYearMonth('2026-00')).toBe(false)
      expect(isValidRealYearMonth('2026-13')).toBe(false)
      expect(isValidRealYearMonth('2026-4')).toBe(false)
      expect(isValidRealYearMonth('abcd-04')).toBe(false)
      expect(isValidRealYearMonth('2026-04-01')).toBe(false)
    })

    it('computes days in month with leap year support', () => {
      expect(getDaysInMonth(2026, 4)).toBe(30)
      expect(getDaysInMonth(2026, 1)).toBe(31)
      expect(getDaysInMonth(2026, 2)).toBe(28)
      expect(getDaysInMonth(2024, 2)).toBe(29)
    })

    it('validates dates inside month with leap year support', () => {
      expect(isValidDateInMonth('2026-04-15', '2026-04')).toBe(true)
      expect(isValidDateInMonth('2026-04-30', '2026-04')).toBe(true)
      expect(isValidDateInMonth('2026-04-31', '2026-04')).toBe(false)
      expect(isValidDateInMonth('2026-05-01', '2026-04')).toBe(false)
      expect(isValidDateInMonth('2026-02-28', '2026-02')).toBe(true)
      expect(isValidDateInMonth('2026-02-29', '2026-02')).toBe(false)
      expect(isValidDateInMonth('2024-02-29', '2024-02')).toBe(true)
    })
  })

  describe('createBackupSchema', () => {
    it('accepts valid backup payload with sha256 checksum and completed result', () => {
      const parsed = createBackupSchema.safeParse(validPayload)
      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data.year_month).toBe('2026-04')
        expect(parsed.data.scope).toBe('absences')
        expect(parsed.data.format).toBe('xlsx')
        expect(parsed.data.start_date).toBe('2026-04-01')
        expect(parsed.data.end_date).toBe('2026-04-30')
        expect(parsed.data.checksum).toBe(validPayload.checksum)
        expect(parsed.data.record_count).toBe(150)
        expect(parsed.data.byte_length).toBe(4096)
        expect(parsed.data.result).toBe('completed')
      }
    })

    it('accepts valid backup payload with pdf format, failed result, and required checksum', () => {
      const parsed = createBackupSchema.safeParse({
        ...validPayload,
        format: 'pdf',
        result: 'failed',
      })
      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data.format).toBe('pdf')
        expect(parsed.data.result).toBe('failed')
        expect(parsed.data.checksum).toBe(validPayload.checksum)
      }
    })

    it('rejects backup payload when checksum is null or omitted', () => {
      // Null checksum
      expect(
        createBackupSchema.safeParse({
          ...validPayload,
          checksum: null,
        }).success,
      ).toBe(false)

      // Omitted checksum
      const { checksum: _removed, ...withoutChecksum } = validPayload
      expect(createBackupSchema.safeParse(withoutChecksum).success).toBe(false)
    })

    it('accepts zero record_count (nonnegative)', () => {
      const parsed = createBackupSchema.safeParse({
        ...validPayload,
        record_count: 0,
      })
      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data.record_count).toBe(0)
      }
    })

    it('rejects missing required canonical fields in createBackupSchema', () => {
      // Missing year_month
      const { year_month: _ym, ...withoutYm } = validPayload
      expect(createBackupSchema.safeParse(withoutYm).success).toBe(false)

      // Missing checksum
      const { checksum: _cs, ...withoutCs } = validPayload
      expect(createBackupSchema.safeParse(withoutCs).success).toBe(false)

      // Missing start_date
      const { start_date: _sd, ...withoutSd } = validPayload
      expect(createBackupSchema.safeParse(withoutSd).success).toBe(false)

      // Missing end_date
      const { end_date: _ed, ...withoutEd } = validPayload
      expect(createBackupSchema.safeParse(withoutEd).success).toBe(false)

      // Missing record_count
      const { record_count: _rc, ...withoutRc } = validPayload
      expect(createBackupSchema.safeParse(withoutRc).success).toBe(false)

      // Missing byte_length
      const { byte_length: _bl, ...withoutBl } = validPayload
      expect(createBackupSchema.safeParse(withoutBl).success).toBe(false)
    })

    it('rejects invalid year_month', () => {
      for (const invalidYm of ['2026-13', '2026-00', '2026-4', 'invalid', '']) {
        const parsed = createBackupSchema.safeParse({
          ...validPayload,
          year_month: invalidYm,
        })
        expect(parsed.success).toBe(false)
      }
    })

    it('rejects scope other than absences', () => {
      const parsed = createBackupSchema.safeParse({
        ...validPayload,
        scope: 'students',
      })
      expect(parsed.success).toBe(false)
    })

    it('rejects format other than xlsx or pdf', () => {
      const parsed = createBackupSchema.safeParse({
        ...validPayload,
        format: 'csv',
      })
      expect(parsed.success).toBe(false)
    })

    it('rejects start_date outside the month', () => {
      const parsed = createBackupSchema.safeParse({
        ...validPayload,
        start_date: '2026-03-31',
      })
      expect(parsed.success).toBe(false)
    })

    it('rejects end_date outside the month', () => {
      const parsed = createBackupSchema.safeParse({
        ...validPayload,
        end_date: '2026-05-01',
      })
      expect(parsed.success).toBe(false)
    })

    it('rejects non-existent date inside the month (April 31)', () => {
      const parsed = createBackupSchema.safeParse({
        ...validPayload,
        end_date: '2026-04-31',
      })
      expect(parsed.success).toBe(false)
    })

    it('rejects reversed date range (start_date > end_date)', () => {
      const parsed = createBackupSchema.safeParse({
        ...validPayload,
        start_date: '2026-04-20',
        end_date: '2026-04-10',
      })
      expect(parsed.success).toBe(false)
    })

    it('rejects checksum when not 64 lowercase hex characters', () => {
      // Uppercase characters
      const uppercaseChecksum = 'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855'
      expect(
        createBackupSchema.safeParse({ ...validPayload, checksum: uppercaseChecksum }).success,
      ).toBe(false)

      // Length != 64
      expect(createBackupSchema.safeParse({ ...validPayload, checksum: 'e3b0c442' }).success).toBe(
        false,
      )

      // Invalid hex characters
      expect(
        createBackupSchema.safeParse({
          ...validPayload,
          checksum: 'z3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        }).success,
      ).toBe(false)
    })

    it('rejects negative record_count', () => {
      const parsed = createBackupSchema.safeParse({
        ...validPayload,
        record_count: -1,
      })
      expect(parsed.success).toBe(false)
    })

    it('rejects non-integer record_count', () => {
      const parsed = createBackupSchema.safeParse({
        ...validPayload,
        record_count: 10.5,
      })
      expect(parsed.success).toBe(false)
    })

    it('rejects zero or negative byte_length', () => {
      expect(createBackupSchema.safeParse({ ...validPayload, byte_length: 0 }).success).toBe(false)
      expect(createBackupSchema.safeParse({ ...validPayload, byte_length: -100 }).success).toBe(
        false,
      )
    })

    it('rejects invalid result status', () => {
      for (const res of ['pending', 'in_progress', 'success', 'error']) {
        const parsed = createBackupSchema.safeParse({
          ...validPayload,
          result: res,
        })
        expect(parsed.success).toBe(false)
      }
    })
  })

  describe('backupStatusQuerySchema', () => {
    it('accepts valid query parameters with optional scope', () => {
      const parsed = backupStatusQuerySchema.safeParse({
        year_month: '2026-04',
        scope: 'absences',
      })
      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data.year_month).toBe('2026-04')
        expect(parsed.data.scope).toBe('absences')
      }
    })

    it('accepts valid query parameters when scope is omitted', () => {
      const parsed = backupStatusQuerySchema.safeParse({
        year_month: '2026-04',
      })
      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect(parsed.data.year_month).toBe('2026-04')
        expect(parsed.data.scope).toBeUndefined()
      }
    })

    it('rejects missing year_month in query', () => {
      const parsed = backupStatusQuerySchema.safeParse({})
      expect(parsed.success).toBe(false)
    })

    it('rejects invalid year_month in query', () => {
      const parsed = backupStatusQuerySchema.safeParse({
        year_month: '2026-13',
      })
      expect(parsed.success).toBe(false)
    })

    it('rejects invalid scope in query', () => {
      const parsed = backupStatusQuerySchema.safeParse({
        year_month: '2026-04',
        scope: 'students',
      })
      expect(parsed.success).toBe(false)
    })
  })

  describe('backupLogDetailsSchema (strict completion proof without defaults)', () => {
    const validLogDetails = {
      actor: 'admin-1',
      actor_id: 'admin-1',
      scope: 'absences',
      format: 'xlsx',
      start_date: '2026-04-01',
      end_date: '2026-04-30',
      range: { start_date: '2026-04-01', end_date: '2026-04-30' },
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      record_count: 100,
      byte_length: 2048,
      result: 'completed',
    }

    it('accepts strictly valid completed log details', () => {
      const parsed = backupLogDetailsSchema.safeParse(validLogDetails)
      expect(parsed.success).toBe(true)
    })

    it('rejects log details with missing checksum', () => {
      const { checksum: _cs, ...withoutCs } = validLogDetails
      expect(backupLogDetailsSchema.safeParse(withoutCs).success).toBe(false)
    })

    it('rejects log details with missing scope or format', () => {
      const { scope: _sc, ...withoutScope } = validLogDetails
      expect(backupLogDetailsSchema.safeParse(withoutScope).success).toBe(false)

      const { format: _fmt, ...withoutFormat } = validLogDetails
      expect(backupLogDetailsSchema.safeParse(withoutFormat).success).toBe(false)
    })

    it('rejects log details with missing start_date or end_date', () => {
      const { start_date: _sd, ...withoutSd } = validLogDetails
      expect(backupLogDetailsSchema.safeParse(withoutSd).success).toBe(false)

      const { end_date: _ed, ...withoutEd } = validLogDetails
      expect(backupLogDetailsSchema.safeParse(withoutEd).success).toBe(false)
    })

    it('rejects log details with non-completed result', () => {
      expect(
        backupLogDetailsSchema.safeParse({
          ...validLogDetails,
          result: 'failed',
        }).success,
      ).toBe(false)
    })

    it('rejects log details missing record_count and counts', () => {
      const { record_count: _rc, ...withoutRc } = validLogDetails
      expect(backupLogDetailsSchema.safeParse(withoutRc).success).toBe(false)
    })

    it('rejects log details missing byte_length and bytes', () => {
      const { byte_length: _bl, ...withoutBl } = validLogDetails
      expect(backupLogDetailsSchema.safeParse(withoutBl).success).toBe(false)
    })
  })
})
