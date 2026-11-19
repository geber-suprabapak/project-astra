import { z } from 'zod'
import { env } from '../../config/env.js'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
import { recordDependencyCall } from '../../lib/observability/metrics.js'
import { SpanKind, injectTraceHeaders, withSpan } from '../../lib/observability/tracing.js'
import {
  RobinEnrollResponseSchema,
  RobinEnrollStatusResponseSchema,
  RobinIdentifyResponseSchema,
  type RobinEnrollResult,
  type RobinEnrollStatus,
  type RobinIdentifyResult,
} from './schemas.js'

const ENROLL_STATUS_TIMEOUT_MS = () => env.robinEnrollStatusTimeoutMs

// Robin's private v1 contract requires this header on every authenticated Astra→Robin call.
const ASTRA_CONTRACT_VERSION_HEADER = 'X-Astra-Contract-Version'
const ASTRA_CONTRACT_VERSION = 'v1'

export interface RobinReadyHeaders {
  [key: string]: string
  Accept: string
}

export interface RobinRequestHeaders {
  [key: string]: string
  'Content-Type': string
  Accept: string
  'X-Astra-Contract-Version': string
}

export interface RobinUploadHeaders {
  [key: string]: string
  Authorization: string
  'X-Request-ID': string
  'X-Astra-Contract-Version': string
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw AppError.upstreamTimeout('Robin')
    }
    throw AppError.dependencyUnavailable('Robin')
  } finally {
    clearTimeout(timer)
  }
}

function userIdFromToken(token?: string): string | undefined {
  if (!token) return undefined
  try {
    const payload = token.split('.')[1]
    if (!payload) return undefined
    // SAFETY: Astra has already validated the bearer token; only its subject is copied as context.
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub?: string
    }
    return claims.sub
  } catch {
    return undefined
  }
}

