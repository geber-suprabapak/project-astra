import { describe, it, expect } from 'vitest'
import { AppError } from '../../../src/lib/errors/app-error.js'
import { ErrorCode } from '../../../src/lib/errors/codes.js'

describe('AppError', () => {
  it('authRequired returns 401 with AUTH_REQUIRED code', () => {
    const err = AppError.authRequired()
    expect(err.httpStatus).toBe(401)
    expect(err.code).toBe(ErrorCode.AUTH_REQUIRED)
  })

  it('authInvalid returns 401 with AUTH_INVALID code', () => {
    const err = AppError.authInvalid()
    expect(err.httpStatus).toBe(401)
    expect(err.code).toBe(ErrorCode.AUTH_INVALID)
  })

  it('validationError returns 422', () => {
    const err = AppError.validationError({ field: 'required' })
    expect(err.httpStatus).toBe(422)
    expect(err.details).toEqual({ field: 'required' })
  })

  it('attendanceBlocked returns 409', () => {
    const err = AppError.attendanceBlocked()
    expect(err.httpStatus).toBe(409)
    expect(err.code).toBe(ErrorCode.ATTENDANCE_BLOCKED)
  })

  it('dependencyUnavailable returns 503', () => {
    const err = AppError.dependencyUnavailable('Robin')
    expect(err.httpStatus).toBe(503)
  })

  it('upstreamTimeout returns 504', () => {
    const err = AppError.upstreamTimeout()
    expect(err.httpStatus).toBe(504)
  })

  it('internal returns 500', () => {
    const err = AppError.internal()
    expect(err.httpStatus).toBe(500)
    expect(err.code).toBe(ErrorCode.INTERNAL_ERROR)
  })
})
