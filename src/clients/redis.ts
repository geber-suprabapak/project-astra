import { createClient } from 'redis'
import { env } from '../config/env.js'
import { logger } from '../lib/logging/logger.js'
import { recordDependencyCall } from '../lib/observability/metrics.js'
import { SpanKind, withSpan } from '../lib/observability/tracing.js'

export type RedisRuntimeClient = ReturnType<typeof createClient>

let redisClient: RedisRuntimeClient | null = null
let redisConnectPromise: Promise<void> | null = null

function createRedisClient(): RedisRuntimeClient {
  const client = createClient({ url: env.redisUrl })
  client.on('error', (err) => {
    logger.error({ err }, 'Redis client error')
  })
  return client
}

export function getRedisClient(): RedisRuntimeClient | null {
  if (!env.redisUrl) return null
  if (!redisClient) redisClient = createRedisClient()
  return redisClient
}

export function isRedisConfigured() {
  return Boolean(env.redisUrl)
}

export async function ensureRedisReady() {
  const client = getRedisClient()
  if (!client) return
  const startHr = performance.now()
  return withSpan(
    'redis.ping',
    SpanKind.CLIENT,
    { 'db.system': 'redis', 'db.operation': 'PING' },
    async () => {
      try {
        if (client.isOpen) {
          await client.ping()
          recordDependencyCall('redis', 'ping', 'ok', (performance.now() - startHr) / 1000)
          return
        }
        if (!redisConnectPromise) {
          redisConnectPromise = (async () => {
            await client.connect()
            await client.ping()
          })().finally(() => {
            redisConnectPromise = null
          })
        }
        await redisConnectPromise
        recordDependencyCall('redis', 'ping', 'ok', (performance.now() - startHr) / 1000)
      } catch (err) {
        recordDependencyCall('redis', 'ping', 'error', (performance.now() - startHr) / 1000)
        throw err
      }
    },
  )
}

export async function checkRedisReady() {
  if (!isRedisConfigured()) return true
  try {
    await ensureRedisReady()
    return true
  } catch (err) {
    logger.warn({ err }, 'Redis readiness check failed')
    return false
  }
}

export async function closeRedisClient() {
  if (!redisClient?.isOpen) return
  await redisClient.quit()
}
