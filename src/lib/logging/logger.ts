import pino, { type DestinationStream } from 'pino'
import { PINO_REDACT_PATHS } from '../observability/pii.js'
import { getActiveTraceContext } from '../observability/tracing.js'

export function createLogger(destination?: DestinationStream) {
  const options: pino.LoggerOptions = {
    level: process.env['LOG_LEVEL'] ?? 'info',
    base: {
      service: process.env['OTEL_SERVICE_NAME'] ?? process.env['SERVICE_NAME'] ?? 'skanida-bff',
      tenantKey: process.env['TENANT_KEY'] ?? 'unknown',
    },
    mixin() {
      const activeTrace = getActiveTraceContext()
      if (!activeTrace) return {}
      return {
        traceId: activeTrace.traceId,
        spanId: activeTrace.spanId,
      }
    },
    redact: {
      paths: PINO_REDACT_PATHS,
      censor: '[REDACTED]',
    },
  }
  return destination ? pino(options, destination) : pino(options)
}

export const logger = createLogger()

export type Logger = typeof logger
