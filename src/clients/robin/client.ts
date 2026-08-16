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

function robinHeaders(token?: string, requestId?: string): RobinRequestHeaders {
  const headers: RobinRequestHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (requestId) headers['X-Request-ID'] = requestId
  return headers
}

export class RobinClient {
  private readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  // -------------------------------------------------------------------------
  // Readiness check — timeout: env.robinReadyTimeoutMs
  // -------------------------------------------------------------------------
  async checkReadiness(): Promise<{ healthy: boolean }> {
    try {
      const res = await fetchWithTimeout(
        `${this.baseUrl}/ready`,
        { method: 'GET', headers: { Accept: 'application/json' } },
        env.robinReadyTimeoutMs,
      )
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

  // -------------------------------------------------------------------------
  // Identify — timeout: env.robinIdentifyTimeoutMs
  // Returns only processTimeMs — never leaks student_id/name/confidence
  // -------------------------------------------------------------------------
  async identify(
    imageBase64: string,
    token: string,
    requestId: string,
  ): Promise<{ processTimeMs: number }> {
    const res = await fetchWithTimeout(
      `${this.baseUrl}/v1/identify`,
      {
        method: 'POST',
        headers: robinHeaders(token, requestId),
        body: JSON.stringify({ image_base64: imageBase64 }),
      },
      env.robinIdentifyTimeoutMs,
    )

    if (!res.ok) {
      const errorJson = await res.json().catch(() => null)
      const errorSchema = z.object({ message: z.string() })
      const parsedError = errorSchema.safeParse(errorJson)
      throw AppError.attendanceBlocked(
        parsedError.success ? parsedError.data.message : 'Face not recognized.',
      )
    }

    const parsed = RobinIdentifyResponseSchema.safeParse(await res.json())
    if (!parsed.success) throw AppError.internal('Unexpected Robin identify response shape.')

    const data = parsed.data
    // Mobile check: faceResult.status === 'ok'
    if (data.status !== 'ok') {
      throw AppError.attendanceBlocked(data.message || 'Face not recognized.')
    }

    return { processTimeMs: data.process_time_ms ?? 0 }
  }

  // -------------------------------------------------------------------------
  // Enrollment status — timeout: ENROLL_STATUS_TIMEOUT_MS (5000ms)
  // 404 → not_enrolled (not an error)
  // -------------------------------------------------------------------------
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

    // 404 → not enrolled (per mobile behavior and plan.md §8.1)
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

  // -------------------------------------------------------------------------
  // Enrollment upload — timeout: env.robinEnrollTimeoutMs
  // -------------------------------------------------------------------------
  async enroll(
    files: { buffer: Buffer; contentType: string; filename: string }[],
    token: string,
    requestId: string,
  ): Promise<RobinEnrollResult> {
    const formData = new FormData()
    for (const f of files) {
      const blob = new Blob([new Uint8Array(f.buffer)], { type: f.contentType })
      formData.append('files', blob, f.filename)
    }

    const headers: RobinUploadHeaders = {
      Authorization: `Bearer ${token}`,
      'X-Request-ID': requestId,
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
      if (err instanceof Error && err.name === 'AbortError') {
        throw AppError.upstreamTimeout('Robin')
      }
      throw AppError.dependencyUnavailable('Robin')
    }

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
}

// Singleton
export const robinClient = new RobinClient(env.robinBaseUrl)
