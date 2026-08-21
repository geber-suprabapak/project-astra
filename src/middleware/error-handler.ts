import type { ErrorHandler } from 'hono'
import { AppError } from '../lib/errors/app-error.js'
import { errorResponse } from '../lib/http/responses.js'
import { logger } from '../lib/logging/logger.js'
import type { AppEnv } from '../types/context.js'

export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof AppError) {
    if (err.httpStatus >= 500) {
      logger.error({ err, requestId: c.get('requestId') }, 'Application error')
    } else {
      logger.warn({ err, requestId: c.get('requestId'), code: err.code }, 'Client error')
    }
    return errorResponse(c, err)
  }

  logger.error({ err, requestId: c.get('requestId') }, 'Unhandled error')

  const internal = AppError.internal('An unexpected error occurred.')
  return errorResponse(c, internal)
}
