import type { Context } from 'hono'
import type { AppError, AppErrorDetails } from '../errors/app-error.js'
import type { AppEnv } from '../../types/context.js'

type AppErrorHttpStatus = 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503 | 504

interface ErrorResponseBody {
  code: string
  message: string
  details?: AppErrorDetails
}

function getMeta(c: Context<AppEnv>) {
  return {
    request_id: c.get('requestId') ?? 'unknown',
    timestamp: new Date().toISOString(),
  }
}

export function successResponse<T>(
  c: Context<AppEnv>,
  data: T,
  message: string,
  status: 200 | 201 = 200,
) {
  return c.json(
    {
      success: true,
      message,
      data,
      meta: getMeta(c),
    },
    status,
  )
}

export function errorResponse(c: Context<AppEnv>, error: AppError) {
  const errorObj: ErrorResponseBody = {
    code: error.code,
    message: error.message,
  }
  if (error.details !== undefined) {
    errorObj.details = error.details
  }

  // SAFETY: AppError.httpStatus is restricted to valid HTTP error status codes matching AppErrorHttpStatus
  const status = error.httpStatus as AppErrorHttpStatus

  return c.json(
    {
      success: false,
      error: errorObj,
      meta: getMeta(c),
    },
    status,
  )
}
