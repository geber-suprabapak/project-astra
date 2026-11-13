import { env } from '../../config/env.js'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
import { getRedisClient } from '../../clients/redis.js'
import type { FilePurpose, ObjectStorage } from '../types.js'
import {
  executeS3Request,
  extFromContentType,
  signS3Url,
  type RedisCacheClient,
  type S3EndpointConfig,
  type S3ObjectStorageOptions,
} from './s3-signing.js'

export type { RedisCacheClient, S3ObjectStorageOptions }

const AVATAR_TTL_SECONDS = 86400 // 24h
const SIGNED_AVATAR_URL_CACHE_TTL_SECONDS = 43200 // 12h (well within 24h SigV4 expiration)
const PERMIT_TTL_SECONDS = 604800 // 7 days
const SIGNED_PERMIT_URL_CACHE_TTL_SECONDS = 7200 // 2h

export class S3ObjectStorage implements ObjectStorage {
  private readonly config: S3EndpointConfig
  private readonly bucketAvatars: string
  private readonly bucketPermits: string
  private readonly bucketAdiwiyata: string
  private readonly redisClient: RedisCacheClient | null

  constructor(options: S3ObjectStorageOptions = {}) {
    const endpoint = (options.endpoint ?? env.s3Endpoint).replace(/\/$/, '')
    this.config = {
      endpoint,
      publicUrl: (options.publicUrl ?? env.s3PublicUrl ?? endpoint).replace(/\/$/, ''),
      region: options.region ?? env.s3Region,
      accessKeyId: options.accessKeyId ?? env.s3AccessKeyId,
      secretAccessKey: options.secretAccessKey ?? env.s3SecretAccessKey,
      forcePathStyle: options.forcePathStyle ?? env.s3ForcePathStyle,
    }
    this.bucketAvatars = options.bucketAvatars ?? env.s3BucketAvatars
    this.bucketPermits = options.bucketPermits ?? env.s3BucketPermits
    this.bucketAdiwiyata = options.bucketAdiwiyata ?? env.s3BucketAdiwiyata
    this.redisClient = options.redisClient !== undefined ? options.redisClient : getRedisClient()
  }

