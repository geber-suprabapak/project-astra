import type { MiddlewareHandler } from 'hono'
import { routePath } from 'hono/route'
import { logger } from '../lib/logging/logger.js'
import {
  decHttpInFlight,
  incHttpInFlight,
  recordHttpRequest,
} from '../lib/observability/metrics.js'
import { sanitizePathWithoutQuery, sanitizeRouteLabel } from '../lib/observability/pii.js'
import {
  SpanKind,
  SpanStatusCode,
  context,
  extractTraceContext,
  getTracer,
  trace,
} from '../lib/observability/tracing.js'
import type { AppEnv } from '../types/context.js'

const PROBE_PATHS = new Set(['/live', '/ready'])

interface RequestLogEntry {
  method: string
  route: string
  path: string
  status: number
  durationMs: number
  requestId: string
  traceId?: string
  spanId?: string
}

export const observabilityMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method
  const rawPath = c.req.path
  const requestId = c.get('requestId')
  const startHr = performance.now()
  const parentCtx = extractTraceContext((name) => c.req.header(name))
  const isProbe = PROBE_PATHS.has(rawPath)

  incHttpInFlight()

  const tracer = getTracer()
  const span = tracer.startSpan(
    `${method} ${sanitizePathWithoutQuery(rawPath)}`,
    {
      kind: SpanKind.SERVER,
      attributes: {
        'http.request.method': method,
        'request.id': requestId,
      },
    },
    parentCtx,
  )

  const spanCtx = trace.setSpan(parentCtx, span)

  try {
    await context.with(spanCtx, async () => {
      await next()
    })
  } finally {
    decHttpInFlight()
    const durationMs = Math.round(performance.now() - startHr)
    const durationSeconds = (performance.now() - startHr) / 1000
    const status = c.res.status
    const matchedRoute = sanitizeRouteLabel(routePath(c))
    const safePath = sanitizePathWithoutQuery(rawPath)

    span.updateName(`${method} ${matchedRoute}`)
    span.setAttribute('http.route', matchedRoute)
    span.setAttribute('http.response.status_code', status)
    if (status >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR })
    }

    const activeSpanContext = span.spanContext()
    const hasValidTrace =
      Boolean(activeSpanContext.traceId) &&
      activeSpanContext.traceId !== '00000000000000000000000000000000' &&
      Boolean(activeSpanContext.spanId) &&
      activeSpanContext.spanId !== '0000000000000000'

    span.end()

    recordHttpRequest(method, matchedRoute, status, durationSeconds)

    if (!isProbe || status >= 400) {
      const logPayload: RequestLogEntry = {
        method,
        route: matchedRoute,
        path: safePath,
        status,
        durationMs,
        requestId,
      }
      if (hasValidTrace) {
        logPayload.traceId = activeSpanContext.traceId
        logPayload.spanId = activeSpanContext.spanId
      }
      logger.info(logPayload, 'request')
    }
  }
}
