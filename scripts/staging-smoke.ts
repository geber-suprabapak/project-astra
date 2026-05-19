type SuccessEnvelope<T> = {
  success: boolean
  data: T
  error?: { code: string; message: string }
}

function readRequiredEnv(key: string) {
  const value = Bun.env[key]?.trim()
  if (!value) throw new Error(`Missing ${key}.`)
  return value
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/$/, '')
}

async function expectJson<T>(
  input: string,
  init: RequestInit,
  expectedStatus: number,
): Promise<T> {
  const response = await fetch(input, init)
  const bodyText = await response.text()
  let json: unknown = null

  if (bodyText) {
    try {
      json = JSON.parse(bodyText)
    } catch {
      throw new Error(`Expected JSON response from ${input}, got: ${bodyText}`)
    }
  }

  if (response.status !== expectedStatus) {
    throw new Error(
      `Unexpected status for ${input}: expected ${expectedStatus}, got ${response.status}. Body: ${bodyText}`,
    )
  }

  return json as T
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const baseUrl = normalizeBaseUrl(readRequiredEnv('STAGING_BASE_URL'))
const accessToken = readRequiredEnv('ACCESS_TOKEN')
const latitude = Number(readRequiredEnv('SMOKE_LATITUDE'))
const longitude = Number(readRequiredEnv('SMOKE_LONGITUDE'))

assert(Number.isFinite(latitude), 'SMOKE_LATITUDE must be a valid number.')
assert(Number.isFinite(longitude), 'SMOKE_LONGITUDE must be a valid number.')

const authHeaders = {
  Authorization: `Bearer ${accessToken}`,
  Accept: 'application/json',
}

const live = await expectJson<{ status: string }>(`${baseUrl}/live`, { method: 'GET' }, 200)
assert(live.status === 'ok', 'Expected /live status to be ok.')

const ready = await expectJson<{ healthy: boolean; checks: Record<string, string> }>(
  `${baseUrl}/ready`,
  { method: 'GET' },
  200,
)
assert(ready.healthy === true, 'Expected /ready to report healthy=true.')

const mobileHealth = await expectJson<SuccessEnvelope<{ status: string }>>(
  `${baseUrl}/v1/mobile/health`,
  { method: 'GET' },
  200,
)
assert(mobileHealth.success === true, 'Expected mobile health success=true.')
assert(mobileHealth.data?.status === 'healthy', 'Expected mobile health status=healthy.')

const serverTime = await expectJson<
  SuccessEnvelope<{ now: string; timezone: string; source: string; epoch_ms: number }>
>(`${baseUrl}/v1/mobile/time`, { method: 'GET', headers: authHeaders }, 200)
assert(serverTime.success === true, 'Expected time endpoint success=true.')
assert(typeof serverTime.data?.now === 'string', 'Expected time endpoint to include now.')
assert(typeof serverTime.data?.epoch_ms === 'number', 'Expected time endpoint to include epoch_ms.')

const dashboard = await expectJson<SuccessEnvelope<Record<string, unknown>>>(
  `${baseUrl}/v1/mobile/dashboard`,
  { method: 'GET', headers: authHeaders },
  200,
)
assert(dashboard.success === true, 'Expected dashboard success=true.')
assert(typeof dashboard.data === 'object' && dashboard.data !== null, 'Expected dashboard data object.')

const precheck = await expectJson<
  SuccessEnvelope<{ allowed: boolean; action_type: string; checks: Record<string, unknown> }>
>(
  `${baseUrl}/v1/mobile/attendance/precheck`,
  {
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ latitude, longitude }),
  },
  200,
)
assert(precheck.success === true, 'Expected attendance precheck success=true.')
assert(typeof precheck.data?.allowed === 'boolean', 'Expected attendance precheck allowed boolean.')
assert(typeof precheck.data?.action_type === 'string', 'Expected attendance precheck action_type string.')

console.log(
  JSON.stringify(
    {
      live: live.status,
      ready: ready.healthy,
      mobile_health: mobileHealth.data.status,
      time_source: serverTime.data.source,
      dashboard: 'ok',
      attendance_precheck_allowed: precheck.data.allowed,
      attendance_precheck_action_type: precheck.data.action_type,
    },
    null,
    2,
  ),
)
