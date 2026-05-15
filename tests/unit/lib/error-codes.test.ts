import { describe, it, expect } from 'vitest'
import { ErrorCode } from '../../../src/lib/errors/codes.js'

describe('ErrorCode', () => {
  it('contains all 13 required error codes from plan.md §6.3', () => {
    const requiredCodes = [
      'AUTH_REQUIRED',
      'AUTH_INVALID',
      'FORBIDDEN',
      'VALIDATION_ERROR',
      'TENANT_MISMATCH',
      'ATTENDANCE_BLOCKED',
      'ENROLLMENT_REQUIRED',
      'DEPENDENCY_UNAVAILABLE',
      'UPSTREAM_TIMEOUT',
      'STORAGE_UPLOAD_FAILED',
      'RESOURCE_NOT_FOUND',
      'CONFLICT',
      'INTERNAL_ERROR',
    ]

    for (const code of requiredCodes) {
      expect(ErrorCode).toHaveProperty(code)
      expect(ErrorCode[code as keyof typeof ErrorCode]).toBe(code)
    }
  })
})