import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createApp } from '../../../src/app.js'
import { createLogger } from '../../../src/lib/logging/logger.js'
import { createMetricsApp, recordHttpRequest } from '../../../src/lib/observability/metrics.js'
import {
  filterSafeSpanAttributes,
  sanitizeLogString,
  sanitizeRouteLabel,
} from '../../../src/lib/observability/pii.js'
import {
  context,
  extractTraceContext,
  injectTraceHeaders,
  isTracingEnabled,
} from '../../../src/lib/observability/tracing.js'

describe('Astra observability', () => {
  it('exposes valid Prometheus metrics on the internal metrics app and keeps public app /metrics 404', async () => {
    recordHttpRequest('GET', '/v1/mobile/dashboard', 200, 0.042)

    const metricsApp = createMetricsApp()
    const metricsRes = await metricsApp.request('/metrics')
    expect(metricsRes.status).toBe(200)
    expect(metricsRes.headers.get('content-type')).toContain('text/plain')

    const body = await metricsRes.text()
    expect(body).toContain('# HELP astra_http_requests_total')
    expect(body).toContain('# TYPE astra_http_requests_total counter')
    expect(body).toContain('astra_http_requests_total{')
    expect(body).toContain('route="/v1/mobile/dashboard"')
    expect(body).toContain('# TYPE astra_http_request_duration_seconds histogram')
    expect(body).toContain('# TYPE astra_http_requests_in_flight gauge')

    const publicApp = createApp()
    const publicMetricsRes = await publicApp.request('/metrics')
    expect(publicMetricsRes.status).toBe(404)
  })

  it('redacts PII and secrets in structured Pino logs, span attributes, and metric route labels', () => {
    const lines: string[] = []
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk))
        callback()
      },
    })

    const testLogger = createLogger(sink)
    testLogger.info(
      {
        authorization: 'Bearer secret-jwt-token',
        cookie: 'session=abc123',
        password: 'super-secret-password',
        email: 'siswa@skanida.sch.id',
        nik: '3374012345678901',
        nisn: '0012345678',
        image_base64: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
        embedding: [0.1, 0.2, 0.3],
        resetCode: '654321',
        nested: {
          token: 'nested-secret',
          phoneNumber: '+628123456789',
          studentName: 'Budi Santoso',
        },
        safeField: 'ok',
      },
      'pii-check',
    )

    expect(lines.length).toBe(1)
    const rawLine = lines[0] ?? ''
    expect(rawLine).not.toContain('secret-jwt-token')
    expect(rawLine).not.toContain('session=abc123')
    expect(rawLine).not.toContain('super-secret-password')
    expect(rawLine).not.toContain('siswa@skanida.sch.id')
    expect(rawLine).not.toContain('3374012345678901')
    expect(rawLine).not.toContain('0012345678')
    expect(rawLine).not.toContain('/9j/4AAQSkZJRg==')
    expect(rawLine).not.toContain('654321')
    expect(rawLine).not.toContain('nested-secret')
    expect(rawLine).not.toContain('+628123456789')
    expect(rawLine).not.toContain('Budi Santoso')
    expect(rawLine).toContain('[REDACTED]')
    expect(rawLine).toContain('"safeField":"ok"')

    const safeAttrs = filterSafeSpanAttributes({
      authorization: 'Bearer abc',
      email: 'user@example.com',
      'http.route': '/v1/mobile/profile',
      note: 'Bearer tok_123 for siswa@skanida.sch.id',
    })
    expect(safeAttrs).toEqual({
      'http.route': '/v1/mobile/profile',
      note: 'Bearer [REDACTED] for [REDACTED_EMAIL]',
    })

    expect(
      sanitizeRouteLabel('/v1/admin/students/550e8400-e29b-41d4-a716-446655440000?token=secret'),
    ).toBe('/v1/admin/students/:id')
    expect(sanitizeLogString('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk')).toBe(
      '[REDACTED_JWT]',
    )
  })

  it('preserves request-id and W3C trace context without breaking routes when OTel export is disabled', async () => {
    expect(isTracingEnabled()).toBe(false)

    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
    const parentSpanId = '00f067aa0ba902b7'
    const traceparent = `00-${traceId}-${parentSpanId}-01`

    const app = createApp()
    const res = await app.request('/live', {
      headers: {
        'X-Request-ID': 'req-obs-test-123',
        traceparent,
      },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Request-ID')).toBe('req-obs-test-123')

    const extractedCtx = extractTraceContext((name) =>
      name.toLowerCase() === 'traceparent' ? traceparent : undefined,
    )
    const outboundHeaders: Record<string, string> = {}
    const logLines: string[] = []
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        logLines.push(String(chunk))
        callback()
      },
    })
    const traceLogger = createLogger(sink)

    context.with(extractedCtx, () => {
      injectTraceHeaders(outboundHeaders)
      traceLogger.info({ event: 'trace-correlation-check' }, 'correlated')
    })

    expect(outboundHeaders['traceparent']).toBe(traceparent)
    const parsedLog = z
      .object({ traceId: z.string().optional(), spanId: z.string().optional() })
      .parse(JSON.parse(logLines[0] ?? '{}'))
    expect(parsedLog.traceId).toBe(traceId)
    expect(parsedLog.spanId).toBe(parentSpanId)
  })
})
