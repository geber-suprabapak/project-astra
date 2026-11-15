import type { Context } from 'hono'
import type { z } from 'zod'
import { AppError } from '../errors/app-error.js'
import type { AppEnv } from '../../types/context.js'

/** Parse and schema-validate a JSON request body, converting malformed JSON into VALIDATION_ERROR. */
export async function parseJsonRequest<T extends z.ZodType>(
  c: Context<AppEnv>,
  schema: T,
): Promise<z.infer<T>> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw AppError.validationError('Invalid JSON request body.')
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw AppError.validationError(parsed.error.flatten())
  }
  return parsed.data
}

/** Parse a multipart/form-data request body, converting malformed payloads into VALIDATION_ERROR. */
export async function readFormDataRequest(c: Context<AppEnv>): Promise<FormData> {
  try {
    return await c.req.formData()
  } catch {
    throw AppError.validationError('Invalid multipart form-data request body.')
  }
}
