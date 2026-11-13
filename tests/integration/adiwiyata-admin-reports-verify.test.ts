import { describe, expect, it } from 'vitest'
import {
  adminNoPhotosToken,
  adminToken,
  classId,
  createEnvironment,
  foreignSiteId,
  otherSchoolClassId,
  reportAt,
  reportDate,
  request,
  schoolId,
  seedReport,
  siteId,
} from './helpers/adiwiyata-admin-reports-fixture.js'

describe('Adiwiyata admin report verification & concurrency', () => {
  it('audits verify/unverify idempotently and reports whether any photo remains verified', async () => {
    const { app, domainStore } = createEnvironment()
    const firstId = 'e0000000-0000-0000-0000-000000000001'
    const secondId = 'e0000000-0000-0000-0000-000000000002'
    seedReport(domainStore, { id: firstId, userId: 'report-student' })
    seedReport(domainStore, { id: secondId, userId: 'report-student-2' })

    const verifyFirst = await request(
      app,
      `/v1/admin/adiwiyata/reports/${firstId}/verify`,
      adminNoPhotosToken,
      'POST',
    )
    expect(verifyFirst.status).toBe(200)
    expect((await verifyFirst.json()).data).toMatchObject({
      report: { id: firstId, verified_by: 'report-admin' },
      coverage_status: 'verified',
    })
    expect(domainStore.auditLogs).toHaveLength(1)
    expect(domainStore.auditLogs[0]).toMatchObject({
      actor_id: 'report-admin',
      action: 'verify',
      entity_type: 'adiwiyata_report',
      entity_id: firstId,
      details: {
        prior_verified_at: null,
        prior_verified_by: null,
        next_verified_by: 'report-admin',
      },
    })

    await request(app, `/v1/admin/adiwiyata/reports/${firstId}/verify`, adminToken, 'POST')
    expect(domainStore.auditLogs).toHaveLength(1)
    const verifySecond = await request(
      app,
      `/v1/admin/adiwiyata/reports/${secondId}/verify`,
      adminToken,
      'POST',
    )
    expect((await verifySecond.json()).data.coverage_status).toBe('verified')
    const unverifyFirst = await request(
      app,
      `/v1/admin/adiwiyata/reports/${firstId}/unverify`,
      adminToken,
      'POST',
    )
    expect((await unverifyFirst.json()).data.coverage_status).toBe('verified')
    const unverifySecond = await request(
      app,
      `/v1/admin/adiwiyata/reports/${secondId}/unverify`,
      adminToken,
      'POST',
    )
    expect((await unverifySecond.json()).data.coverage_status).toBe('reported')
    await request(app, `/v1/admin/adiwiyata/reports/${secondId}/unverify`, adminToken, 'POST')
    expect(domainStore.auditLogs).toHaveLength(4)
    expect(domainStore.adiwiyataReports.get(secondId)).toMatchObject({
      verified_at: null,
      verified_by: null,
    })
  })

  it('shares the upload pair lock with verification and closes later uploads', async () => {
    const { domainStore } = createEnvironment()
    const firstId = 'e0000000-0000-0000-0000-000000000003'
    seedReport(domainStore, { id: firstId, userId: 'report-student' })
    const fileId = 'f0000000-0000-0000-0000-000000000004'
    domainStore.files.set(fileId, {
      id: fileId,
      user_id: 'report-student-2',
      purpose: 'adiwiyata_report',
      object_path: `reports/${fileId}.jpg`,
      content_type: 'image/jpeg',
      size_bytes: 512,
      lifecycle: 'pending_upload',
      created_at: reportAt,
      updated_at: reportAt,
    })

    const upload = domainStore.submitAdiwiyataReport({
      reportId: 'e0000000-0000-0000-0000-000000000004',
      userId: 'report-student-2',
      siteId,
      classId,
      profileName: 'Siswa Dua',
      className: 'XII RPL 1',
      reportDate,
      createdAt: reportAt,
      fileId,
      fileSizeBytes: 512,
    })
    const verify = domainStore.updateAdiwiyataReportVerification({
      reportId: firstId,
      schoolId,
      actorId: 'report-admin',
      verified: true,
      at: reportAt,
    })
    const [uploaded, verified] = await Promise.all([upload, verify])
    expect(uploaded.id).toBe('e0000000-0000-0000-0000-000000000004')
    expect(verified?.coverage_status).toBe('verified')
    expect(domainStore.adiwiyataReports.size).toBe(2)

    const rejectedFileId = 'f0000000-0000-0000-0000-000000000005'
    domainStore.files.set(rejectedFileId, {
      id: rejectedFileId,
      user_id: 'report-student-3',
      purpose: 'adiwiyata_report',
      object_path: `reports/${rejectedFileId}.jpg`,
      content_type: 'image/jpeg',
      size_bytes: 512,
      lifecycle: 'pending_upload',
      created_at: reportAt,
      updated_at: reportAt,
    })
    await expect(
      domainStore.submitAdiwiyataReport({
        reportId: 'e0000000-0000-0000-0000-000000000005',
        userId: 'report-student-3',
        siteId,
        classId,
        profileName: 'Siswa Tiga',
        className: 'XII RPL 1',
        reportDate,
        createdAt: reportAt,
        fileId: rejectedFileId,
        fileSizeBytes: 512,
      }),
    ).rejects.toMatchObject({ httpStatus: 409 })
  })

  it('rolls back failed verification audit without deleting a concurrent unrelated audit', async () => {
    const { domainStore } = createEnvironment()
    const reportId = 'e0000000-0000-0000-0000-000000000006'
    seedReport(domainStore, { id: reportId, userId: 'report-student' })
    const originalInsert = domainStore.insertAuditLog.bind(domainStore)
    let markEntered!: () => void
    let unblock!: () => void
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      unblock = resolve
    })
    domainStore.insertAuditLog = async (entry) => {
      if (entry.entity_type === 'adiwiyata_report') {
        markEntered()
        await gate
        await originalInsert(entry)
        throw new Error('simulated audit acknowledgment failure')
      }
      return originalInsert(entry)
    }

    const mutation = domainStore.updateAdiwiyataReportVerification({
      reportId,
      schoolId,
      actorId: 'report-admin',
      verified: true,
      at: reportAt,
    })
    await entered
    await originalInsert({
      actor_id: 'other-admin',
      action: 'unrelated',
      entity_type: 'another_entity',
      entity_id: 'unrelated-id',
    })
    unblock()
    await expect(mutation).rejects.toThrow('simulated audit acknowledgment failure')
    expect(domainStore.adiwiyataReports.get(reportId)).toMatchObject({
      verified_at: null,
      verified_by: null,
    })
    expect(domainStore.auditLogs).toHaveLength(1)
    expect(domainStore.auditLogs[0]).toMatchObject({
      actor_id: 'other-admin',
      action: 'unrelated',
      entity_id: 'unrelated-id',
    })
  })

  it('returns not found for a report outside the active school', async () => {
    const { app, domainStore } = createEnvironment()
    const foreignReportId = 'e0000000-0000-0000-0000-000000000007'
    seedReport(domainStore, {
      id: foreignReportId,
      userId: 'report-student',
      siteId: foreignSiteId,
      classId: otherSchoolClassId,
    })
    const response = await request(
      app,
      `/v1/admin/adiwiyata/reports/${foreignReportId}/verify`,
      adminToken,
      'POST',
    )
    expect(response.status).toBe(404)
    expect(domainStore.auditLogs).toHaveLength(0)
  })
})
