import type { Context } from 'hono'
import type { AppError, AppErrorDetails } from '../errors/app-error.js'
import type { AppEnv } from '../../types/context.js'

export type AppErrorHttpStatus =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 422
  | 426
  | 429
  | 500
  | 502
  | 503
  | 504

interface ErrorResponseBody {
  code: string
  message: string
  details?: AppErrorDetails
}

export interface ErrorResponseInput {
  code: string
  message: string
  details?: AppErrorDetails
  httpStatus?: AppErrorHttpStatus
}

export interface SuccessResponseMeta {
  pagination?: {
    limit: number
    offset: number
    has_more: boolean
  }
}

function getMeta(c: Context<AppEnv>, additional?: SuccessResponseMeta) {
  return {
    ...additional,
    request_id: c.get('requestId') ?? 'unknown',
    timestamp: new Date().toISOString(),
  }
}

export function successResponse<T>(
  c: Context<AppEnv>,
  data: T,
  message: string,
  status: 200 | 201 = 200,
  meta?: SuccessResponseMeta,
) {
  return c.json(
    {
      success: true,
      message,
      data,
      meta: getMeta(c, meta),
    },
    status,
  )
}

export function errorResponse(
  c: Context<AppEnv>,
  error: ErrorResponseInput | AppError,
  statusCode?: AppErrorHttpStatus,
) {
  const errorObj: ErrorResponseBody = {
    code: error.code,
    message: error.message,
  }
  if (error.details !== undefined) {
    errorObj.details = error.details
  }

  // SAFETY: Status codes are restricted to valid HTTP error status codes matching AppErrorHttpStatus
  const status = (statusCode ?? error.httpStatus ?? 500) as AppErrorHttpStatus

  return c.json(
    {
      success: false,
      error: errorObj,
      meta: getMeta(c),
    },
    status,
  )
}
