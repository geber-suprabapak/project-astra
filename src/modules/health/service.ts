import { checkRedisReady, isRedisConfigured } from '../../clients/redis.js'
import { env } from '../../config/env.js'
import { defaultProviders } from '../../providers/index.js'
import type { AppProviders } from '../../providers/types.js'

import type { CheckStatus, HealthChecks, ReadinessResult } from './schema.js'

export type { CheckStatus, HealthChecks, ReadinessResult } from './schema.js'

export async function getReadiness(
  providers: AppProviders = defaultProviders,
): Promise<ReadinessResult> {
  const [dbResult, storageResult, identityResult, robinResult, redisResult] = await Promise.allSettled([
    providers.domainStore.checkHealth(),
    providers.objectStorage.checkHealth(),
    providers.identityProvider.checkHealth(),
    providers.robinClient.checkReadiness(),
    checkRedisReady(),
  ])

  const database: CheckStatus =
    dbResult.status === 'fulfilled' && dbResult.value ? 'ok' : 'fail'
  const objectStorage: CheckStatus =
    storageResult.status === 'fulfilled' && storageResult.value ? 'ok' : 'fail'
  const identity: CheckStatus =
    identityResult.status === 'fulfilled' && identityResult.value ? 'ok' : 'fail'
  const mlService: CheckStatus =
    robinResult.status === 'fulfilled' && robinResult.value.healthy ? 'ok' : 'fail'

  let redis: CheckStatus = 'ok'
  if (isRedisConfigured() || env.nodeEnv === 'production') {
    redis = redisResult.status === 'fulfilled' && redisResult.value ? 'ok' : 'fail'
  }

  const healthy =
    database === 'ok' &&
    objectStorage === 'ok' &&
    identity === 'ok' &&
    mlService === 'ok' &&
    redis === 'ok'

  return {
    healthy,
    checks: {
      database,
      objectStorage,
      identity,
      mlService,
      redis,
    },
  }
}

export function getLiveness() {
  return { status: 'ok' }
}
