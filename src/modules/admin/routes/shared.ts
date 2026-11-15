import type { Context } from 'hono'
import type { z } from 'zod'
import { AppError } from '../../../lib/errors/app-error.js'
import { parseJsonRequest } from '../../../lib/http/request.js'
import { defaultProviders } from '../../../providers/index.js'
import type { AppProviders } from '../../../providers/types.js'
import type { AppEnv } from '../../../types/context.js'

export interface AdminRouterDeps {
  providers?: AppProviders
}

export function resolveAdminProviders(c: Context<AppEnv>, deps: AdminRouterDeps): AppProviders {
  return deps.providers ?? c.get('providers') ?? defaultProviders
}

export function requireRouteParam(c: Context<AppEnv>, name: string): string {
  const value = c.req.param(name)
  if (!value) {
    throw AppError.validationError(`Missing route parameter "${name}".`)
  }
  return value
}

export function parseJsonBody<T>(c: Context<AppEnv>, schema: z.ZodType<T>): Promise<T> {
  return parseJsonRequest(c, schema)
}

export async function parseJsonBodyOrEmpty<T>(
  c: Context<AppEnv>,
  schema: z.ZodType<T>,
): Promise<T> {
  const body = await c.req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw AppError.validationError(parsed.error.flatten())
  }
  return parsed.data
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  const dateObj = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(dateObj.getTime()) && dateObj.toISOString().slice(0, 10) === value
}

export function parseOptionalLimit(
  limitQuery: string | undefined,
  maxLimit = 100,
): number | undefined {
  if (limitQuery === undefined) return undefined
  const limit = Number(limitQuery)
  if (limitQuery.trim() === '' || !Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    throw AppError.validationError(`limit must be an integer between 1 and ${maxLimit}.`)
  }
  return limit
}

export function parseOptionalOffset(offsetQuery: string | undefined): number | undefined {
  if (offsetQuery === undefined) return undefined
  const offset = Number(offsetQuery)
  if (offsetQuery.trim() === '' || !Number.isInteger(offset) || offset < 0) {
    throw AppError.validationError('offset must be a non-negative integer.')
  }
  return offset
}
