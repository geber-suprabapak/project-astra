import { describe, it, expect, vi } from 'vitest'
import {
  createUploadIntent,
  confirmFileUpload,
  getFile,
  deleteFile,
} from '../../../src/modules/files/service.js'
import { ErrorCode } from '../../../src/lib/errors/codes.js'
import { createFilesTestProviders } from './files-service-harness.js'

describe('files service — getFile and deleteFile', () => {
  it('authorizes file download for owner and privileged staff', async () => {
    const providers = createFilesTestProviders()
    const intent = await createUploadIntent({
      userId: 'student-1',
      purpose: 'avatar',
      contentType: 'image/jpeg',
      providers,
    })
    providers.objectStorage.objects.set(intent.object_path, {
      buffer: Buffer.from('uploaded-bytes'),
      contentType: 'image/jpeg',
    })
    await confirmFileUpload({
      userId: 'student-1',
      fileId: intent.file_id,
      providers,
    })

    const ownerView = await getFile({
      userId: 'student-1',
      fileId: intent.file_id,
      userScopes: [],
      providers,
    })
    expect(ownerView.file.id).toBe(intent.file_id)
    expect(ownerView.download_url).toBeDefined()

    const staffView = await getFile({
      userId: 'staff-1',
      fileId: intent.file_id,
      userScopes: ['files:read:any'],
      providers,
    })
    expect(staffView.file.id).toBe(intent.file_id)
  })

  it('denies download for a pending file instead of issuing a URL', async () => {
    const providers = createFilesTestProviders()
    const intent = await createUploadIntent({
      userId: 'student-1',
      purpose: 'avatar',
      contentType: 'image/jpeg',
      providers,
    })
    providers.objectStorage.objects.set(intent.object_path, {
      buffer: Buffer.from('uploaded-bytes'),
      contentType: 'image/jpeg',
    })

    await expect(
      getFile({ userId: 'student-1', fileId: intent.file_id, userScopes: [], providers }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })

    const record = await providers.domainStore.getFileRecord(intent.file_id)
    expect(record?.lifecycle).toBe('pending_upload')
  })

  it('denies download for a rejected file', async () => {
    const providers = createFilesTestProviders()
    const intent = await createUploadIntent({
      userId: 'student-1',
      purpose: 'avatar',
      contentType: 'image/jpeg',
      sizeBytes: 1000,
      providers,
    })
    providers.objectStorage.objects.set(intent.object_path, {
      buffer: Buffer.alloc(512),
      contentType: 'image/jpeg',
    })
    await expect(
      confirmFileUpload({ userId: 'student-1', fileId: intent.file_id, providers }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })

    await expect(
      getFile({ userId: 'student-1', fileId: intent.file_id, userScopes: [], providers }),
    ).rejects.toMatchObject({ code: ErrorCode.RESOURCE_NOT_FOUND })
  })

  it('deletes file and marks lifecycle as deleted', async () => {
    const providers = createFilesTestProviders()
    const intent = await createUploadIntent({
      userId: 'student-1',
      purpose: 'avatar',
      contentType: 'image/jpeg',
      providers,
    })
    providers.objectStorage.objects.set(intent.object_path, {
      buffer: Buffer.from('fixture'),
      contentType: 'image/jpeg',
    })
    await confirmFileUpload({
      userId: 'student-1',
      fileId: intent.file_id,
      providers,
    })

    await deleteFile({
      userId: 'student-1',
      fileId: intent.file_id,
      userScopes: [],
      providers,
    })

    const record = await providers.domainStore.getFileRecord(intent.file_id)
    expect(record?.lifecycle).toBe('deleted')
    expect(providers.objectStorage.objects.has(intent.object_path)).toBe(false)
  })

  it('allows only an owner or an approved Astra administrator with scope to read Adiwiyata evidence', async () => {
    const providers = createFilesTestProviders()
    providers.domainStore.profiles.set('teacher-1', {
      user_id: 'teacher-1',
      full_name: 'Teacher',
      role: 'teacher',
      lifecycle_status: 'approved',
    })
    providers.domainStore.profiles.set('school-admin-1', {
      user_id: 'school-admin-1',
      full_name: 'School Admin',
      role: 'school_admin',
      lifecycle_status: 'approved',
    })
    providers.domainStore.profiles.set('platform-admin-pending', {
      user_id: 'platform-admin-pending',
      full_name: 'Pending Admin',
      role: 'platform_admin',
      lifecycle_status: 'pending',
    })
    const file = await providers.domainStore.createFileRecord({
      userId: 'student-1',
      purpose: 'adiwiyata_report',
      objectPath: 'reports/private.jpg',
      contentType: 'image/jpeg',
      lifecycle: 'available',
    })

    providers.objectStorage.getSignedAdiwiyataReportUrl = async () =>
      'https://storage.local/private'
    const owner = await getFile({ userId: 'student-1', fileId: file.id, providers })
    expect(owner.download_url).toBe('https://storage.local/private')

    await expect(
      getFile({
        userId: 'teacher-1',
        fileId: file.id,
        userScopes: ['files:read:any'],
        providers,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN })
    await expect(
      getFile({
        userId: 'school-admin-1',
        fileId: file.id,
        userScopes: ['files:read:any'],
        providers,
      }),
    ).resolves.toMatchObject({
      file: { id: file.id },
      download_url: 'https://storage.local/private',
    })
    await expect(
      getFile({
        userId: 'platform-admin-pending',
        fileId: file.id,
        userScopes: ['files:read:any'],
        providers,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN })
  })

  it('does not issue a report URL after the file retention deadline', async () => {
    const providers = createFilesTestProviders()
    const file = await providers.domainStore.createFileRecord({
      userId: 'student-1',
      purpose: 'adiwiyata_report',
      objectPath: 'reports/expired.jpg',
      contentType: 'image/jpeg',
      lifecycle: 'available',
    })
    providers.domainStore.files.get(file.id)!.created_at = '2024-01-01T00:00:00.000Z'
    const signedUrl = vi.fn(async () => 'https://storage.local/expired')
    providers.objectStorage.getSignedAdiwiyataReportUrl = signedUrl

    const result = await getFile({ userId: 'student-1', fileId: file.id, providers })

    expect(result.download_url).toBeNull()
    expect(signedUrl).not.toHaveBeenCalled()
  })

  it('caps a photo URL at the exact 365-day file deadline and preserves metadata afterward', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const providers = createFilesTestProviders()
      const file = await providers.domainStore.createFileRecord({
        userId: 'student-1',
        purpose: 'adiwiyata_report',
        objectPath: 'reports/deadline.jpg',
        contentType: 'image/jpeg',
        lifecycle: 'available',
      })
      providers.domainStore.files.get(file.id)!.created_at = '2025-09-30T00:00:00.000Z'
      const signedUrl = vi.fn(async () => 'https://storage.local/bounded')
      providers.objectStorage.getSignedAdiwiyataReportUrl = signedUrl
      vi.setSystemTime(new Date('2026-09-29T23:59:58.500Z'))
      expect(
        (await getFile({ userId: 'student-1', fileId: file.id, providers })).download_url,
      ).toBe('https://storage.local/bounded')
      expect(signedUrl).toHaveBeenLastCalledWith(file.object_path, 1)
      vi.setSystemTime(new Date('2026-09-30T00:00:00.000Z'))
      const expired = await getFile({ userId: 'student-1', fileId: file.id, providers })
      expect(expired.download_url).toBeNull()
      expect(expired.file.lifecycle).toBe('available')
      expect(signedUrl).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
