import { ErrorCode } from './codes.js'

export interface ErrorDetailMap {
  formErrors?: readonly string[]
  fieldErrors?: Readonly<Record<string, readonly string[] | undefined>>
  [key: string]:
    | string
    | number
    | boolean
    | null
    | undefined
    | readonly string[]
    | Readonly<Record<string, readonly string[] | undefined>>
}

export type AppErrorDetails = ErrorDetailMap | string | number | boolean | null | undefined

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly httpStatus: number,
    message: string,
    public readonly details?: AppErrorDetails,
  ) {
    super(message)
    this.name = 'AppError'
  }

  static authRequired(): AppError {
    return new AppError(ErrorCode.AUTH_REQUIRED, 401, 'Authentication required.')
  }

  static authInvalid(message = 'Invalid or expired token.'): AppError {
    return new AppError(ErrorCode.AUTH_INVALID, 401, message)
  }

  static forbidden(): AppError {
    return new AppError(ErrorCode.FORBIDDEN, 403, 'Access denied.')
  }

  static validationError(details?: AppErrorDetails): AppError {
    return new AppError(ErrorCode.VALIDATION_ERROR, 422, 'Validation failed.', details)
  }

  static attendanceBlocked(reason = 'Attendance action is not allowed at this time.'): AppError {
    return new AppError(ErrorCode.ATTENDANCE_BLOCKED, 409, reason)
  }

  static enrollmentRequired(): AppError {
    return new AppError(ErrorCode.ENROLLMENT_REQUIRED, 409, 'Face enrollment is required.')
  }

  static dependencyUnavailable(service = 'upstream'): AppError {
    return new AppError(
      ErrorCode.DEPENDENCY_UNAVAILABLE,
      503,
      `Service dependency unavailable: ${service}.`,
    )
  }

  static upstreamTimeout(service = 'upstream'): AppError {
    return new AppError(ErrorCode.UPSTREAM_TIMEOUT, 504, `Request to ${service} timed out.`)
  }

  static storageUploadFailed(details?: AppErrorDetails): AppError {
    return new AppError(ErrorCode.STORAGE_UPLOAD_FAILED, 502, 'File upload failed.', details)
  }

  static notFound(resource = 'Resource'): AppError {
    return new AppError(ErrorCode.RESOURCE_NOT_FOUND, 404, `${resource} not found.`)
  }

  static conflict(message = 'Conflict with existing resource.'): AppError {
    return new AppError(ErrorCode.CONFLICT, 409, message)
  }

  static tenantMismatch(): AppError {
    return new AppError(ErrorCode.TENANT_MISMATCH, 403, 'Tenant mismatch.')
  }

  static internal(message = 'An unexpected error occurred.'): AppError {
    return new AppError(ErrorCode.INTERNAL_ERROR, 500, message)
  }
}
