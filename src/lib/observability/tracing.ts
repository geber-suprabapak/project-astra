import {
  SpanKind,
  SpanStatusCode,
  context,
  propagation,
  trace,
  type Context,
  type Span,
  type TextMapGetter,
  type TextMapSetter,
} from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources'
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  type Sampler,
} from '@opentelemetry/sdk-trace-base'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { filterSafeSpanAttributes, sanitizeLogString, type SafeSpanAttributes } from './pii.js'

const TRACER_NAME = 'project-astra'
const TRACE_ID_ZERO = '00000000000000000000000000000000'
const SPAN_ID_ZERO = '0000000000000000'

let tracerProvider: NodeTracerProvider | null = null
let propagatorRegistered = false

function ensurePropagatorRegistered(): void {
  if (propagatorRegistered) return
  const contextManager = new AsyncLocalStorageContextManager()
  contextManager.enable()
  context.setGlobalContextManager(contextManager)
  propagation.setGlobalPropagator(new W3CTraceContextPropagator())
  propagatorRegistered = true
}

ensurePropagatorRegistered()

function resolveOtlpTracesUrl(): string | null {
  const explicitTracesEndpoint = process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT']?.trim()
  if (explicitTracesEndpoint) return explicitTracesEndpoint

  const baseEndpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT']?.trim()
  if (!baseEndpoint) return null

  const normalized = baseEndpoint.replace(/\/$/, '')
  return normalized.endsWith('/v1/traces') ? normalized : `${normalized}/v1/traces`
}

interface ResourceAttributeMap {
  [key: string]: string
}

function parseResourceAttributes(raw: string | undefined): ResourceAttributeMap {
  const result: ResourceAttributeMap = {}
  if (!raw) return result

  for (const entry of raw.split(',')) {
    const idx = entry.indexOf('=')
    if (idx <= 0) continue
    const key = entry.slice(0, idx).trim()
    const value = entry.slice(idx + 1).trim()
    if (key && value) {
      result[key] = value
    }
  }
  return result
}

function resolveSampler(): Sampler {
  const samplerName = (process.env['OTEL_TRACES_SAMPLER'] ?? 'parentbased_always_on')
    .trim()
    .toLowerCase()
  const rawArg = process.env['OTEL_TRACES_SAMPLER_ARG']
  const parsedRatio = rawArg ? Number(rawArg) : 1
  const ratio =
    Number.isFinite(parsedRatio) && parsedRatio >= 0 && parsedRatio <= 1 ? parsedRatio : 1

  switch (samplerName) {
    case 'always_on':
      return new AlwaysOnSampler()
    case 'always_off':
      return new AlwaysOffSampler()
    case 'traceidratio':
      return new TraceIdRatioBasedSampler(ratio)
    case 'parentbased_always_off':
      return new ParentBasedSampler({ root: new AlwaysOffSampler() })
    case 'parentbased_traceidratio':
      return new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) })
    case 'parentbased_always_on':
    default:
      return new ParentBasedSampler({ root: new AlwaysOnSampler() })
  }
}

export function initTracing(defaultServiceName = 'astra'): boolean {
  ensurePropagatorRegistered()
  if (tracerProvider) return true

  const tracesUrl = resolveOtlpTracesUrl()
  if (!tracesUrl) return false

  const serviceName =
    process.env['OTEL_SERVICE_NAME']?.trim() ||
    process.env['SERVICE_NAME']?.trim() ||
    defaultServiceName

  const envAttributes = parseResourceAttributes(process.env['OTEL_RESOURCE_ATTRIBUTES'])
  const resource = defaultResource().merge(
    resourceFromAttributes({
      ...envAttributes,
      'service.name': serviceName,
      'deployment.environment': process.env['NODE_ENV'] ?? 'development',
    }),
  )

  const exporter = new OTLPTraceExporter({ url: tracesUrl })
  const provider = new NodeTracerProvider({
    resource,
    sampler: resolveSampler(),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  })
  provider.register()
  tracerProvider = provider
  return true
}

export async function shutdownTracing(): Promise<void> {
  if (!tracerProvider) return
  const provider = tracerProvider
  tracerProvider = null
  await provider.shutdown()
}

export function isTracingEnabled(): boolean {
  return tracerProvider !== null
}

export function getTracer() {
  return trace.getTracer(TRACER_NAME)
}

export function getActiveTraceContext(): { traceId: string; spanId: string } | null {
  const spanContext = trace.getSpanContext(context.active())
  if (!spanContext) return null
  if (!spanContext.traceId || spanContext.traceId === TRACE_ID_ZERO) return null
  if (!spanContext.spanId || spanContext.spanId === SPAN_ID_ZERO) return null
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
  }
}

const headerSetter: TextMapSetter<Record<string, string>> = {
  set(carrier, key, value) {
    carrier[key] = value
  },
}

export function injectTraceHeaders(headers: Record<string, string>): void {
  ensurePropagatorRegistered()
  propagation.inject(context.active(), headers, headerSetter)
}

export function extractTraceContext(getHeader: (name: string) => string | undefined): Context {
  ensurePropagatorRegistered()
  const getter: TextMapGetter<null> = {
    keys: () => ['traceparent', 'tracestate'],
    get: (_carrier, key) => getHeader(key),
  }
  return propagation.extract(context.active(), null, getter)
}

export async function withSpan<T>(
  name: string,
  kind: SpanKind,
  attributes: SafeSpanAttributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = getTracer()
  return tracer.startActiveSpan(
    name,
    {
      kind,
      attributes: filterSafeSpanAttributes(attributes),
    },
    async (span) => {
      try {
        return await fn(span)
      } catch (err) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? sanitizeLogString(err.message) : 'error',
        })
        throw err
      } finally {
        span.end()
      }
    },
  )
}

export { SpanKind, SpanStatusCode, context, trace }
