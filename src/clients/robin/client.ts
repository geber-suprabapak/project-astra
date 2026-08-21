import { z } from 'zod'
import { env } from '../../config/env.js'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
import {
  RobinEnrollResponseSchema,
  RobinEnrollStatusResponseSchema,
  RobinIdentifyResponseSchema,
  type RobinEnrollResult,
  type RobinEnrollStatus,
  type RobinIdentifyResult,
} from './schemas.js'

const ENROLL_STATUS_TIMEOUT_MS = () => env.robinEnrollStatusTimeoutMs

export interface RobinRequestHeaders {
  [key: string]: string
  'Content-Type': string
  Accept: string
}

export interface RobinUploadHeaders {
  [key: string]: string
  Authorization: string
  'X-Request-ID': string
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
  }
  const resolvedUserId = userId ?? userIdFromToken(token)
  if (resolvedUserId) headers['X-Astra-User-Id'] = resolvedUserId
  if (requestId) headers['X-Request-ID'] = requestId
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
    try {
      const res = await fetchWithTimeout(
        `${this.baseUrl}/ready`,
        { method: 'GET', headers: { Accept: 'application/json' } },
        env.robinReadyTimeoutMs,
      )
      assertRobinContract(res)
      return { healthy: res.ok }
    } catch (err) {
      if (err instanceof AppError && err.code === 'UPSTREAM_TIMEOUT') {
        logger.warn('Robin readiness check timed out')
        return { healthy: false }
      }
      logger.warn({ err }, 'Robin readiness check failed')
      return { healthy: false }
    }
  }

  async identify(
    imageBase64: string,
    token: string,
    requestId: string,
  ): Promise<RobinIdentifyResult> {
    const res = await fetchWithTimeout(
      `${this.baseUrl}/v1/identify`,
      {
        method: 'POST',
        headers: robinHeaders(token, requestId),
        body: JSON.stringify({ image_base64: imageBase64 }),
      },
      env.robinIdentifyTimeoutMs,
    )
    assertRobinContract(res)

    if (!res.ok) {
      const errorJson = await res.json().catch(() => null)
      const errorSchema = z.object({
        message: z.string().optional(),
        detail: z.string().optional(),
      })
      const parsedError = errorSchema.safeParse(errorJson)
      const msg = parsedError.success
        ? parsedError.data.message || parsedError.data.detail || 'Face not recognized.'
        : 'Face not recognized.'
      throw AppError.attendanceBlocked(msg)
    }

    const parsed = RobinIdentifyResponseSchema.safeParse(await res.json())
    if (!parsed.success) throw AppError.internal('Unexpected Robin identify response shape.')

    const data = parsed.data
    return {
      status: data.status,
      confidence: data.confidence,
      qualityScore: data.quality_score,
      processTimeMs: data.process_time_ms ?? 0,
      message:
        data.message ||
        (data.status === 'ok' ? 'Face verified successfully' : 'Face not recognized.'),
    }
  }

  async getEnrollmentStatus(token: string, requestId: string): Promise<RobinEnrollStatus> {
    let res: Response
    try {
      res = await fetchWithTimeout(
        `${this.baseUrl}/v1/enroll/status`,
        { method: 'GET', headers: robinHeaders(token, requestId) },
        ENROLL_STATUS_TIMEOUT_MS(),
      )
    } catch (err) {
      if (err instanceof AppError && err.code === 'UPSTREAM_TIMEOUT') throw err
      throw AppError.dependencyUnavailable('Robin')
    }
    assertRobinContract(res)

    if (res.status === 404) {
      return { status: 'not_enrolled', embeddingCount: 0, message: 'Not enrolled.' }
    }
    if (!res.ok) throw AppError.dependencyUnavailable('Robin')

    const parsed = RobinEnrollStatusResponseSchema.safeParse(await res.json())
    if (!parsed.success) throw AppError.internal('Unexpected Robin enroll status response.')

    const data = parsed.data
    return {
      status: data.is_enrolled ? 'enrolled' : 'not_enrolled',
      embeddingCount: data.embedding_count ?? 0,
      message: data.is_enrolled ? 'Ready.' : 'Not enrolled.',
    }
  }

  async enroll(
    files: { buffer: Buffer; contentType: string; filename: string }[],
    token: string,
    requestId: string,
  ): Promise<RobinEnrollResult> {
    const userId = userIdFromToken(token)
    if (!userId) throw AppError.authInvalid('Astra user context is missing.')

    const formData = new FormData()
    for (const file of files) {
      const blob = new Blob([new Uint8Array(file.buffer)], { type: file.contentType })
      formData.append('files', blob, file.filename)
    }

    const headers: RobinUploadHeaders = {
      Authorization: `Bearer ${env.robinServiceToken}`,
      'X-Request-ID': requestId,
      'X-Astra-User-Id': userId,
    }

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
      if (err instanceof Error && err.name === 'AbortError') throw AppError.upstreamTimeout('Robin')
      throw AppError.dependencyUnavailable('Robin')
    }
    assertRobinContract(res)

    if (!res.ok) throw AppError.dependencyUnavailable('Robin')
    const parsed = RobinEnrollResponseSchema.safeParse(await res.json())
    if (!parsed.success) throw AppError.internal('Unexpected Robin enroll response.')

    const data = parsed.data
    return {
      imagesProcessed: data.images_processed ?? files.length,
      imagesFailed: data.images_failed ?? 0,
      totalEmbeddings: data.total_embeddings ?? files.length,
    }
  }

  async deleteEnrollment(token?: string, requestId?: string, userId?: string): Promise<void> {
    try {
      const headers = robinHeaders(token, requestId, userId)
      const res = await fetchWithTimeout(
        `${this.baseUrl}/v1/enroll`,
        { method: 'DELETE', headers },
        env.robinEnrollTimeoutMs,
      )
      if (res.ok || res.status === 404) assertRobinContract(res)
      if (!res.ok && res.status !== 404) {
        logger.warn({ status: res.status }, 'Robin delete enrollment returned non-ok status')
      }
    } catch (err) {
      if (err instanceof AppError && err.code === 'UPSTREAM_TIMEOUT') {
        logger.warn('Robin delete enrollment timed out')
        return
      }
      logger.warn({ err }, 'Robin delete enrollment request failed')
    }
  }
}

export const robinClient = new RobinClient(env.robinBaseUrl)
