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
})
