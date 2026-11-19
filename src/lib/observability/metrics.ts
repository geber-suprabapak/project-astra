import { serve, type ServerType } from '@hono/node-server'
import { Hono } from 'hono'
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client'
import { logger } from '../logging/logger.js'
import { sanitizeRouteLabel } from './pii.js'

const HTTP_DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
const DEPENDENCY_DURATION_BUCKETS = [
  0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 30,
]

export const metricsRegistry = new Registry()

collectDefaultMetrics({
  register: metricsRegistry,
  prefix: 'astra_',
})

const httpRequestsTotal = new Counter({
  name: 'astra_http_requests_total',
  help: 'Total HTTP requests handled by Astra BFF',
  labelNames: ['method', 'route', 'status_class', 'status'] as const,
  registers: [metricsRegistry],
})

const httpRequestDurationSeconds = new Histogram({
  name: 'astra_http_request_duration_seconds',
  help: 'HTTP request duration in seconds for Astra BFF',
  labelNames: ['method', 'route', 'status_class'] as const,
  buckets: HTTP_DURATION_BUCKETS,
  registers: [metricsRegistry],
})

const httpRequestsInFlight = new Gauge({
  name: 'astra_http_requests_in_flight',
  help: 'Current number of in-flight HTTP requests in Astra BFF',
  registers: [metricsRegistry],
})

const dependencyRequestsTotal = new Counter({
  name: 'astra_dependency_requests_total',
  help: 'Total outbound dependency calls from Astra',
  labelNames: ['dependency', 'operation', 'status'] as const,
  registers: [metricsRegistry],
})

const dependencyRequestDurationSeconds = new Histogram({
  name: 'astra_dependency_request_duration_seconds',
  help: 'Outbound dependency call duration in seconds',
  labelNames: ['dependency', 'operation', 'status'] as const,
  buckets: DEPENDENCY_DURATION_BUCKETS,
  registers: [metricsRegistry],
})

const dependencyUp = new Gauge({
  name: 'astra_dependency_up',
  help: 'Readiness health state of Astra dependencies (1=ok, 0=fail)',
  labelNames: ['dependency'] as const,
  registers: [metricsRegistry],
})

const notificationsProcessedTotal = new Counter({
  name: 'astra_notifications_processed_total',
  help: 'Total outbox notifications processed by Astra notification worker',
  labelNames: ['channel', 'outcome'] as const,
  registers: [metricsRegistry],
})

const notificationsBatchDurationSeconds = new Histogram({
  name: 'astra_notifications_batch_duration_seconds',
  help: 'Duration of Astra notification worker batch processing in seconds',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 30],
  registers: [metricsRegistry],
})

export function statusClassFor(status: number): string {
  if (status >= 500) return '5xx'
  if (status >= 400) return '4xx'
  if (status >= 300) return '3xx'
  if (status >= 200) return '2xx'
  return '1xx'
}

export function incHttpInFlight(): void {
  httpRequestsInFlight.inc()
}

export function decHttpInFlight(): void {
  httpRequestsInFlight.dec()
}

export function recordHttpRequest(
  method: string,
  route: string | undefined,
  status: number,
  durationSeconds: number,
): void {
  const safeRoute = sanitizeRouteLabel(route)
  const statusClass = statusClassFor(status)
  httpRequestsTotal.inc({
    method,
    route: safeRoute,
    status_class: statusClass,
    status: String(status),
  })
  httpRequestDurationSeconds.observe(
    {
      method,
      route: safeRoute,
      status_class: statusClass,
    },
    durationSeconds,
  )
}

export type DependencyName = 'postgres' | 'redis' | 's3' | 'robin' | 'logto'
export type DependencyStatus = 'ok' | 'error'

export function recordDependencyCall(
  dependency: DependencyName,
  operation: string,
  status: DependencyStatus,
  durationSeconds: number,
): void {
  dependencyRequestsTotal.inc({ dependency, operation, status })
  dependencyRequestDurationSeconds.observe({ dependency, operation, status }, durationSeconds)
}

export function setDependencyUp(dependency: DependencyName, healthy: boolean): void {
  dependencyUp.set({ dependency }, healthy ? 1 : 0)
}

export function recordNotificationOutcome(
  channel: string,
  outcome: 'delivered' | 'retried' | 'failed',
): void {
  notificationsProcessedTotal.inc({ channel, outcome })
}

export function observeNotificationBatchDuration(durationSeconds: number): void {
  notificationsBatchDurationSeconds.observe(durationSeconds)
}

export async function renderMetrics(): Promise<string> {
  return metricsRegistry.metrics()
}

export function createMetricsApp(): Hono {
  const metricsApp = new Hono()
  metricsApp.get('/metrics', async (c) => {
    const body = await renderMetrics()
    return c.text(body, 200, {
      'Content-Type': metricsRegistry.contentType,
      'Cache-Control': 'no-store',
    })
  })
  return metricsApp
}

export function startMetricsServer(port: number): ServerType | null {
  if (port <= 0) return null
  const metricsApp = createMetricsApp()
  return serve(
    {
      fetch: metricsApp.fetch,
      port,
    },
    (info) => {
      logger.info({ metricsPort: info.port }, 'Internal metrics server started')
    },
  )
}
