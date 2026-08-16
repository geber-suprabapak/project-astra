import { describe, it, expect } from 'vitest'
import { AppError } from '../../../src/lib/errors/app-error.js'
import { ErrorCode } from '../../../src/lib/errors/codes.js'

describe('AppError extended factories', () => {
  it('tenantMismatch returns 403 with TENANT_MISMATCH code', () => {
    const err = AppError.tenantMismatch()
    expect(err.httpStatus).toBe(403)
    expect(err.code).toBe(ErrorCode.TENANT_MISMATCH)
    expect(err.message).toBe('Tenant mismatch.')
  })

  it('notFound returns 404 with RESOURCE_NOT_FOUND code', () => {
    const err = AppError.notFound('User')
    expect(err.httpStatus).toBe(404)
    expect(err.code).toBe(ErrorCode.RESOURCE_NOT_FOUND)
    expect(err.message).toBe('User not found.')
  })

  it('storageUploadFailed returns 502', () => {
    const err = AppError.storageUploadFailed('disk full')
    expect(err.httpStatus).toBe(502)
    expect(err.code).toBe(ErrorCode.STORAGE_UPLOAD_FAILED)
    expect(err.details).toBe('disk full')
  })

  it('forbidden returns 403 with FORBIDDEN code', () => {
    const err = AppError.forbidden()
    expect(err.httpStatus).toBe(403)
    expect(err.code).toBe(ErrorCode.FORBIDDEN)
  })

  it('enrollmentRequired returns 409', () => {
    const err = AppError.enrollmentRequired()
    expect(err.httpStatus).toBe(409)
    expect(err.code).toBe(ErrorCode.ENROLLMENT_REQUIRED)
  })
})
