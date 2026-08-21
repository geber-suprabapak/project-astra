import { defaultProviders } from '../providers/index.js'
import { NotificationWorker } from './notification-worker.js'
import { logger } from '../lib/logging/logger.js'

const worker = new NotificationWorker({
  domainStore: defaultProviders.domainStore,
  pollIntervalMs: 2000,
  batchSize: 10,
  maxRetries: 3,
  backoffBaseMs: 5000,
})

worker.start()

let isShuttingDown = false

async function shutdown(signal: 'SIGINT' | 'SIGTERM') {
  if (isShuttingDown) return
  isShuttingDown = true
  logger.info({ signal }, 'Notification worker received shutdown signal')

  const forceExitTimer = setTimeout(() => {
    logger.error({ signal }, 'Forced shutdown of notification worker after timeout')
    process.exit(1)
  }, 10_000)
  forceExitTimer.unref()

  try {
    await worker.stop()
    if (defaultProviders.domainStore.close) {
      await defaultProviders.domainStore.close()
    }
    clearTimeout(forceExitTimer)
    logger.info({ signal }, 'Notification worker exited gracefully')
    process.exit(0)
  } catch (err: unknown) {
    logger.error({ err, signal }, 'Error during notification worker shutdown')
    process.exit(1)
  }
}

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})
process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
