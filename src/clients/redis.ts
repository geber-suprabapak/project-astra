import { createClient } from 'redis'
import { env } from '../config/env.js'
import { logger } from '../lib/logging/logger.js'

export interface RedisRuntimeClient {
  isOpen: boolean
  connect(): Promise<void>
  del(key: string): Promise<number>
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>
  on(event: 'error', listener: (err: unknown) => void): RedisRuntimeClient
  ping(): Promise<string>
  quit(): Promise<string>
}

let redisClient: RedisRuntimeClient | null = null
let redisConnectPromise: Promise<void> | null = null

function createRedisClient(): RedisRuntimeClient {
  const client = createClient({ url: env.redisUrl }) as unknown as RedisRuntimeClient
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
  if (client.isOpen) {
    await client.ping()
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
