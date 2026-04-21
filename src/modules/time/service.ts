import { env } from '../../config/env.js'

export function getServerTime() {
  const now = new Date()
  return {
    now: now.toISOString(),
    timezone: env.businessTimezone,
    source: 'bff',
    epoch_ms: now.getTime(),
  }
}