function robinHeaders(token?: string, requestId?: string, userId?: string): RobinRequestHeaders {
  const headers: RobinRequestHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${env.robinServiceToken}`,
    [ASTRA_CONTRACT_VERSION_HEADER]: ASTRA_CONTRACT_VERSION,
  }
  const resolvedUserId = userId ?? userIdFromToken(token)
  if (resolvedUserId) headers['X-Astra-User-Id'] = resolvedUserId
  if (requestId) headers['X-Request-ID'] = requestId
  injectTraceHeaders(headers)
  return headers
}

function assertRobinContract(res: Response): void {
  if (res.headers.get('X-Robin-Contract-Version') !== 'v1') {
    throw AppError.dependencyUnavailable('Robin contract')
  }
}

export class RobinClient {
  private readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  async checkReadiness(): Promise<{ healthy: boolean }> {
    const startHr = performance.now()
    return withSpan(
      'robin.ready',
      SpanKind.CLIENT,
      { 'peer.service': 'robin', 'http.request.method': 'GET', 'http.route': '/ready' },
      async (span) => {
        try {
          const headers: RobinReadyHeaders = { Accept: 'application/json' }
          injectTraceHeaders(headers)
          const res = await fetchWithTimeout(
            `${this.baseUrl}/ready`,
            { method: 'GET', headers },
            env.robinReadyTimeoutMs,
          )
          span.setAttribute('http.response.status_code', res.status)
          assertRobinContract(res)
          recordDependencyCall(
            'robin',
            'ready',
            res.ok ? 'ok' : 'error',
            (performance.now() - startHr) / 1000,
          )
          return { healthy: res.ok }
        } catch (err) {
          recordDependencyCall('robin', 'ready', 'error', (performance.now() - startHr) / 1000)
          if (err instanceof AppError && err.code === 'UPSTREAM_TIMEOUT') {
            logger.warn('Robin readiness check timed out')
            return { healthy: false }
          }
          logger.warn({ err }, 'Robin readiness check failed')
          return { healthy: false }
        }
      },
    )
  }

  async identify(
    imageBase64: string,
    token: string,
    requestId: string,
  ): Promise<RobinIdentifyResult> {
    const startHr = performance.now()
    return withSpan(
      'robin.identify',
      SpanKind.CLIENT,
      { 'peer.service': 'robin', 'http.request.method': 'POST', 'http.route': '/v1/identify' },
      async (span) => {
        try {
          const res = await fetchWithTimeout(
            `${this.baseUrl}/v1/identify`,
            {
              method: 'POST',
              headers: robinHeaders(token, requestId),
              body: JSON.stringify({ image_base64: imageBase64 }),
            },
            env.robinIdentifyTimeoutMs,
          )
          span.setAttribute('http.response.status_code', res.status)
          assertRobinContract(res)

          if (!res.ok) {
            recordDependencyCall('robin', 'identify', 'error', (performance.now() - startHr) / 1000)
            const errorJson = await res.json().catch(() => null)
            const stringCandidate = z.string().min(1)
            const errorSchema = z.object({
              message: z.string().nullish(),
              detail: z.unknown().nullish(),
            })
            const parsedError = errorSchema.safeParse(errorJson)
            let msg = 'Face not recognized.'
            if (parsedError.success && parsedError.data) {
              const messageCandidate = stringCandidate.safeParse(parsedError.data.message)
              const detailCandidate = stringCandidate.safeParse(parsedError.data.detail)
              if (messageCandidate.success) {
                msg = messageCandidate.data
              } else if (detailCandidate.success) {
                msg = detailCandidate.data
              } else {
                const detailList = z
                  .array(z.object({ msg: stringCandidate }))
                  .safeParse(parsedError.data.detail)
                if (detailList.success && detailList.data.length > 0) {
                  msg = detailList.data[0].msg
                }
              }
            }
            throw AppError.attendanceBlocked(msg)
          }

          const parsed = RobinIdentifyResponseSchema.safeParse(await res.json())
          if (!parsed.success) throw AppError.internal('Unexpected Robin identify response shape.')

          recordDependencyCall('robin', 'identify', 'ok', (performance.now() - startHr) / 1000)
          const data = parsed.data
          return {
            status: data.status,
            confidence: data.confidence ?? undefined,
            qualityScore: data.quality_score ?? undefined,
            processTimeMs: data.process_time_ms ?? 0,
            message:
              data.message ||
              (data.status === 'ok' ? 'Face verified successfully' : 'Face not recognized.'),
          }
        } catch (err) {
          if (!(err instanceof AppError && err.code === 'ATTENDANCE_BLOCKED')) {
            recordDependencyCall('robin', 'identify', 'error', (performance.now() - startHr) / 1000)
          }
          throw err
        }
      },
    )
  }

  async getEnrollmentStatus(token: string, requestId: string): Promise<RobinEnrollStatus> {
    const startHr = performance.now()
    return withSpan(
      'robin.enroll_status',
      SpanKind.CLIENT,
      { 'peer.service': 'robin', 'http.request.method': 'GET', 'http.route': '/v1/enroll/status' },
      async (span) => {
        let res: Response
        try {
          res = await fetchWithTimeout(
            `${this.baseUrl}/v1/enroll/status`,
            { method: 'GET', headers: robinHeaders(token, requestId) },
            ENROLL_STATUS_TIMEOUT_MS(),
          )
        } catch (err) {
          recordDependencyCall(
            'robin',
            'enroll_status',
            'error',
            (performance.now() - startHr) / 1000,
          )
          if (err instanceof AppError && err.code === 'UPSTREAM_TIMEOUT') throw err
          throw AppError.dependencyUnavailable('Robin')
        }
        span.setAttribute('http.response.status_code', res.status)
        assertRobinContract(res)

        if (res.status === 404) {
          recordDependencyCall('robin', 'enroll_status', 'ok', (performance.now() - startHr) / 1000)
          return { status: 'not_enrolled', embeddingCount: 0, message: 'Not enrolled.' }
        }
        if (!res.ok) {
          recordDependencyCall(
            'robin',
            'enroll_status',
            'error',
            (performance.now() - startHr) / 1000,
          )
          throw AppError.dependencyUnavailable('Robin')
        }

        const parsed = RobinEnrollStatusResponseSchema.safeParse(await res.json())
        if (!parsed.success) {
          recordDependencyCall(
            'robin',
            'enroll_status',
            'error',
            (performance.now() - startHr) / 1000,
          )
          throw AppError.internal('Unexpected Robin enroll status response.')
        }

        recordDependencyCall('robin', 'enroll_status', 'ok', (performance.now() - startHr) / 1000)
        const data = parsed.data
        return {
          status: data.is_enrolled ? 'enrolled' : 'not_enrolled',
          embeddingCount: data.embedding_count ?? 0,
          message: data.is_enrolled ? 'Ready.' : 'Not enrolled.',
        }
      },
    )
  }

  async enroll(
    files: { buffer: Buffer; contentType: string; filename: string }[],
    token: string,
    requestId: string,
  ): Promise<RobinEnrollResult> {
    const userId = userIdFromToken(token)
    if (!userId) throw AppError.authInvalid('Astra user context is missing.')

    const startHr = performance.now()
    return withSpan(
      'robin.enroll',
      SpanKind.CLIENT,
      {
        'peer.service': 'robin',
        'http.request.method': 'POST',
        'http.route': '/v1/enroll',
        'robin.enroll.file_count': files.length,
      },
      async (span) => {
        const formData = new FormData()
        for (const file of files) {
          const blob = new Blob([new Uint8Array(file.buffer)], { type: file.contentType })
          formData.append('files', blob, file.filename)
        }

        const headers: RobinUploadHeaders = {
          Authorization: `Bearer ${env.robinServiceToken}`,
          'X-Request-ID': requestId,
          'X-Astra-User-Id': userId,
          [ASTRA_CONTRACT_VERSION_HEADER]: ASTRA_CONTRACT_VERSION,
        }
        injectTraceHeaders(headers)

        let res: Response
        try {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), env.robinEnrollTimeoutMs)
          try {
            res = await fetch(`${this.baseUrl}/v1/enroll`, {
              method: 'POST',
              headers,
              body: formData,
              signal: controller.signal,
            })
          } finally {
            clearTimeout(timer)
          }
        } catch (err) {
          recordDependencyCall('robin', 'enroll', 'error', (performance.now() - startHr) / 1000)
          if (err instanceof Error && err.name === 'AbortError')
            throw AppError.upstreamTimeout('Robin')
          throw AppError.dependencyUnavailable('Robin')
        }
        span.setAttribute('http.response.status_code', res.status)
        assertRobinContract(res)

        if (!res.ok) {
          recordDependencyCall('robin', 'enroll', 'error', (performance.now() - startHr) / 1000)
          throw AppError.dependencyUnavailable('Robin')
        }
        const parsed = RobinEnrollResponseSchema.safeParse(await res.json())
        if (!parsed.success) {
          recordDependencyCall('robin', 'enroll', 'error', (performance.now() - startHr) / 1000)
          throw AppError.internal('Unexpected Robin enroll response.')
        }

        recordDependencyCall('robin', 'enroll', 'ok', (performance.now() - startHr) / 1000)
        const data = parsed.data
        return {
          imagesProcessed: data.images_processed ?? files.length,
          imagesFailed: data.images_failed ?? 0,
          totalEmbeddings: data.total_embeddings ?? files.length,
        }
      },
    )
  }

  async deleteEnrollment(token?: string, requestId?: string, userId?: string): Promise<void> {
    const startHr = performance.now()
    return withSpan(
      'robin.delete_enrollment',
      SpanKind.CLIENT,
      { 'peer.service': 'robin', 'http.request.method': 'DELETE', 'http.route': '/v1/enroll' },
      async (span) => {
        // A07: delete failures propagate so callers never continue Astra-side
        // cleanup or report a deletion Robin did not perform. 404 counts as
        // already-deleted so retries stay idempotent.
        const headers = robinHeaders(token, requestId, userId)
        let res: Response
        try {
          res = await fetchWithTimeout(
            `${this.baseUrl}/v1/enroll`,
            { method: 'DELETE', headers },
            env.robinEnrollTimeoutMs,
          )
        } catch (err) {
          recordDependencyCall(
            'robin',
            'delete_enrollment',
            'error',
            (performance.now() - startHr) / 1000,
          )
          throw err
        }
        span.setAttribute('http.response.status_code', res.status)
        if (res.ok || res.status === 404) assertRobinContract(res)
        if (res.status === 404) {
          recordDependencyCall(
            'robin',
            'delete_enrollment',
            'ok',
            (performance.now() - startHr) / 1000,
          )
          return
        }
        if (!res.ok) {
          recordDependencyCall(
            'robin',
            'delete_enrollment',
            'error',
            (performance.now() - startHr) / 1000,
          )
          logger.warn({ status: res.status }, 'Robin delete enrollment returned non-ok status')
          throw AppError.dependencyUnavailable('Robin')
        }
        recordDependencyCall(
          'robin',
          'delete_enrollment',
          'ok',
          (performance.now() - startHr) / 1000,
        )
      },
    )
  }
}

export const robinClient = new RobinClient(env.robinBaseUrl)
