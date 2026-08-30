import { createHash, createHmac } from 'node:crypto'
import { env } from '../../config/env.js'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
import type { ObjectStorage } from '../types.js'

const AVATAR_TTL_SECONDS = 86400 // 24h
const PERMIT_TTL_SECONDS = 604800 // 7 days

export interface S3ObjectStorageOptions {
  endpoint?: string
  region?: string
  accessKeyId?: string
  secretAccessKey?: string
  bucketAvatars?: string
  bucketPermits?: string
  forcePathStyle?: boolean
  publicUrl?: string
}

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

function getSigningKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp)
  const kRegion = hmacSha256(kDate, region)
  const kService = hmacSha256(kRegion, service)
  return hmacSha256(kService, 'aws4_request')
}

function extFromContentType(contentType: string): string {
  if (contentType === 'image/png') return 'png'
  if (contentType === 'image/webp') return 'webp'
  return 'jpg'
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly endpoint: string
  private readonly region: string
  private readonly accessKeyId: string
  private readonly secretAccessKey: string
  private readonly bucketAvatars: string
  private readonly bucketPermits: string
  private readonly forcePathStyle: boolean
  private readonly publicUrl: string

  constructor(options: S3ObjectStorageOptions = {}) {
    this.endpoint = (options.endpoint ?? env.s3Endpoint).replace(/\/$/, '')
    this.region = options.region ?? env.s3Region
    this.accessKeyId = options.accessKeyId ?? env.s3AccessKeyId
    this.secretAccessKey = options.secretAccessKey ?? env.s3SecretAccessKey
    this.bucketAvatars = options.bucketAvatars ?? env.s3BucketAvatars
    this.bucketPermits = options.bucketPermits ?? env.s3BucketPermits
    this.forcePathStyle = options.forcePathStyle ?? env.s3ForcePathStyle
    this.publicUrl = (options.publicUrl ?? env.s3PublicUrl ?? this.endpoint).replace(/\/$/, '')
  }

  private buildObjectUrl(bucket: string, key: string, usePublic = false): URL {
    const base = usePublic ? this.publicUrl : this.endpoint
    const encodedKey = key.split('/').map(encodeURIComponent).join('/')
    if (this.forcePathStyle) {
      return new URL(`${base}/${bucket}/${encodedKey}`)
    }
    const host = new URL(base).host
    return new URL(`${new URL(base).protocol}//${bucket}.${host}/${encodedKey}`)
  }

  private signUrl(
    bucket: string,
    key: string,
    expiresInSeconds: number,
    method: 'GET' | 'PUT' = 'GET',
  ): string {
    const now = new Date()
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
    const dateStamp = amzDate.slice(0, 8)
    const credential = `${this.accessKeyId}/${dateStamp}/${this.region}/s3/aws4_request`

    const targetUrl = this.buildObjectUrl(bucket, key, true)
    const host = targetUrl.host

    const queryParams = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': credential,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': expiresInSeconds.toString(),
      'X-Amz-SignedHeaders': 'host',
    }

    const canonicalQuery = Object.entries(queryParams)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')

    const canonicalUri = targetUrl.pathname
    const canonicalHeaders = `host:${host}\n`
    const signedHeaders = 'host'
    const payloadHash = 'UNSIGNED-PAYLOAD'

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n')

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      `${dateStamp}/${this.region}/s3/aws4_request`,
      sha256(canonicalRequest),
    ].join('\n')

    const signingKey = getSigningKey(this.secretAccessKey, dateStamp, this.region, 's3')
    const signature = hmacSha256(signingKey, stringToSign).toString('hex')

    return `${targetUrl.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`
  }

  private async executeS3Request(
    method: 'PUT' | 'DELETE' | 'GET' | 'HEAD',
    bucket: string,
    key: string,
    body?: Buffer,
    contentType?: string,
    timeoutMs: number = env.storageUploadTimeoutMs,
  ): Promise<Response> {
    const url = this.buildObjectUrl(bucket, key, false)
    const now = new Date()
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
    const dateStamp = amzDate.slice(0, 8)
    const credential = `${this.accessKeyId}/${dateStamp}/${this.region}/s3/aws4_request`
    const payloadHash = body ? sha256(body) : sha256('')

    const headers: Record<string, string> = {}
    headers.host = url.host
    headers['x-amz-date'] = amzDate
    headers['x-amz-content-sha256'] = payloadHash
    if (contentType) {
      headers['content-type'] = contentType
    }

    const headerKeys = Object.keys(headers).sort()
    const canonicalHeaders = headerKeys.map((k) => `${k.toLowerCase()}:${headers[k]}\n`).join('')
    const signedHeaders = headerKeys.map((k) => k.toLowerCase()).join(';')

    const canonicalRequest = [
      method,
      url.pathname,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n')

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      `${dateStamp}/${this.region}/s3/aws4_request`,
      sha256(canonicalRequest),
    ].join('\n')

    const signingKey = getSigningKey(this.secretAccessKey, dateStamp, this.region, 's3')
    const signature = hmacSha256(signingKey, stringToSign).toString('hex')

    const authorization = `AWS4-HMAC-SHA256 Credential=${credential}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    headers['Authorization'] = authorization

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    const init: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    }
    if (body && method !== 'GET' && method !== 'HEAD') {
      init.body = new Uint8Array(body)
    }

    try {
      return await fetch(url.toString(), init)
    } finally {
      clearTimeout(timer)
    }
  }

  async uploadAvatar(userId: string, file: Buffer, contentType: string): Promise<string> {
    const ext = extFromContentType(contentType)
    const path = `${userId}/avatar.${ext}`

    try {
      const response = await this.executeS3Request(
        'PUT',
        this.bucketAvatars,
        path,
        file,
        contentType,
      )
      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        logger.error({ status: response.status, errorText }, 'S3 avatar upload failed')
        throw AppError.storageUploadFailed()
      }
      return path
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err }, 'S3 avatar upload failed with unexpected error')
      throw AppError.storageUploadFailed()
    }
  }

  async deleteAvatar(userId: string): Promise<void> {
    const extensions = ['jpg', 'jpeg', 'png', 'webp']
    await Promise.allSettled(
      extensions.map((ext) =>
        this.executeS3Request('DELETE', this.bucketAvatars, `${userId}/avatar.${ext}`),
      ),
    )
  }

  async getSignedAvatarUrl(path: string): Promise<string | null> {
    if (!path) return null
    try {
      return this.signUrl(this.bucketAvatars, path, AVATAR_TTL_SECONDS)
    } catch {
      return null
    }
  }

  async uploadPermitAttachment(userId: string, file: Buffer, contentType: string): Promise<string> {
    const ext = extFromContentType(contentType)
    const path = `${userId}/${Date.now()}.${ext}`

    try {
      const response = await this.executeS3Request(
        'PUT',
        this.bucketPermits,
        path,
        file,
        contentType,
      )
      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        logger.error({ status: response.status, errorText }, 'S3 permit attachment upload failed')
        throw AppError.storageUploadFailed()
      }
      return path
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err }, 'S3 permit attachment upload failed with unexpected error')
      throw AppError.storageUploadFailed()
    }
  }

  async getSignedPermitUrl(path: string): Promise<string | null> {
    if (!path) return null
    try {
      return this.signUrl(this.bucketPermits, path, PERMIT_TTL_SECONDS)
    } catch {
      return null
    }
  }

  async deletePermitAttachment(path: string): Promise<void> {
    if (!path) return
    try {
      await this.executeS3Request('DELETE', this.bucketPermits, path)
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

    try {
      const response = await this.executeS3Request(
        'PUT',
        this.bucketAvatars,
        path,
        file,
        contentType,
      )
      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        logger.error({ status: response.status, errorText }, 'S3 face enrollment upload failed')
        throw AppError.storageUploadFailed()
      }
      return path
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.error({ err }, 'S3 face enrollment upload failed with unexpected error')
      throw AppError.storageUploadFailed()
    }
  }

  async deleteFaceEnrollmentImages(userId: string): Promise<void> {
    const extensions = ['jpg', 'jpeg', 'png', 'webp']
    const deletePromises: Promise<unknown>[] = []
    for (let i = 1; i <= 20; i++) {
      for (const ext of extensions) {
        deletePromises.push(
          this.executeS3Request('DELETE', this.bucketAvatars, `${userId}/face_${i}.${ext}`),
        )
      }
    }
    await Promise.allSettled(deletePromises)
  }

  async deleteObject(
    purpose: 'avatar' | 'permit_attachment' | 'face_enrollment',
    path: string,
  ): Promise<void> {
    const bucket = purpose === 'permit_attachment' ? this.bucketPermits : this.bucketAvatars
    try {
      const response = await this.executeS3Request('DELETE', bucket, path)
      if (!response.ok) {
        logger.error({ status: response.status, purpose }, 'S3 object deletion failed')
        throw AppError.dependencyUnavailable('object storage')
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
      return this.signUrl(this.bucketAvatars, path, AVATAR_TTL_SECONDS)
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
    return this.signUrl(bucket, params.key, ttl, 'PUT')
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await this.executeS3Request(
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
