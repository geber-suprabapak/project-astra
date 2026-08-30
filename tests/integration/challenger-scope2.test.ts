import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { env } from '../../src/config/env.js'
import { createUploadIntent, getFile, deleteFile } from '../../src/modules/files/service.js'
import { RequestUploadIntentSchema } from '../../src/modules/files/schema.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../src/providers/memory/index.js'
import type { RobinClient } from '../../src/clients/robin/client.js'

function createTestEnv() {
  const domainStore = new MemoryDomainStore()
  const objectStorage = new MemoryObjectStorage()
  const identityProvider = new MemoryIdentityProvider()

  const robinClient: RobinClient = {
    checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
    getEnrollmentStatus: async () => ({
      status: 'enrolled',
      embeddingCount: 10,
      message: 'Ready.',
    }),
    enroll: async () => ({ imagesProcessed: 10, imagesFailed: 0, totalEmbeddings: 10 }),
    identify: async () => ({
      status: 'ok',
      confidence: 0.94,
      qualityScore: 0.91,
      processTimeMs: 38,
      message: 'Face verified successfully',
    }),
    deleteEnrollment: async () => {},
  }

  const providers = {
    domainStore,
    objectStorage,
    identityProvider,
    robinClient,
  }

  const app = createApp({ providers })

  return { domainStore, identityProvider, objectStorage, robinClient, providers, app }
}

async function setupUsers(
  domainStore: MemoryDomainStore,
  identityProvider: MemoryIdentityProvider,
) {
  domainStore.profiles.set('student-1', {
    user_id: 'student-1',
    full_name: 'Approved Student',
    email: 'student1@school.sch.id',
    role: 'student',
    lifecycle_status: 'approved',
  })
  identityProvider.users.set('student-1', {
    userId: 'student-1',
    email: 'student1@school.sch.id',
    roles: ['student'],
    scopes: ['openid', 'profile', 'mobile:access'],
  })

  domainStore.profiles.set('student-pending', {
    user_id: 'student-pending',
    full_name: 'Pending Student',
    email: 'pending@school.sch.id',
    role: 'student',
    lifecycle_status: 'pending',
  })
  identityProvider.users.set('student-pending', {
    userId: 'student-pending',
    email: 'pending@school.sch.id',
    roles: ['student'],
    scopes: ['openid', 'profile', 'mobile:access'],
  })

  domainStore.profiles.set('student-rejected', {
    user_id: 'student-rejected',
    full_name: 'Rejected Student',
    email: 'rejected@school.sch.id',
    role: 'student',
    lifecycle_status: 'rejected',
  })
  identityProvider.users.set('student-rejected', {
    userId: 'student-rejected',
    email: 'rejected@school.sch.id',
    roles: ['student'],
    scopes: ['openid', 'profile', 'mobile:access'],
  })

  domainStore.profiles.set('teacher-1', {
    user_id: 'teacher-1',
    full_name: 'Guru',
    email: 'teacher@school.sch.id',
    role: 'teacher',
    lifecycle_status: 'approved',
  })
  identityProvider.users.set('teacher-1', {
    userId: 'teacher-1',
    email: 'teacher@school.sch.id',
    roles: ['teacher'],
    scopes: ['openid', 'profile', 'mobile:access', 'admin:read'],
  })

  domainStore.profiles.set('admin-1', {
    user_id: 'admin-1',
    full_name: 'Admin',
    email: 'admin@school.sch.id',
    role: 'school_admin',
    lifecycle_status: 'approved',
  })
  identityProvider.users.set('admin-1', {
    userId: 'admin-1',
    email: 'admin@school.sch.id',
    roles: ['school_admin'],
    scopes: [
      'openid',
      'profile',
      'mobile:access',
      'admin:read',
      'files:read:any',
      'files:delete:any',
    ],
    mfaVerified: true,
    mustChangePassword: false,
  })
}

