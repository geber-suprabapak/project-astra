import { describe, expect, it } from 'vitest'
import { createAdminLeaveRequestSchema } from '../../src/modules/admin/schema.js'

describe('Scope 1 Challenger: POST /v1/admin/leave-requests Schema Matrix', () => {
  describe('1. Schema Category Validation Matrix', () => {
    const validCategories = ['sakit', 'pergi', 'dispensasi', 'lainnya']
    for (const cat of validCategories) {
      it(`accepts valid category '${cat}'`, () => {
        const parsed = createAdminLeaveRequestSchema.safeParse({
          user_id: 'student-1',
          category: cat,
          description: `Valid description for ${cat}`,
          date: '2026-08-28',
        })
        expect(parsed.success).toBe(true)
      })
    }

    const invalidCategories = [
      'izin',
      'cuti',
      'bolos',
      'alpha',
      'SAKIT',
      'sakit ',
      ' sakit',
      'sakit\n',
      '123',
      '',
      null,
      undefined,
      true,
      {},
      [],
      'dispensasi_khusus',
      'LAINNYA',
    ]
    for (const cat of invalidCategories) {
      it(`rejects invalid category '${String(cat)}'`, () => {
        const parsed = createAdminLeaveRequestSchema.safeParse({
          user_id: 'student-1',
          category: cat,
          description: 'Test description',
          date: '2026-08-28',
        })
        expect(parsed.success).toBe(false)
      })
    }
  })

  describe('2. Schema Date Format Validation Matrix', () => {
    const validDates = ['2026-08-28', '2024-02-29', '2026-12-31', '2025-01-01']
    for (const d of validDates) {
      it(`accepts valid YYYY-MM-DD date '${d}'`, () => {
        const parsed = createAdminLeaveRequestSchema.safeParse({
          user_id: 'student-1',
          category: 'sakit',
          description: 'Valid date test',
          date: d,
        })
        expect(parsed.success).toBe(true)
      })
    }

    const invalidDates = [
      '28-08-2026',
      '2026/08/28',
      '2026.08.28',
      '28/08/2026',
      '2026-8-28',
      '2026-08-8',
      '2026-08-28T00:00:00Z',
      '2026-08-28 00:00:00',
      'yesterday',
      'today',
      '2026-08-28 ',
      '',
      null,
      undefined,
      123456789,
      {},
      [],
    ]
    for (const d of invalidDates) {
      it(`rejects invalid date format '${String(d)}'`, () => {
        const parsed = createAdminLeaveRequestSchema.safeParse({
          user_id: 'student-1',
          category: 'sakit',
          description: 'Invalid date test',
          date: d,
        })
        expect(parsed.success).toBe(false)
      })
    }
  })

  describe('3. Required & Boundary Fields', () => {
    it('rejects when both user_id and userId are missing', () => {
      const parsed = createAdminLeaveRequestSchema.safeParse({
        category: 'sakit',
        description: 'desc',
        date: '2026-08-28',
      })
      expect(parsed.success).toBe(false)
    })

    it('accepts userId in camelCase', () => {
      const parsed = createAdminLeaveRequestSchema.safeParse({
        userId: 'student-1',
        category: 'sakit',
        description: 'desc',
        date: '2026-08-28',
      })
      expect(parsed.success).toBe(true)
    })

    it('accepts user_id in snake_case', () => {
      const parsed = createAdminLeaveRequestSchema.safeParse({
        user_id: 'student-1',
        category: 'sakit',
        description: 'desc',
        date: '2026-08-28',
      })
      expect(parsed.success).toBe(true)
    })

    it('rejects empty description', () => {
      const parsed = createAdminLeaveRequestSchema.safeParse({
        user_id: 'student-1',
        category: 'sakit',
        description: '',
        date: '2026-08-28',
      })
      expect(parsed.success).toBe(false)
    })

    it('accepts description length 1 and length 1000', () => {
      expect(
        createAdminLeaveRequestSchema.safeParse({
          user_id: 'student-1',
          category: 'sakit',
          description: 'a',
          date: '2026-08-28',
        }).success,
      ).toBe(true)

      expect(
        createAdminLeaveRequestSchema.safeParse({
          user_id: 'student-1',
          category: 'sakit',
          description: 'a'.repeat(1000),
          date: '2026-08-28',
        }).success,
      ).toBe(true)
    })

    it('rejects description length 1001', () => {
      expect(
        createAdminLeaveRequestSchema.safeParse({
          user_id: 'student-1',
          category: 'sakit',
          description: 'a'.repeat(1001),
          date: '2026-08-28',
        }).success,
      ).toBe(false)
    })

    const validUUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
    it('validates file_id UUID correctness', () => {
      expect(
        createAdminLeaveRequestSchema.safeParse({
          user_id: 'student-1',
          category: 'sakit',
          description: 'desc',
          date: '2026-08-28',
          file_id: validUUID,
        }).success,
      ).toBe(true)

      expect(
        createAdminLeaveRequestSchema.safeParse({
          user_id: 'student-1',
          category: 'sakit',
          description: 'desc',
          date: '2026-08-28',
          fileId: validUUID,
        }).success,
      ).toBe(true)

      expect(
        createAdminLeaveRequestSchema.safeParse({
          user_id: 'student-1',
          category: 'sakit',
          description: 'desc',
          date: '2026-08-28',
          file_id: null,
        }).success,
      ).toBe(true)

      expect(
        createAdminLeaveRequestSchema.safeParse({
          user_id: 'student-1',
          category: 'sakit',
          description: 'desc',
          date: '2026-08-28',
          file_id: 'not-a-valid-uuid',
        }).success,
      ).toBe(false)
    })

    it('validates approval_status values', () => {
      for (const st of ['pending', 'approved', 'rejected']) {
        expect(
          createAdminLeaveRequestSchema.safeParse({
            user_id: 'student-1',
            category: 'sakit',
            description: 'desc',
            date: '2026-08-28',
            approval_status: st,
          }).success,
        ).toBe(true)
      }

      expect(
        createAdminLeaveRequestSchema.safeParse({
          user_id: 'student-1',
          category: 'sakit',
          description: 'desc',
          date: '2026-08-28',
          approval_status: 'cancelled',
        }).success,
      ).toBe(false)
    })
  })
})
