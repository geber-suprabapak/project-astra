import type { MiddlewareHandler } from 'hono'
import { randomUUID } from 'node:crypto'
import type { AppEnv } from '../types/context.js'

const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export const requestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  const incoming = c.req.header('X-Request-ID')?.trim()
  const id = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID()
  c.set('requestId', id)
  c.header('X-Request-ID', id)
  await next()
}
