import type { MiddlewareHandler } from 'hono'
import { AppError } from '../lib/errors/app-error.js'

export function requestTimeout(ms: number): MiddlewareHandler {
  return async (c, next) => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(AppError.upstreamTimeout('request'))
      }, ms)
    })

    c.set('abortSignal', controller.signal)

    const handler = next()
    try {
      await Promise.race([handler, deadline])
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw AppError.upstreamTimeout('request')
      }
      throw err
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      handler.catch(() => {})
    }
  }
}
