import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExpoPushNotificationTransport } from '../../../src/modules/notifications/transport.js'
import type { NotificationRecord, UserProfile } from '../../../src/providers/types.js'

const token = 'ExponentPushToken[test]'

const notification: NotificationRecord = {
  id: 'notification-test',
  user_id: 'student-test',
  channel: 'push',
  payload: { title: 'Presensi Masuk', body: 'Presensi Anda telah tercatat.' },
  status: 'processing',
  retry_count: 0,
}

const profile: UserProfile = {
  user_id: 'student-test',
  full_name: 'Siswa QA',
  notification_token: token,
  lifecycle_status: 'approved',
  role: 'student',
}

describe('ExpoPushNotificationTransport', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('sends the registered token and returns the Expo ticket ID', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ data: { status: 'ok', id: 'ticket-1' } })))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('EXPO_ACCESS_TOKEN', 'test-access-token')

    const result = await new ExpoPushNotificationTransport().sendPush(notification, profile)

    expect(result).toMatchObject({ success: true, messageId: 'ticket-1' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://exp.host/--/api/v2/push/send')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-access-token')
    expect(JSON.parse(String(init?.body))).toEqual({
      to: token,
      title: 'Presensi Masuk',
      body: 'Presensi Anda telah tercatat.',
      channelId: 'skanida-default',
      data: { title: 'Presensi Masuk', message: 'Presensi Anda telah tercatat.' },
    })
  })

  it('returns a provider error without leaking the push token', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              status: 'error',
              message: `${token} is not a registered recipient`,
              details: { error: 'DeviceNotRegistered' },
            },
          ],
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await new ExpoPushNotificationTransport().sendPush(notification, profile)

    expect(result.success).toBe(false)
    expect(result.error).toContain('DeviceNotRegistered')
    expect(result.error).not.toContain(token)
  })

  it('returns provider HTTP failures for the worker retry policy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })),
    )

    const result = await new ExpoPushNotificationTransport().sendPush(notification, profile)

    expect(result).toEqual({ success: false, error: 'Expo Push API returned HTTP 503' })
  })

  it('rejects a malformed success response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: 'accepted' }))),
    )

    const result = await new ExpoPushNotificationTransport().sendPush(notification, profile)

    expect(result).toEqual({ success: false, error: 'Expo Push API returned an invalid response' })
  })

  it('does not call Expo without a registered token', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)

    const result = await new ExpoPushNotificationTransport().sendPush(notification, {
      ...profile,
      notification_token: null,
    })

    expect(result).toEqual({ success: false, error: 'No Expo push token registered' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
