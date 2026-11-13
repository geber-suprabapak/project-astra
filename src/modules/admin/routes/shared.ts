import type { Context } from 'hono'
import type { z } from 'zod'
import { AppError } from '../../../lib/errors/app-error.js'
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

export async function parseJsonBody<T>(c: Context<AppEnv>, schema: z.ZodType<T>): Promise<T> {
  const body = await c.req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw AppError.validationError(parsed.error.flatten())
  }
  return parsed.data
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
