import type { Context } from 'hono'
import type { AppError } from '../errors/app-error.js'
import type { AppEnv } from '../../types/context.js'

type AppErrorHttpStatus = 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503 | 504

function getMeta(c: Context<AppEnv>) {
  return {
    request_id: c.get('requestId') ?? 'unknown',
    timestamp: new Date().toISOString(),
  }
}

export function successResponse(
  c: Context<AppEnv>,
  data: unknown,
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
  return c.json(
    {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
      meta: getMeta(c),
    },
    error.httpStatus as AppErrorHttpStatus,
  )
}
