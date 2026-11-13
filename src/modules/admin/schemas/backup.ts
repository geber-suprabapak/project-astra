import { z } from 'zod'

export function isValidRealYearMonth(ym: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return false
  const [yearStr, monthStr] = ym.split('-')
  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10)
  return year >= 1000 && year <= 9999 && month >= 1 && month <= 12
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function isValidDateInMonth(dateStr: string, ym: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false
  if (!dateStr.startsWith(`${ym}-`)) return false
  const [yearStr, monthStr, dayStr] = dateStr.split('-')
  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10)
  const day = parseInt(dayStr, 10)
  const daysInMonth = getDaysInMonth(year, month)
  return day >= 1 && day <= daysInMonth
}

export const createBackupSchema = z
  .object({
    year_month: z.string().min(1, 'year_month is required (format: YYYY-MM).'),
    scope: z.enum(['absences']),
    format: z.enum(['xlsx', 'pdf']),
    start_date: z.string().min(1, 'start_date is required (format: YYYY-MM-DD).'),
    end_date: z.string().min(1, 'end_date is required (format: YYYY-MM-DD).'),
    checksum: z
      .string({ error: (iss) => (iss.input === undefined ? 'checksum is required.' : undefined) })
      .regex(/^[a-f0-9]{64}$/, 'checksum must be a 64-character lowercase hex SHA-256 hash.'),
    record_count: z
      .number()
      .int('record_count must be an integer.')
      .nonnegative('record_count must be a non-negative integer.'),
    byte_length: z
      .number()
      .int('byte_length must be an integer.')
      .positive('byte_length must be a positive integer.'),
    result: z.enum(['completed', 'failed']),
  })
  .superRefine((data, ctx) => {
    if (!isValidRealYearMonth(data.year_month)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid real YYYY-MM.',
        path: ['year_month'],
      })
      return
    }

    if (!isValidDateInMonth(data.start_date, data.year_month)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'start_date must be a valid date inside the specified month.',
        path: ['start_date'],
      })
    }

    if (!isValidDateInMonth(data.end_date, data.year_month)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'end_date must be a valid date inside the specified month.',
        path: ['end_date'],
      })
    }

    if (
      isValidDateInMonth(data.start_date, data.year_month) &&
      isValidDateInMonth(data.end_date, data.year_month) &&
      data.start_date > data.end_date
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'start_date must be less than or equal to end_date.',
        path: ['start_date'],
      })
    }
  })

export type CreateBackupInput = z.infer<typeof createBackupSchema>

export const backupStatusQuerySchema = z
  .object({
    year_month: z.string().min(1, 'year_month is required (format: YYYY-MM).'),
    scope: z.enum(['absences']).optional(),
  })
  .superRefine((data, ctx) => {
    if (!isValidRealYearMonth(data.year_month)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid real YYYY-MM.',
        path: ['year_month'],
      })
    }
  })

export type BackupStatusQuery = z.infer<typeof backupStatusQuerySchema>

export interface BackupStatusRecord {
  id: string
  year_month: string
  scope: 'absences'
  format: 'xlsx' | 'pdf'
  start_date: string
  end_date: string
  range: {
    start_date: string
    end_date: string
  }
  checksum: string
  record_count: number
  counts?: number
  byte_length: number
  bytes?: number
  result: 'completed'
  actor_id: string | null
  actor?: string | null
  created_at: string
}

export interface BackupStatusResponse {
  completed: boolean
  record: BackupStatusRecord | null
}

export const backupLogDetailsSchema = z
  .object({
    actor: z.string().nullable().optional(),
    actor_id: z.string().nullable().optional(),
    scope: z.literal('absences'),
    format: z.enum(['xlsx', 'pdf']),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'start_date must be YYYY-MM-DD.'),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'end_date must be YYYY-MM-DD.'),
    range: z
      .object({
        start_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        end_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .optional(),
    checksum: z
      .string({ error: (iss) => (iss.input === undefined ? 'checksum is required.' : undefined) })
      .regex(/^[a-f0-9]{64}$/, 'checksum must be a 64-character lowercase hex SHA-256 hash.'),
    counts: z.number().int().nonnegative().optional(),
    record_count: z.number().int().nonnegative().optional(),
    bytes: z.number().int().positive().optional(),
    byte_length: z.number().int().positive().optional(),
    result: z.literal('completed'),
    year_month: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const recordCount = data.record_count ?? data.counts
    if (recordCount === undefined || !Number.isInteger(recordCount) || recordCount < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'record_count or counts must be a non-negative integer.',
        path: ['record_count'],
      })
    }

    const byteLength = data.byte_length ?? data.bytes
    if (byteLength === undefined || !Number.isInteger(byteLength) || byteLength <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'byte_length or bytes must be a positive integer.',
        path: ['byte_length'],
      })
    }
  })

export type BackupLogDetails = z.infer<typeof backupLogDetailsSchema>
