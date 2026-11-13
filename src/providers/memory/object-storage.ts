import type { ObjectStorage } from '../types.js'

export class MemoryObjectStorage implements ObjectStorage {
  public objects = new Map<string, { buffer: Buffer; contentType: string }>()
  public isHealthy = true

  async uploadAvatar(userId: string, file: Buffer, contentType: string): Promise<string> {
    const ext = contentType === 'image/png' ? 'png' : 'jpg'
    const path = `${userId}/avatar.${ext}`
    this.objects.set(path, { buffer: file, contentType })
    return path
  }

  async deleteAvatar(userId: string): Promise<void> {
    for (const key of this.objects.keys()) {
      if (key.startsWith(`${userId}/avatar.`)) {
        this.objects.delete(key)
      }
    }
  }

  async getSignedAvatarUrl(path: string): Promise<string | null> {
    if (!path) return null
    return `https://storage.local/signed/${encodeURIComponent(path)}?expires=86400`
  }

  async uploadPermitAttachment(userId: string, file: Buffer, contentType: string): Promise<string> {
    const ext = contentType === 'image/png' ? 'png' : 'jpg'
    const path = `${userId}/${Date.now()}.${ext}`
    this.objects.set(path, { buffer: file, contentType })
    return path
  }

  async getSignedPermitUrl(path: string): Promise<string | null> {
    if (!path) return null
    return `https://storage.local/signed/${encodeURIComponent(path)}?expires=604800`
  }

  async deletePermitAttachment(path: string): Promise<void> {
    this.objects.delete(path)
  }

  async uploadFaceEnrollmentImage(
    userId: string,
    imageIndex: number,
    file: Buffer,
    contentType: string,
  ): Promise<string> {
    const ext = contentType === 'image/png' ? 'png' : 'jpg'
    const path = `${userId}/face_${imageIndex}.${ext}`
    this.objects.set(path, { buffer: file, contentType })
    return path
  }

  async uploadAdiwiyataReport(path: string, file: Buffer): Promise<void> {
    this.objects.set(path, { buffer: file, contentType: 'image/jpeg' })
  }

  async getSignedAdiwiyataReportUrl(path: string, expiresInSeconds = 900): Promise<string | null> {
    if (!path || expiresInSeconds <= 0) return null
    return `https://storage.local/signed/${encodeURIComponent(path)}?expires=${expiresInSeconds}`
  }

  async deleteFaceEnrollmentImages(userId: string): Promise<void> {
    for (const key of Array.from(this.objects.keys())) {
      if (key.startsWith(`${userId}/face_`)) {
        this.objects.delete(key)
      }
    }
  }

  async deleteObject(
    _purpose: 'avatar' | 'permit_attachment' | 'face_enrollment' | 'adiwiyata_report',
    path: string,
  ): Promise<void> {
    this.objects.delete(path)
  }

  async getSignedFaceEnrollmentUrl(path: string): Promise<string | null> {
    if (!path) return null
    return `https://storage.local/signed/${encodeURIComponent(path)}?expires=86400`
  }

  async uploadPublicFile(path: string, file: Buffer, contentType: string): Promise<string> {
    this.objects.set(path, { buffer: file, contentType })
    return path
  }

  getPublicUrl(path: string): string {
    return `https://storage.local/public/${encodeURIComponent(path)}`
  }

  async getPresignedUploadUrl(params: {
    bucket?: string
    key: string
    contentType: string
    expiresInSeconds?: number
  }): Promise<string> {
    return `https://storage.local/presigned-upload/${encodeURIComponent(params.key)}?expires=${params.expiresInSeconds ?? 900}`
  }

  async statObject(
    _purpose: 'avatar' | 'permit_attachment' | 'face_enrollment' | 'adiwiyata_report',
    path: string,
  ): Promise<{ sizeBytes: number; contentType: string } | null> {
    const object = this.objects.get(path)
    if (!object) return null
    return { sizeBytes: object.buffer.length, contentType: object.contentType }
  }

  async checkHealth(): Promise<boolean> {
    return this.isHealthy
  }
}
