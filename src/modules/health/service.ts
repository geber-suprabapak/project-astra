import { checkRedisReady } from '../../clients/redis.js'
import { supabaseAdmin } from '../../clients/supabase/admin.js'
import { robinClient } from '../../clients/robin/client.js'

export interface HealthChecks {
  database: 'ok' | 'fail'
  mlService: 'ok' | 'fail'
}

export interface ReadinessResult {
  healthy: boolean
  checks: HealthChecks
}

async function checkDatabase(): Promise<'ok' | 'fail'> {
  try {
    const { error } = await supabaseAdmin.from('user_profiles').select('user_id').limit(1)
    return error ? 'fail' : 'ok'
  } catch {
    return 'fail'
  }
}

export async function getReadiness(): Promise<ReadinessResult> {
  const [dbStatus, robin, redis] = await Promise.allSettled([
    checkDatabase(),
    robinClient.checkReadiness(),
    checkRedisReady(),
  ])

  const database: 'ok' | 'fail' =
    dbStatus.status === 'fulfilled' ? dbStatus.value : 'fail'
  const mlService: 'ok' | 'fail' =
    robin.status === 'fulfilled' && robin.value.healthy ? 'ok' : 'fail'
  const redisHealthy =
    redis.status === 'fulfilled' ? redis.value : false

  return {
    healthy: database === 'ok' && mlService === 'ok' && redisHealthy,
    checks: { database, mlService },
  }
}

export function getLiveness() {
  return { status: 'ok' }
}