describe('Scope 2 Challenger: Object Storage Intent Routing (ISS-03) Adversarial Suite', () => {
  describe('1. Bucket Intent Resolution Matrix', () => {
    it('routes permit_attachment to env.s3BucketPermits (perizinan)', async () => {
      const envs = createTestEnv()
      await setupUsers(envs.domainStore, envs.identityProvider)

      let capturedBucket: string | undefined

      // Wrap getPresignedUploadUrl to inspect the bucket parameter
      const originalGetPresigned = envs.objectStorage.getPresignedUploadUrl.bind(envs.objectStorage)
      envs.objectStorage.getPresignedUploadUrl = async (params) => {
        capturedBucket = params.bucket
        return originalGetPresigned(params)
      }

      const result = await createUploadIntent({
        userId: 'student-1',
        purpose: 'permit_attachment',
        contentType: 'application/pdf',
        sizeBytes: 1024,
        providers: envs.providers,
      })

      expect(result.file_id).toBeDefined()
      expect(result.purpose).toBe('permit_attachment')
      expect(capturedBucket).toBe(env.s3BucketPermits)
      expect(capturedBucket).toBe('perizinan')
    })

    it('routes avatar to env.s3BucketAvatars (avatars)', async () => {
      const envs = createTestEnv()
      await setupUsers(envs.domainStore, envs.identityProvider)

      let capturedBucket: string | undefined
      envs.objectStorage.getPresignedUploadUrl = async (params) => {
        capturedBucket = params.bucket
        return `https://storage.local/upload/${encodeURIComponent(params.key)}`
      }

      const result = await createUploadIntent({
        userId: 'student-1',
        purpose: 'avatar',
        contentType: 'image/jpeg',
        sizeBytes: 1024,
        providers: envs.providers,
      })

      expect(result.file_id).toBeDefined()
      expect(result.purpose).toBe('avatar')
      expect(capturedBucket).toBe(env.s3BucketAvatars)
      expect(capturedBucket).toBe('avatars')
    })

    it('routes face_enrollment to env.s3BucketAvatars (avatars)', async () => {
      const envs = createTestEnv()
      await setupUsers(envs.domainStore, envs.identityProvider)

      let capturedBucket: string | undefined
      envs.objectStorage.getPresignedUploadUrl = async (params) => {
        capturedBucket = params.bucket
        return `https://storage.local/upload/${encodeURIComponent(params.key)}`
      }

      const result = await createUploadIntent({
        userId: 'student-1',
        purpose: 'face_enrollment',
        contentType: 'image/jpeg',
        sizeBytes: 1024,
        providers: envs.providers,
      })

      expect(result.file_id).toBeDefined()
      expect(result.purpose).toBe('face_enrollment')
      expect(capturedBucket).toBe(env.s3BucketAvatars)
      expect(capturedBucket).toBe('avatars')
    })
  })

  describe('2. Purpose Schema Validation & Invalid Purpose Rejection', () => {
    const validPurposes = ['avatar', 'permit_attachment', 'face_enrollment']
    for (const p of validPurposes) {
      it(`accepts valid purpose '${p}'`, () => {
        const parsed = RequestUploadIntentSchema.safeParse({
          purpose: p,
          content_type: 'image/jpeg',
        })
        expect(parsed.success).toBe(true)
      })
    }

    const invalidPurposes = [
      'document',
      'other',
      'permits',
      'file',
      'PERMIT_ATTACHMENT',
      'avatar ',
      ' ',
      '',
      null,
      undefined,
      123,
    ]
    for (const p of invalidPurposes) {
      it(`rejects invalid purpose '${String(p)}'`, () => {
        const parsed = RequestUploadIntentSchema.safeParse({
          purpose: p,
          content_type: 'image/jpeg',
        })
        expect(parsed.success).toBe(false)
      })
    }
  })

  describe('3. Content-Type and Size Constraints Per Purpose', () => {
    it('enforces MIME types and 5MB limit for permit_attachment', async () => {
      const envs = createTestEnv()
      await setupUsers(envs.domainStore, envs.identityProvider)

      // Valid: image/jpeg, image/png, application/pdf
      for (const mime of ['image/jpeg', 'image/png', 'application/pdf']) {
        const res = await createUploadIntent({
          userId: 'student-1',
          purpose: 'permit_attachment',
          contentType: mime,
          sizeBytes: 5 * 1024 * 1024,
          providers: envs.providers,
        })
        expect(res.file_id).toBeDefined()
      }

      // Invalid MIME: image/webp, text/plain, video/mp4
      for (const mime of ['image/webp', 'text/plain', 'video/mp4']) {
        await expect(
          createUploadIntent({
            userId: 'student-1',
            purpose: 'permit_attachment',
            contentType: mime,
            providers: envs.providers,
          }),
        ).rejects.toThrow(/(Validation failed|Invalid permit attachment)/)
      }

      // Oversize: 5MB + 1 byte
      await expect(
        createUploadIntent({
          userId: 'student-1',
          purpose: 'permit_attachment',
          contentType: 'image/jpeg',
          sizeBytes: 5 * 1024 * 1024 + 1,
          providers: envs.providers,
        }),
      ).rejects.toThrow(/(Validation failed|exceeds 5MB)/)
    })

    it('enforces MIME types and 5MB limit for avatar', async () => {
      const envs = createTestEnv()
      await setupUsers(envs.domainStore, envs.identityProvider)

      // Valid: image/jpeg, image/png, image/webp
      for (const mime of ['image/jpeg', 'image/png', 'image/webp']) {
        const res = await createUploadIntent({
          userId: 'student-1',
          purpose: 'avatar',
          contentType: mime,
          sizeBytes: 5 * 1024 * 1024,
          providers: envs.providers,
        })
        expect(res.file_id).toBeDefined()
      }

      // Invalid MIME: application/pdf, text/plain
      for (const mime of ['application/pdf', 'text/plain']) {
        await expect(
          createUploadIntent({
            userId: 'student-1',
            purpose: 'avatar',
            contentType: mime,
            providers: envs.providers,
          }),
        ).rejects.toThrow(/(Validation failed|Invalid avatar)/)
      }

      // Oversize: 5MB + 1 byte
      await expect(
        createUploadIntent({
          userId: 'student-1',
          purpose: 'avatar',
          contentType: 'image/jpeg',
          sizeBytes: 5 * 1024 * 1024 + 1,
          providers: envs.providers,
        }),
      ).rejects.toThrow(/(Validation failed|exceeds 5MB)/)
    })

    it('enforces MIME types, 2MB limit, and student-only role for face_enrollment', async () => {
      const envs = createTestEnv()
      await setupUsers(envs.domainStore, envs.identityProvider)

      // Valid for student
      const res = await createUploadIntent({
        userId: 'student-1',
        purpose: 'face_enrollment',
        contentType: 'image/jpeg',
        sizeBytes: 2 * 1024 * 1024,
        providers: envs.providers,
      })
      expect(res.file_id).toBeDefined()

      // Invalid MIME: image/png
      await expect(
        createUploadIntent({
          userId: 'student-1',
          purpose: 'face_enrollment',
          contentType: 'image/png',
          providers: envs.providers,
        }),
      ).rejects.toThrow(/(Validation failed|Invalid face enrollment)/)

      // Oversize: 2MB + 1 byte
      await expect(
        createUploadIntent({
          userId: 'student-1',
          purpose: 'face_enrollment',
          contentType: 'image/jpeg',
          sizeBytes: 2 * 1024 * 1024 + 1,
          providers: envs.providers,
        }),
      ).rejects.toThrow(/(Validation failed|exceeds 2MB)/)

      // Non-student role (teacher) requesting face_enrollment
      await expect(
        createUploadIntent({
          userId: 'teacher-1',
          purpose: 'face_enrollment',
          contentType: 'image/jpeg',
          providers: envs.providers,
        }),
      ).rejects.toThrow(/Only students can request face enrollment/)
    })
  })

  describe('4. Lifecycle Gating & Download URL Resolution', () => {
    it('forbids upload intent for pending or rejected user lifecycle', async () => {
      const envs = createTestEnv()
      await setupUsers(envs.domainStore, envs.identityProvider)

      await expect(
        createUploadIntent({
          userId: 'student-pending',
          purpose: 'avatar',
          contentType: 'image/jpeg',
          providers: envs.providers,
        }),
      ).rejects.toThrow(/Only approved users can request upload intents/)

      await expect(
        createUploadIntent({
          userId: 'student-rejected',
          purpose: 'avatar',
          contentType: 'image/jpeg',
          providers: envs.providers,
        }),
      ).rejects.toThrow(/Only approved users can request upload intents/)
    })

    it('resolves signed download URLs per purpose correctly via getFile', async () => {
      const envs = createTestEnv()
      await setupUsers(envs.domainStore, envs.identityProvider)

      // 1. Permit attachment
      const permitFile = await envs.domainStore.createFileRecord({
        userId: 'student-1',
        purpose: 'permit_attachment',
        objectPath: 'student-1/permit_signed_test.pdf',
        contentType: 'application/pdf',
        sizeBytes: 2048,
        lifecycle: 'available',
      })

      const permitResult = await getFile({
        userId: 'student-1',
        fileId: permitFile.id,
        providers: envs.providers,
      })
      expect(permitResult.file.id).toBe(permitFile.id)
      expect(permitResult.download_url).toContain(
        'https://storage.local/signed/student-1%2Fpermit_signed_test.pdf',
      )

      // 2. Avatar
      const avatarFile = await envs.domainStore.createFileRecord({
        userId: 'student-1',
        purpose: 'avatar',
        objectPath: 'student-1/avatar_test.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 1024,
        lifecycle: 'available',
      })

      const avatarResult = await getFile({
        userId: 'student-1',
        fileId: avatarFile.id,
        providers: envs.providers,
      })
      expect(avatarResult.file.id).toBe(avatarFile.id)
      expect(avatarResult.download_url).toContain(
        'https://storage.local/signed/student-1%2Favatar_test.jpg',
      )

      // 3. Face enrollment
      const faceFile = await envs.domainStore.createFileRecord({
        userId: 'student-1',
        purpose: 'face_enrollment',
        objectPath: 'student-1/face_test.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 1024,
        lifecycle: 'available',
      })

      const faceResult = await getFile({
        userId: 'student-1',
        fileId: faceFile.id,
        providers: envs.providers,
      })
      expect(faceResult.file.id).toBe(faceFile.id)
      expect(faceResult.download_url).toContain(
        'https://storage.local/signed/student-1%2Fface_test.jpg',
      )
    })

    it('denies non-owner without privileged scope and allows privileged admin to get and delete files', async () => {
      const envs = createTestEnv()
      await setupUsers(envs.domainStore, envs.identityProvider)

      const file = await envs.domainStore.createFileRecord({
        userId: 'student-1',
        purpose: 'permit_attachment',
        objectPath: 'student-1/secret.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1024,
        lifecycle: 'available',
      })

      // Non-owner without scope (teacher-1) -> throws forbidden
      await expect(
        getFile({
          userId: 'teacher-1',
          fileId: file.id,
          userScopes: ['openid', 'profile'],
          providers: envs.providers,
        }),
      ).rejects.toThrow(/do not have permission to view this file/)

      // Privileged admin with files:read:any -> succeeds
      const adminView = await getFile({
        userId: 'admin-1',
        fileId: file.id,
        userScopes: ['openid', 'profile', 'files:read:any'],
        providers: envs.providers,
      })
      expect(adminView.file.id).toBe(file.id)

      // Privileged admin with files:delete:any -> deletes successfully
      await deleteFile({
        userId: 'admin-1',
        fileId: file.id,
        userScopes: ['openid', 'profile', 'files:delete:any'],
        providers: envs.providers,
      })

      // Deleted file is gone
      await expect(
        getFile({
          userId: 'student-1',
          fileId: file.id,
          providers: envs.providers,
        }),
      ).rejects.toThrow(/(File not found|no longer available)/i)
    })
  })
})
