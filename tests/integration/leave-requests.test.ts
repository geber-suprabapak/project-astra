import { describe, expect, it } from 'vitest'
import {
  createIntegrationEnvironment,
  setupTestUsers,
  tokenFor,
} from './helpers/leave-requests-fixture.js'

describe('Ticket 10 Integration: Submit and View Leave Requests', () => {
  it('Student creates upload intent, uploads attachment, and submits leave request referencing file_id', async () => {
    const { domainStore, objectStorage, identityProvider, app } = createIntegrationEnvironment()
    await setupTestUsers(domainStore, identityProvider)

    const studentToken = tokenFor({
      sub: 'student-1',
      roles: ['student'],
      scope: 'openid profile',
    })

    // 1. Create file upload intent
    const intentRes = await app.request('/v1/mobile/files/upload-intent', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        purpose: 'permit_attachment',
        content_type: 'application/pdf',
        size_bytes: 10240,
      }),
    })

    expect(intentRes.status).toBe(201)
    const intentBody = await intentRes.json()
    expect(intentBody.data.file_id).toBeDefined()
    expect(intentBody.data.upload_url).toBeDefined()
    const fileId = intentBody.data.file_id

    objectStorage.objects.set(intentBody.data.object_path, {
      buffer: Buffer.alloc(10240, 0x25),
      contentType: 'application/pdf',
    })

    // 2. Submit leave request referencing file_id via JSON
    const leaveRes = await app.request('/v1/mobile/leave-requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        category: 'dispensasi',
        description: 'Mengikuti lomba debat bahasa inggris tingkat provinsi',
        date: '2026-08-25',
        file_id: fileId,
      }),
    })

    expect(leaveRes.status).toBe(201)
    const leaveBody = await leaveRes.json()
    expect(leaveBody.data.id).toBeDefined()
    expect(leaveBody.data.category).toBe('dispensasi')
    expect(leaveBody.data.approval_status).toBe('pending')
    expect(leaveBody.data.attachment_url).toContain('https://storage.local/signed/')

    // Verify Astra file lifecycle is available
    const fileRecord = await domainStore.getFileRecord(fileId)
    expect(fileRecord?.lifecycle).toBe('available')
  })

  it('Student submits leave request with multipart form data and file attachment', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupTestUsers(domainStore, identityProvider)

    const studentToken = tokenFor({
      sub: 'student-1',
      roles: ['student'],
      scope: 'openid profile',
    })

    const formData = new FormData()
    formData.append('category', 'sakit')
    formData.append('description', 'Demam tinggi dan batuk berdahak')
    formData.append('date', '2026-08-22')
    formData.append(
      'attachment',
      new Blob(['fake-image-bytes'], { type: 'image/jpeg' }),
      'doctor_note.jpg',
    )

    const res = await app.request('/v1/mobile/permits', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
      },
      body: formData,
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.id).toBeDefined()
    expect(body.data.category).toBe('sakit')
    expect(body.data.approval_status).toBe('pending')
    expect(body.data.attachment_url).toContain('https://storage.local/signed/')

    // Verify file record was recorded in Astra files table
    const files = await domainStore.listFiles({ userId: 'student-1', purpose: 'permit_attachment' })
    expect(files.length).toBeGreaterThan(0)
  })

  it('Pending or unapproved student is forbidden from submitting or viewing leave requests', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupTestUsers(domainStore, identityProvider)

    const pendingToken = tokenFor({
      sub: 'student-pending',
      roles: ['student'],
      scope: 'openid profile',
    })

    // 1. Submit attempt
    const postRes = await app.request('/v1/mobile/leave-requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pendingToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        category: 'sakit',
        description: 'Sakit gigi tidak bisa masuk',
        date: '2026-08-22',
      }),
    })
    expect(postRes.status).toBe(403)
    const postBody = await postRes.json()
    expect(postBody.error.code).toBe('FORBIDDEN')

    // 2. List attempt
    const getRes = await app.request('/v1/mobile/leave-requests', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${pendingToken}`,
      },
    })
    expect(getRes.status).toBe(403)
  })

  it('Student can list only their own leave requests and cannot view another student leave request', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupTestUsers(domainStore, identityProvider)

    const student1Token = tokenFor({
      sub: 'student-1',
      roles: ['student'],
      scope: 'openid profile',
    })
    const student2Token = tokenFor({
      sub: 'student-2',
      roles: ['student'],
      scope: 'openid profile',
    })

    // Create leave request for student 1
    const s1Res = await app.request('/v1/mobile/permits', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${student1Token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        category: 'sakit',
        description: 'Sakit flu berat hari pertama',
        date: '2026-08-21',
      }),
    })
    const s1Body = await s1Res.json()
    const s1PermitId = s1Body.data.id

    // Create leave request for student 2
    await app.request('/v1/mobile/permits', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${student2Token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        category: 'pergi',
        description: 'Acara pernikahan kakak kandung',
        date: '2026-08-21',
      }),
    })

    // Student 1 lists permits -> receives only 1
    const listRes = await app.request('/v1/mobile/permits', {
      method: 'GET',
      headers: { Authorization: `Bearer ${student1Token}` },
    })
    expect(listRes.status).toBe(200)
    const listBody = await listRes.json()
    expect(listBody.data.items).toHaveLength(1)
    expect(listBody.data.items[0].id).toBe(s1PermitId)

    // Student 1 views their own permit -> 200
    const singleRes = await app.request(`/v1/mobile/permits/${s1PermitId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${student1Token}` },
    })
    expect(singleRes.status).toBe(200)

    // Student 2 tries to view student 1 permit -> 403 FORBIDDEN
    const forbiddenRes = await app.request(`/v1/mobile/permits/${s1PermitId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${student2Token}` },
    })
    expect(forbiddenRes.status).toBe(403)
  })

  it('allows only one concurrent pending request for a student', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupTestUsers(domainStore, identityProvider)
    const studentToken = tokenFor({ sub: 'student-1', roles: ['student'], scope: 'openid profile' })
    const request = (date: string) =>
      app.request('/v1/mobile/leave-requests', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${studentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ category: 'pergi', description: 'Permohonan bersamaan', date }),
      })

    const responses = await Promise.all([request('2026-09-01'), request('2026-09-02')])
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409])
    const items = await domainStore.listLeaveRequests({ userId: 'student-1' })
    expect(items).toHaveLength(1)
  })

  it('lists leave periods that overlap the inclusive range in WIB', async () => {
    const { domainStore, identityProvider, app } = createIntegrationEnvironment()
    await setupTestUsers(domainStore, identityProvider)

    const crossMonth = await domainStore.createLeaveRequest({
      user_id: 'student-1',
      category: 'sakit',
      description: 'Sakit lintas bulan',
      date: '2026-08-25',
      approval_status: 'pending',
    })
    await domainStore.updateLeaveRequestStatus({
      id: crossMonth.id,
      approvalStatus: 'approved',
      durationDays: 12,
    })

    const wibBoundary = await domainStore.createLeaveRequest({
      user_id: 'student-2',
      category: 'pergi',
      description: 'Izin mulai 1 September WIB',
      date: '2026-08-31T17:00:00.000Z',
      approval_status: 'approved',
    })
    const afterRange = await domainStore.createLeaveRequest({
      user_id: 'student-2',
      category: 'pergi',
      description: 'Izin setelah rentang',
      date: '2026-10-01',
      approval_status: 'approved',
    })

    domainStore.permits.push({
      id: 'legacy-one-day',
      user_id: 'student-1',
      kategori_izin: 'lainnya',
      deskripsi: 'Legacy one-day leave',
      status: true,
      link_foto: null,
      tanggal: '2026-09-15',
      approval_status: 'approved',
      created_at: '2026-09-15T00:00:00.000Z',
    })

    const adminToken = tokenFor({
      sub: 'admin-1',
      roles: ['school_admin'],
      scope: 'openid profile admin:read leave:read',
      mfa_verified: true,
      must_change_password: false,
    })
    const response = await app.request(
      '/v1/admin/leave-requests?start_date=2026-09-01&end_date=2026-09-30',
      { headers: { Authorization: `Bearer ${adminToken}` } },
    )

    expect(response.status).toBe(200)
    const ids = (await response.json()).data.map((item: { id: string }) => item.id)
    expect(ids).toEqual(expect.arrayContaining([crossMonth.id, wibBoundary.id, 'legacy-one-day']))
    expect(ids).not.toContain(afterRange.id)
  })
})
