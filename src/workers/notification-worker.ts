import { AppError } from '../lib/errors/app-error.js'
import { logger } from '../lib/logging/logger.js'
import {
  type NotificationTransport,
  LoggingNotificationTransport,
} from '../modules/notifications/transport.js'
import type { DomainStore, NotificationRecord } from '../providers/types.js'

export interface NotificationWorkerOptions {
  domainStore: DomainStore
  transport?: NotificationTransport
  pollIntervalMs?: number
  batchSize?: number
  maxRetries?: number
  backoffBaseMs?: number
  leaseMs?: number
}

export interface WorkerBatchResult {
  claimed: number
  delivered: number
  retried: number
  failed: number
}

export interface WorkerRunningStatus {
  isRunning: boolean
  isProcessing: boolean
}

export class NotificationWorker {
  private domainStore: DomainStore
  private transport: NotificationTransport
  private pollIntervalMs: number
  private batchSize: number
  private maxRetries: number
  private backoffBaseMs: number
  private leaseMs: number
  private isRunning = false
  private isProcessing = false
  private loopTimer: NodeJS.Timeout | null = null

  constructor(options: NotificationWorkerOptions) {
    this.domainStore = options.domainStore
    this.transport = options.transport ?? new LoggingNotificationTransport()
    this.pollIntervalMs = options.pollIntervalMs ?? 2000
    this.batchSize = options.batchSize ?? 10
    this.maxRetries = options.maxRetries ?? 3
    this.backoffBaseMs = options.backoffBaseMs ?? 5000
    this.leaseMs = options.leaseMs ?? 120_000
  }

  async processBatch(): Promise<WorkerBatchResult> {
    const claimedRecords = await this.domainStore.claimPendingNotifications({
      limit: this.batchSize,
      maxRetries: this.maxRetries,
      leaseMs: this.leaseMs,
    })

    const result: WorkerBatchResult = {
      claimed: claimedRecords.length,
      delivered: 0,
      retried: 0,
      failed: 0,
    }

    if (claimedRecords.length === 0) {
      return result
    }

    for (const notification of claimedRecords) {
      await this.processSingleNotification(notification, result)
    }

    return result
  }

  private async processSingleNotification(
    notification: NotificationRecord,
    batchResult: WorkerBatchResult,
  ): Promise<void> {
    try {
      const recipientProfile = await this.domainStore
        .getUserProfile(notification.user_id)
        .catch(() => null)

      const deliveryResult =
        notification.channel === 'push'
          ? await this.transport.sendPush(notification, recipientProfile)
          : await this.transport.sendEmail(notification, recipientProfile)

      if (deliveryResult.success) {
        try {
          await this.domainStore.updateNotificationStatus({
            id: notification.id,
            status: 'delivered',
            errorMessage: null,
            nextRetryAt: null,
            expectedCurrentStatus: 'processing',
            expectedUpdatedAt: notification.updated_at,
          })
          batchResult.delivered++
          logger.info(
            {
              notificationId: notification.id,
              userId: notification.user_id,
              channel: notification.channel,
              messageId: deliveryResult.messageId,
            },
            'Notification delivered successfully',
          )
        } catch (updateErr: unknown) {
          if (updateErr instanceof AppError && updateErr.httpStatus === 409) {
            logger.warn(
              { notificationId: notification.id },
              'Ignoring stale worker delivery status update after lease expiry',
            )
            return
          }
          throw updateErr
        }
      } else {
        await this.handleDeliveryFailure(
          notification,
          deliveryResult.error ?? 'Delivery reported failure',
          batchResult,
        )
      }
    } catch (err: unknown) {
      if (err instanceof AppError && err.httpStatus === 409) {
        return
      }
      const errorMsg = err instanceof Error ? err.message : 'Unexpected dispatch error'
      await this.handleDeliveryFailure(notification, errorMsg, batchResult)
    }
  }

  private async handleDeliveryFailure(
    notification: NotificationRecord,
    errorMessage: string,
    batchResult: WorkerBatchResult,
  ): Promise<void> {
    const nextRetryCount = notification.retry_count + 1

    try {
      if (nextRetryCount >= this.maxRetries) {
        await this.domainStore.updateNotificationStatus({
          id: notification.id,
          status: 'failed',
          retryCount: nextRetryCount,
          errorMessage,
          nextRetryAt: null,
          expectedCurrentStatus: 'processing',
          expectedUpdatedAt: notification.updated_at,
        })
        batchResult.failed++
        logger.error(
          {
            notificationId: notification.id,
            userId: notification.user_id,
            channel: notification.channel,
            retryCount: nextRetryCount,
            maxRetries: this.maxRetries,
            errorMessage,
          },
          'Notification failed permanently after reaching max retries',
        )
      } else {
        const delayMs = this.backoffBaseMs * Math.pow(2, notification.retry_count)
        const nextRetryAt = new Date(Date.now() + delayMs).toISOString()

        await this.domainStore.updateNotificationStatus({
          id: notification.id,
          status: 'pending',
          retryCount: nextRetryCount,
          nextRetryAt,
          errorMessage,
          expectedCurrentStatus: 'processing',
          expectedUpdatedAt: notification.updated_at,
        })
        batchResult.retried++
        logger.warn(
          {
            notificationId: notification.id,
            userId: notification.user_id,
            channel: notification.channel,
            retryCount: nextRetryCount,
            nextRetryAt,
            delayMs,
            errorMessage,
          },
          'Notification failed delivery, scheduled for retry',
        )
      }
    } catch (updateErr: unknown) {
      if (updateErr instanceof AppError && updateErr.httpStatus === 409) {
        logger.warn(
          { notificationId: notification.id },
          'Ignoring stale worker failure status update after lease expiry',
        )
        return
      }
      throw updateErr
    }
  }

  start(): void {
    if (this.isRunning) return
    this.isRunning = true
    logger.info(
      {
        pollIntervalMs: this.pollIntervalMs,
        batchSize: this.batchSize,
        maxRetries: this.maxRetries,
        backoffBaseMs: this.backoffBaseMs,
      },
      'Notification worker started',
    )

    const tick = async () => {
      if (!this.isRunning) return
      this.isProcessing = true
      try {
        const batch = await this.processBatch()
        if (batch.claimed > 0) {
          logger.debug(batch, 'Processed notification batch')
        }
      } catch (err: unknown) {
        logger.error({ err }, 'Error during notification worker tick')
      } finally {
        this.isProcessing = false
        if (this.isRunning) {
          this.loopTimer = setTimeout(tick, this.pollIntervalMs)
        }
      }
    }

    void tick()
  }

  async stop(): Promise<void> {
    this.isRunning = false
    if (this.loopTimer) {
      clearTimeout(this.loopTimer)
      this.loopTimer = null
    }

    // Wait until current processing finishes
    while (this.isProcessing) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    logger.info('Notification worker stopped')
  }

  getRunningStatus(): WorkerRunningStatus {
    return {
      isRunning: this.isRunning,
      isProcessing: this.isProcessing,
    }
  }
}
