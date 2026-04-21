import type { MiddlewareHandler } from 'hono'
import { AppError } from '../lib/errors/app-error.js'

export function requestTimeout(ms: number): MiddlewareHandler {
  return async (c, next) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ms)

    c.set('abortSignal', controller.signal)

    try {
      await next()
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw AppError.upstreamTimeout('request')
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }
}
