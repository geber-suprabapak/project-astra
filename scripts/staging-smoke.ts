interface HealthChecks {
  database?: string
  mlService?: string
}

interface ServerTimeData {
  now: string
  timezone: string
  source: string
  epoch_ms: number
}

interface DashboardData {
  user?: { user_id?: string; name?: string }
}

interface PrecheckChecks {
  schedule?: boolean
  radius?: boolean
  device?: boolean
}

interface PrecheckData {
  allowed: boolean
  action_type: string
  checks: PrecheckChecks
}

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

async function expectJson<T>(input: string, init: RequestInit, expectedStatus: number): Promise<T> {
  const response = await fetch(input, init)
  const bodyText = await response.text()

  if (response.status !== expectedStatus) {
    throw new Error(
      `Unexpected status for ${input}: expected ${expectedStatus}, got ${response.status}. Body: ${bodyText}`,
    )
  }

  if (!bodyText) {
    // SAFETY: caller specifies expected response type T
    return undefined as T
  }

  try {
    // SAFETY: caller specifies expected response type T
    return JSON.parse(bodyText) as T
  } catch {
    throw new Error(`Expected JSON response from ${input}, got: ${bodyText}`)
  }
}

function assert(condition: boolean, message: string): asserts condition {
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

const ready = await expectJson<{ healthy: boolean; checks: HealthChecks }>(
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

const serverTime = await expectJson<SuccessEnvelope<ServerTimeData>>(
  `${baseUrl}/v1/mobile/time`,
  { method: 'GET', headers: authHeaders },
  200,
)
assert(serverTime.success === true, 'Expected time endpoint success=true.')
assert(Boolean(serverTime.data?.now), 'Expected time endpoint to include now.')
assert(Number.isFinite(serverTime.data?.epoch_ms), 'Expected time endpoint to include epoch_ms.')

const dashboard = await expectJson<SuccessEnvelope<DashboardData>>(
  `${baseUrl}/v1/mobile/dashboard`,
  { method: 'GET', headers: authHeaders },
  200,
)
assert(dashboard.success === true, 'Expected dashboard success=true.')
assert(Boolean(dashboard.data), 'Expected dashboard data object.')

const precheck = await expectJson<SuccessEnvelope<PrecheckData>>(
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
assert(
  precheck.data?.allowed === true || precheck.data?.allowed === false,
  'Expected attendance precheck allowed boolean.',
)
assert(Boolean(precheck.data?.action_type), 'Expected attendance precheck action_type string.')

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
