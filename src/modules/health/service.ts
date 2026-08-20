import { checkRedisReady, isRedisConfigured } from '../../clients/redis.js'
import { env } from '../../config/env.js'
import { defaultProviders } from '../../providers/index.js'
import type { AppProviders } from '../../providers/types.js'

export interface HealthChecks {
  database: 'ok' | 'fail'
  objectStorage: 'ok' | 'fail'
  mlService: 'ok' | 'fail'
  redis: 'ok' | 'fail'
}

export interface ReadinessResult {
  healthy: boolean
  checks: HealthChecks
}

export async function getReadiness(
  providers: AppProviders = defaultProviders,
): Promise<ReadinessResult> {
  const [dbResult, storageResult, robinResult, redisResult] = await Promise.allSettled([
    providers.domainStore.checkHealth(),
    providers.objectStorage.checkHealth(),
    providers.robinClient.checkReadiness(),
    checkRedisReady(),
  ])

  const database: 'ok' | 'fail' =
    dbResult.status === 'fulfilled' && dbResult.value ? 'ok' : 'fail'
  const objectStorage: 'ok' | 'fail' =
    storageResult.status === 'fulfilled' && storageResult.value ? 'ok' : 'fail'
  const mlService: 'ok' | 'fail' =
    robinResult.status === 'fulfilled' && robinResult.value.healthy ? 'ok' : 'fail'

  let redis: 'ok' | 'fail' = 'ok'
  if (isRedisConfigured() || env.nodeEnv === 'production') {
    redis = redisResult.status === 'fulfilled' && redisResult.value ? 'ok' : 'fail'
  }

  const healthy =
    database === 'ok' && objectStorage === 'ok' && mlService === 'ok' && redis === 'ok'

  return {
    healthy,
    checks: {
      database,
      objectStorage,
      mlService,
      redis,
    },
  }
}

export function getLiveness() {
  return { status: 'ok' }
}
