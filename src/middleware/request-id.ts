import type { MiddlewareHandler } from 'hono'
import { randomUUID } from 'node:crypto'
import type { AppEnv } from '../types/context.js'

export const requestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  const id = randomUUID()
  c.set('requestId', id)
  c.header('X-Request-ID', id)
  await next()
}
