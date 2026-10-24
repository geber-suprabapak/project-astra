import { checkRedisReady, isRedisConfigured } from '../../clients/redis.js'
import { env } from '../../config/env.js'
import { defaultProviders } from '../../providers/index.js'
import type { AppProviders } from '../../providers/types.js'

import type { CheckStatus, ReadinessResult } from './schema.js'

export type { CheckStatus, HealthChecks, ReadinessResult } from './schema.js'

export interface ReadinessOptions {
  /**
   * Aggregate deadline in milliseconds for the whole readiness probe.
   * Every check still pending when it fires reports `fail`.
   * Defaults to `env.readinessDeadlineMs` (READINESS_DEADLINE_MS, 5000ms).
   */
  deadlineMs?: number
  /**
   * Test seam for the Redis readiness probe, which is not part of
   * AppProviders because the rate-limit client lives outside the provider seams.
   */
  redisCheck?: () => Promise<boolean>
}

/**
 * Outcome of one deadline-bounded dependency check: either the check settled
 * with a value before the deadline, or it did not (timed out; rejections
 * propagate and also map to fail).
 */
type CheckOutcome<T> = { settled: true; value: T } | { settled: false }

/**
 * Sentinel outcome for a dependency check that did not settle before the
 * readiness deadline (or rejected); it always maps to `fail`.
 */
const overdue = <T>(): CheckOutcome<T> => ({ settled: false })

/**
 * Race a single dependency check against the readiness deadline.
 * The check promise is not cancelled (provider checks are side-effect-free
 * reads), but getReadiness always settles within the deadline.
 */
async function boundedCheck<T>(check: Promise<T>, deadlineMs: number): Promise<CheckOutcome<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<CheckOutcome<T>>((resolve) => {
    timer = setTimeout(() => resolve({ settled: false }), deadlineMs)
  })
  const settledCheck = check.then((value): CheckOutcome<T> => ({ settled: true, value }))
  try {
    return await Promise.race([settledCheck, deadline])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function getReadiness(
  providers: AppProviders = defaultProviders,
  options: ReadinessOptions = {},
): Promise<ReadinessResult> {
  const deadlineMs = options.deadlineMs ?? env.readinessDeadlineMs
  const redisCheck = options.redisCheck ?? checkRedisReady

  const [dbOutcome, storageOutcome, identityOutcome, robinOutcome, redisOutcome] =
    await Promise.all([
      boundedCheck(providers.domainStore.checkHealth(), deadlineMs).catch(() => overdue<boolean>()),
      boundedCheck(providers.objectStorage.checkHealth(), deadlineMs).catch(() =>
        overdue<boolean>(),
      ),
      boundedCheck(providers.identityProvider.checkHealth(), deadlineMs).catch(() =>
        overdue<boolean>(),
      ),
      boundedCheck(providers.robinClient.checkReadiness(), deadlineMs).catch(() =>
        overdue<{ healthy: boolean }>(),
      ),
      boundedCheck(redisCheck(), deadlineMs).catch(() => overdue<boolean>()),
    ])

  const database: CheckStatus = dbOutcome.settled && dbOutcome.value === true ? 'ok' : 'fail'
  const objectStorage: CheckStatus =
    storageOutcome.settled && storageOutcome.value === true ? 'ok' : 'fail'
  const identity: CheckStatus =
    identityOutcome.settled && identityOutcome.value === true ? 'ok' : 'fail'
  const mlService: CheckStatus =
    robinOutcome.settled && robinOutcome.value.healthy === true ? 'ok' : 'fail'

  let redis: CheckStatus = 'ok'
  if (isRedisConfigured() || env.nodeEnv === 'production') {
    redis = redisOutcome.settled && redisOutcome.value === true ? 'ok' : 'fail'
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