  private async uploadObject(
    bucket: string,
    path: string,
    file: Buffer,
    contentType: string,
    label: string,
  ): Promise<void> {
    try {
      const response = await executeS3Request(this.config, 'PUT', bucket, path, file, contentType)
      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        logger.error({ status: response.status, errorText }, `S3 ${label} upload failed`)
        throw AppError.storageUploadFailed()
      }
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err }, `S3 ${label} upload failed with unexpected error`)
      throw AppError.storageUploadFailed()
    }
  }

  private async getSignedCachedUrl(
    bucket: string,
    path: string,
    cacheKeyPrefix: string,
    urlTtlSeconds: number,
    cacheTtlSeconds: number,
    label: string,
  ): Promise<string | null> {
    if (!path) return null
    const cacheKey = `${cacheKeyPrefix}:${path}`
    const redis = this.redisClient

    if (redis?.isOpen) {
      try {
        const cached = await redis.get(cacheKey)
        if (cached) return cached
      } catch (err) {
        logger.warn({ err, path }, `Failed to read signed ${label} URL from cache`)
      }
    }

    try {
      const signed = signS3Url(this.config, bucket, path, urlTtlSeconds)
      if (redis?.isOpen && signed) {
        try {
          await redis.set(cacheKey, signed, { EX: cacheTtlSeconds })
        } catch (err) {
          logger.warn({ err, path }, `Failed to cache signed ${label} URL`)
        }
      }
      return signed
    } catch {
      return null
    }
  }

  async uploadAvatar(userId: string, file: Buffer, contentType: string): Promise<string> {
    const ext = extFromContentType(contentType)
    const path = `${userId}/avatar.${ext}`
    await this.uploadObject(this.bucketAvatars, path, file, contentType, 'avatar')
    const redis = this.redisClient
    if (redis?.isOpen) {
      await redis.del(`astra:signed_avatar:${path}`).catch(() => {})
    }
    return path
  }

  async deleteAvatar(userId: string): Promise<void> {
    const extensions = ['jpg', 'jpeg', 'png', 'webp']
    const redis = this.redisClient
    await Promise.allSettled([
      ...extensions.map((ext) =>
        executeS3Request(this.config, 'DELETE', this.bucketAvatars, `${userId}/avatar.${ext}`),
      ),
      ...(redis?.isOpen
        ? extensions.map((ext) =>
            redis.del(`astra:signed_avatar:${userId}/avatar.${ext}`).catch(() => {}),
          )
        : []),
    ])
  }

  async getSignedAvatarUrl(path: string): Promise<string | null> {
    return this.getSignedCachedUrl(
      this.bucketAvatars,
      path,
      'astra:signed_avatar',
      AVATAR_TTL_SECONDS,
      SIGNED_AVATAR_URL_CACHE_TTL_SECONDS,
      'avatar',
    )
  }

  async uploadPermitAttachment(userId: string, file: Buffer, contentType: string): Promise<string> {
    const ext = extFromContentType(contentType)
    const path = `${userId}/${Date.now()}.${ext}`
    await this.uploadObject(this.bucketPermits, path, file, contentType, 'permit attachment')
    return path
  }

  async getSignedPermitUrl(path: string): Promise<string | null> {
    return this.getSignedCachedUrl(
      this.bucketPermits,
      path,
      'astra:signed_permit',
      PERMIT_TTL_SECONDS,
      SIGNED_PERMIT_URL_CACHE_TTL_SECONDS,
      'permit',
    )
  }

  async deletePermitAttachment(path: string): Promise<void> {
    if (!path) return
    const redis = this.redisClient
    if (redis?.isOpen) {
      await redis.del(`astra:signed_permit:${path}`).catch(() => {})
    }
    try {
      await executeS3Request(this.config, 'DELETE', this.bucketPermits, path)
    } catch (err) {
      logger.warn({ err, path }, 'Failed to delete permit attachment from S3')
    }
  }

  async uploadFaceEnrollmentImage(
    userId: string,
    imageIndex: number,
    file: Buffer,
    contentType: string,
  ): Promise<string> {
    const ext = extFromContentType(contentType)
    const path = `${userId}/face_${imageIndex}.${ext}`
    await this.uploadObject(this.bucketAvatars, path, file, contentType, 'face enrollment')
    return path
  }

  async deleteFaceEnrollmentImages(userId: string): Promise<void> {
    const extensions = ['jpg', 'jpeg', 'png', 'webp']
    const deletePromises: Promise<unknown>[] = []
    for (let i = 1; i <= 20; i++) {
      for (const ext of extensions) {
        deletePromises.push(
          executeS3Request(this.config, 'DELETE', this.bucketAvatars, `${userId}/face_${i}.${ext}`),
        )
      }
    }
    await Promise.allSettled(deletePromises)
  }

  async uploadAdiwiyataReport(path: string, file: Buffer): Promise<void> {
    await this.uploadObject(this.bucketAdiwiyata, path, file, 'image/jpeg', 'Adiwiyata report')
  }

  async getSignedAdiwiyataReportUrl(path: string, expiresInSeconds = 900): Promise<string | null> {
    if (!path || expiresInSeconds <= 0) return null
    try {
      return signS3Url(this.config, this.bucketAdiwiyata, path, expiresInSeconds)
    } catch {
      return null
    }
  }

  private bucketForPurpose(purpose: FilePurpose): string {
    if (purpose === 'permit_attachment') return this.bucketPermits
    if (purpose === 'adiwiyata_report') return this.bucketAdiwiyata
    return this.bucketAvatars
  }

  async statObject(
    purpose: FilePurpose,
    path: string,
  ): Promise<{ sizeBytes: number; contentType: string } | null> {
    if (!path) return null
    let response: Response
    try {
      response = await executeS3Request(this.config, 'HEAD', this.bucketForPurpose(purpose), path)
    } catch (err) {
      logger.error({ err, purpose }, 'S3 object HEAD failed with unexpected error')
      throw AppError.dependencyUnavailable('object storage')
    }
    if (response.status === 404) return null
    if (!response.ok) {
      logger.error({ status: response.status, purpose }, 'S3 object HEAD failed')
      throw AppError.dependencyUnavailable('object storage')
    }
    const sizeHeader = response.headers.get('content-length')
    const sizeBytes = sizeHeader === null ? Number.NaN : Number(sizeHeader)
    if (!Number.isInteger(sizeBytes) || sizeBytes < 0) {
      logger.error({ purpose }, 'S3 object HEAD returned unusable metadata')
      throw AppError.dependencyUnavailable('object storage')
    }
    return { sizeBytes, contentType: response.headers.get('content-type') ?? '' }
  }

  async deleteObject(purpose: FilePurpose, path: string): Promise<void> {
    const bucket = this.bucketForPurpose(purpose)
    try {
      const response = await executeS3Request(this.config, 'DELETE', bucket, path)
      if (!response.ok) {
        logger.error({ status: response.status, purpose }, 'S3 object deletion failed')
        throw AppError.dependencyUnavailable('object storage')
      }
      const redis = this.redisClient
      if (redis?.isOpen) {
        if (purpose === 'avatar') {
          await redis.del(`astra:signed_avatar:${path}`).catch(() => {})
        } else if (purpose === 'permit_attachment') {
          await redis.del(`astra:signed_permit:${path}`).catch(() => {})
        }
      }
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err, purpose }, 'S3 object deletion failed with unexpected error')
      throw AppError.dependencyUnavailable('object storage')
    }
  }

  async getSignedFaceEnrollmentUrl(path: string): Promise<string | null> {
    if (!path) return null
    try {
      return signS3Url(this.config, this.bucketAvatars, path, AVATAR_TTL_SECONDS)
    } catch {
      return null
    }
  }

  async getPresignedUploadUrl(params: {
    bucket?: string
    key: string
    contentType: string
    expiresInSeconds?: number
  }): Promise<string> {
    const bucket = params.bucket ?? this.bucketAvatars
    const ttl = params.expiresInSeconds ?? 900
    return signS3Url(this.config, bucket, params.key, ttl, 'PUT', params.contentType)
  }

  async uploadPublicFile(path: string, file: Buffer, contentType: string): Promise<string> {
    const bucket = this.bucketAvatars
    const response = await executeS3Request(this.config, 'PUT', bucket, path, file, contentType)
    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.error({ status: response.status, errorText }, 'S3 public upload failed')
      throw AppError.storageUploadFailed()
    }
    return path
  }

  getPublicUrl(path: string): string {
    const cleanPath = path.replace(/^\//, '')
    if (this.config.publicUrl) {
      return `${this.config.publicUrl.replace(/\/$/, '')}/${this.bucketAvatars}/${cleanPath}`
    }
    return `${this.config.endpoint}/${this.bucketAvatars}/${cleanPath}`
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await executeS3Request(
        this.config,
        'HEAD',
        this.bucketAvatars,
        '',
        undefined,
        undefined,
        3000,
      )
      return res.ok
    } catch {
      return false
    }
  }
}
