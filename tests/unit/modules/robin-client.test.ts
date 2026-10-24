import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RobinClient } from '../../../src/clients/robin/client.js'

describe('RobinClient', () => {
  const originalFetch = globalThis.fetch
  const client = new RobinClient('http://localhost:8000')

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('successfully identifies face when Robin returns null for student_id and student_name', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'X-Robin-Contract-Version': 'v1' }),
      json: async () => ({
        status: 'ok',
        student_id: null,
        student_name: null,
        confidence: 0.736,
        process_time_ms: 250,
        message: 'Face verified successfully',
      }),
    })

    const res = await client.identify('base64image', 'token', 'req-1')
    expect(res.status).toBe('ok')
    expect(res.confidence).toBe(0.736)
    expect(res.message).toBe('Face verified successfully')
    expect(res.processTimeMs).toBe(250)
  })

  it('rejects an empty status in a successful Robin identify response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'X-Robin-Contract-Version': 'v1' }),
      json: async () => ({ status: '', process_time_ms: 12 }),
    })

    await expect(client.identify('base64image', 'token', 'req-empty-status')).rejects.toThrow(
      'Unexpected Robin identify response shape.',
    )
  })

  it.each([
    ['unknown status', { status: 'verified' }],
    ['missing status', { process_time_ms: 12 }],
  ])('rejects %s in a successful Robin identify response', async (_label, body) => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'X-Robin-Contract-Version': 'v1' }),
      json: async () => body,
    })

    await expect(client.identify('base64image', 'token', 'req-invalid-status')).rejects.toThrow(
      'Unexpected Robin identify response shape.',
    )
  })

  it('handles Robin error response with null detail gracefully', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers({ 'X-Robin-Contract-Version': 'v1' }),
      json: async () => ({
        status: 'error',
        error: 'InvalidFace',
        message: 'Multiple faces detected',
        detail: null,
      }),
    })

    await expect(client.identify('base64image', 'token', 'req-2')).rejects.toThrow(
      'Multiple faces detected',
    )
  })

  it('handles Robin FastAPI 422 error response with array detail', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      headers: new Headers({ 'X-Robin-Contract-Version': 'v1' }),
      json: async () => ({
        detail: [
          { loc: ['body', 'image_base64'], msg: 'Image exceeds limit', type: 'value_error' },
        ],
      }),
    })

    await expect(client.identify('base64image', 'token', 'req-3')).rejects.toThrow(
      'Image exceeds limit',
    )
  })

  it('handles getEnrollmentStatus with nullish embedding_count and user_id', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'X-Robin-Contract-Version': 'v1' }),
      json: async () => ({
        is_enrolled: false,
        embedding_count: null,
        user_id: null,
      }),
    })

    const res = await client.getEnrollmentStatus('token', 'req-4')
    expect(res.status).toBe('not_enrolled')
    expect(res.embeddingCount).toBe(0)
  })

  // Table-driven contract-header cases: every authenticated Astra→Robin call must carry
  // X-Astra-Contract-Version, Authorization, X-Request-ID, and user context where required.
  // Assertions check header presence only — the Authorization value is never asserted or retained.
  const syntheticToken = [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: 'student-sub-1' })).toString('base64url'),
    'synthetic-signature',
  ].join('.')

  interface CapturedRequest {
    headers: Headers
    url: string
    method: string
  }

  function captureRobinJson<T extends object>(body: T): CapturedRequest {
    const captured: CapturedRequest = { headers: new Headers(), url: '', method: '' }
    globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      captured.url = String(url)
      captured.method = init?.method ?? 'GET'
      captured.headers = new Headers(init?.headers)
      // SAFETY: the mock only supplies the Response fields the Robin client reads (ok, status, headers, json).
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'X-Robin-Contract-Version': 'v1' }),
        json: async () => body,
      } as Response
    })
    return captured
  }

  const identifyBody = { status: 'ok', process_time_ms: 10 }
  const statusBody = { is_enrolled: false, embedding_count: 0 }
  const enrollBody = { images_processed: 1, images_failed: 0, total_embeddings: 1 }

  const authedOperations = [
    {
      name: 'identify',
      responseBody: identifyBody,
      expectedUserContext: 'student-sub-1',
      call: () => client.identify('synthetic-image', syntheticToken, 'req-identify-1'),
    },
    {
      name: 'enroll',
      responseBody: enrollBody,
      expectedUserContext: 'student-sub-1',
      call: () =>
        client.enroll(
          [
            {
              buffer: Buffer.from('synthetic-image-bytes'),
              contentType: 'image/png',
              filename: 'face-1.png',
            },
          ],
          syntheticToken,
          'req-enroll-1',
        ),
    },
    {
      name: 'enroll status',
      responseBody: statusBody,
      expectedUserContext: 'student-sub-1',
      call: () => client.getEnrollmentStatus(syntheticToken, 'req-status-1'),
    },
    {
      name: 'delete enrollment',
      responseBody: {},
      expectedUserContext: 'student-sub-1',
      call: () => client.deleteEnrollment(syntheticToken, 'req-delete-1', 'student-sub-1'),
    },
  ] as const

  it.each(authedOperations)(
    'sends the required contract headers on $name',
    async ({ call, responseBody, expectedUserContext }) => {
      const captured = captureRobinJson(responseBody)
      await call()
      expect(captured.headers.get('X-Astra-Contract-Version')).toBe('v1')
      expect(captured.headers.get('Authorization')).toBeTruthy()
      expect(captured.headers.get('X-Request-ID')).toBeTruthy()
      expect(captured.headers.get('X-Astra-User-Id')).toBe(expectedUserContext)
    },
  )

  it('does not send contract headers on the unauthenticated readiness probe', async () => {
    const captured: CapturedRequest = { headers: new Headers(), url: '', method: '' }
    globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      captured.url = String(url)
      captured.method = init?.method ?? 'GET'
      captured.headers = new Headers(init?.headers)
      // SAFETY: the mock only supplies the Response fields the Robin client reads (ok, status, headers, json).
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'X-Robin-Contract-Version': 'v1' }),
        json: async () => ({}),
      } as Response
    })
    await expect(client.checkReadiness()).resolves.toEqual({ healthy: true })
    expect(captured.headers.get('X-Astra-Contract-Version')).toBeNull()
    expect(captured.headers.get('Authorization')).toBeNull()
  })

  // A07: Robin delete failures must propagate so Astra never continues cleanup
  // or reports a deletion Robin did not perform.
  it('treats a Robin 404 on delete as idempotent success', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers({ 'X-Robin-Contract-Version': 'v1' }),
      json: async () => ({}),
    })
    await expect(
      client.deleteEnrollment(syntheticToken, 'req-delete-404', 'student-sub-1'),
    ).resolves.toBeUndefined()
  })

  it('propagates a Robin non-ok delete response as DEPENDENCY_UNAVAILABLE', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers({ 'X-Robin-Contract-Version': 'v1' }),
      json: async () => ({}),
    })
    await expect(
      client.deleteEnrollment(syntheticToken, 'req-delete-500', 'student-sub-1'),
    ).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' })
  })

  it('propagates a Robin delete network failure as DEPENDENCY_UNAVAILABLE', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connection refused'))
    await expect(
      client.deleteEnrollment(syntheticToken, 'req-delete-net', 'student-sub-1'),
    ).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' })
  })

  it('propagates a Robin delete timeout as UPSTREAM_TIMEOUT', async () => {
    const abortError = new Error('The operation was aborted')
    abortError.name = 'AbortError'
    globalThis.fetch = vi.fn().mockRejectedValue(abortError)
    await expect(
      client.deleteEnrollment(syntheticToken, 'req-delete-timeout', 'student-sub-1'),
    ).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' })
  })
})
