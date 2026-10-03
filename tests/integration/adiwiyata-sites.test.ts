import { describe, expect, it } from 'vitest'
import type { JWTPayload } from 'jose'
import type { RobinClient } from '../../src/clients/robin/client.js'
import { createApp } from '../../src/app.js'
import { createAdiwiyataRouter } from '../../src/modules/adiwiyata/routes.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../src/providers/memory/index.js'
import type { Schedule } from '../../src/providers/types.js'

const schoolId = '11111111-1111-1111-1111-111111111111'
const otherSchoolId = '22222222-2222-2222-2222-222222222222'
const periodId = 'b0000000-0000-0000-0000-000000000001'
const previousPeriodId = 'b0000000-0000-0000-0000-000000000002'
const classId = 'c0000000-0000-0000-0000-000000000001'
const nextClassId = 'c0000000-0000-0000-0000-000000000002'
const previousClassId = 'c0000000-0000-0000-0000-000000000003'
const otherSchoolClassId = 'c0000000-0000-0000-0000-000000000004'
const activeSiteId = 'd0000000-0000-0000-0000-000000000001'
const oldSiteId = 'd0000000-0000-0000-0000-000000000002'
const wibWednesday = new Date('2026-09-29T20:00:00.000Z')

function tokenFor(payload: JWTPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${encodedPayload}.signature`
}

function schedule(): Schedule {
  return {
    id: 'schedule-1',
    school_id: schoolId,
    class_id: classId,
    academic_period_id: periodId,
    day_of_week: 'rabu',
    hari: 'rabu',
    mulai_masuk: '06:00:00',
    selesai_masuk: '07:00:00',
    mulai_pulang: '12:00:00',
    selesai_pulang: '14:00:00',
    kompensasi_waktu: 0,
    is_active: true,
  }
}

function createEnvironment() {
  const domainStore = new MemoryDomainStore()
  domainStore.academicPeriods = [
    {
      id: periodId,
      school_id: schoolId,
      name: 'Tahun Ajaran 2026/2027 Ganjil',
      start_date: '2026-07-01',
      end_date: '2026-12-31',
      is_active: true,
    },
  ]
  domainStore.classes = [
    { id: classId, school_id: schoolId, academic_period_id: periodId, name: 'XII RPL 1' },
    { id: nextClassId, school_id: schoolId, academic_period_id: periodId, name: 'XII RPL 2' },
    {
      id: previousClassId,
      school_id: schoolId,
      academic_period_id: previousPeriodId,
      name: 'XII RPL 2',
    },
    {
      id: otherSchoolClassId,
      school_id: otherSchoolId,
      academic_period_id: periodId,
      name: 'XII RPL 2',
    },
  ]
  domainStore.profiles.set('site-admin', {
    user_id: 'site-admin',
    full_name: 'Admin Sekolah',
    role: 'school_admin',
    lifecycle_status: 'approved',
  })
  domainStore.profiles.set('site-platform-admin', {
    user_id: 'site-platform-admin',
    full_name: 'Platform Admin',
    role: 'platform_admin',
    lifecycle_status: 'approved',
  })
  domainStore.profiles.set('site-student', {
    user_id: 'site-student',
    full_name: 'Siswa Contoh',
    role: 'student',
    lifecycle_status: 'approved',
  })
  domainStore.profiles.set('site-pending-admin', {
    user_id: 'site-pending-admin',
    full_name: 'Admin Belum Disetujui',
    role: 'school_admin',
    lifecycle_status: 'pending',
  })
  domainStore.classEnrollments = [
    {
      id: 'enrollment-1',
      user_id: 'site-student',
      class_id: classId,
      academic_period_id: periodId,
      status: 'active',
    },
  ]
  domainStore.adiwiyataEligibility.set('site-student', {
    id: 'eligibility-1',
    user_id: 'site-student',
    added_by: 'site-admin',
    is_active: true,
  })
  domainStore.schedules.clear()
  domainStore.schedules.set('schedule-1', schedule())
  domainStore.adiwiyataSites.set(activeSiteId, {
    id: activeSiteId,
    school_id: schoolId,
    name: 'Kebun Kelas',
    category: 'tanaman',
    class_id: classId,
    is_active: true,
    sort_order: 3,
    created_by: 'site-admin',
  })
  domainStore.adiwiyataSites.set(oldSiteId, {
    id: oldSiteId,
    school_id: schoolId,
    name: 'Kebun Periode Lama',
    category: 'tanaman',
    class_id: previousClassId,
    is_active: true,
    sort_order: 4,
    created_by: 'site-admin',
  })
  domainStore.adiwiyataSites.set('d0000000-0000-0000-0000-000000000003', {
    id: 'd0000000-0000-0000-0000-000000000003',
    school_id: schoolId,
    name: 'Site Nonaktif',
    category: 'lele',
    class_id: null,
    is_active: false,
    sort_order: 5,
    created_by: 'site-admin',
  })
  domainStore.adiwiyataSites.set('d0000000-0000-0000-0000-000000000004', {
    id: 'd0000000-0000-0000-0000-000000000004',
    school_id: otherSchoolId,
    name: 'Sekolah Lain',
    category: 'lele',
    class_id: null,
    is_active: true,
    sort_order: 0,
    created_by: 'site-admin',
  })
  domainStore.adiwiyataSites.set('d0000000-0000-0000-0000-000000000005', {
    id: 'd0000000-0000-0000-0000-000000000005',
    school_id: schoolId,
    name: 'Titik Umum',
    category: 'lele',
    class_id: null,
    is_active: true,
    sort_order: 1,
    created_by: 'site-admin',
  })

  const identityProvider = new MemoryIdentityProvider()
  const providers = {
    domainStore,
    objectStorage: new MemoryObjectStorage(),
    identityProvider,
    robinClient: {
      checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
      getEnrollmentStatus: async () => ({
        status: 'enrolled' as const,
        embeddingCount: 1,
        message: 'Ready.',
      }),
      enroll: async () => ({ imagesProcessed: 1, imagesFailed: 0, totalEmbeddings: 1 }),
      identify: async () => ({
        status: 'ok' as const,
        confidence: 0.9,
        qualityScore: 0.9,
        processTimeMs: 1,
      }),
      deleteEnrollment: async () => {},
    } satisfies RobinClient,
  }
  const app = createApp({
    providers,
    adiwiyataRouter: createAdiwiyataRouter({ providers, now: () => wibWednesday }),
  })
  return { app, domainStore }
}

const adminToken = tokenFor({
  sub: 'site-admin',
  roles: ['school_admin'],
  scope: 'openid profile mobile:access admin:read',
})
const platformAdminToken = tokenFor({
  sub: 'site-platform-admin',
  roles: ['platform_admin'],
  scope: 'openid profile mobile:access admin:read',
})
const adminWithoutScopeToken = tokenFor({
  sub: 'site-admin',
  roles: ['school_admin'],
  scope: 'openid profile mobile:access',
})
const studentAdminScopeToken = tokenFor({
  sub: 'site-student',
  roles: ['school_admin'],
  scope: 'openid profile mobile:access admin:read',
})
const pendingAdminToken = tokenFor({
  sub: 'site-pending-admin',
  roles: ['school_admin'],
  scope: 'openid profile mobile:access admin:read',
})
const studentToken = tokenFor({
  sub: 'site-student',
  roles: ['student'],
  scope: 'openid profile mobile:access',
})

async function request(
  app: ReturnType<typeof createApp>,
  path: string,
  token?: string,
  method = 'GET',
  body?: Record<string, string | number | boolean | null>,
) {
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const init: RequestInit = { method, headers }
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json')
    init.body = JSON.stringify(body)
  }
  return app.request(path, init)
}

describe('integration: Adiwiyata Site management', () => {
  it('requires admin:read and an approved Astra admin profile', async () => {
    const { app } = createEnvironment()
    expect((await request(app, '/v1/admin/adiwiyata/sites')).status).toBe(401)
    expect((await request(app, '/v1/admin/adiwiyata/sites', adminWithoutScopeToken)).status).toBe(
      403,
    )
    expect((await request(app, '/v1/admin/adiwiyata/sites', studentAdminScopeToken)).status).toBe(
      403,
    )
    expect((await request(app, '/v1/admin/adiwiyata/sites', pendingAdminToken)).status).toBe(403)
    expect(
      (
        await request(app, '/v1/admin/adiwiyata/sites', studentAdminScopeToken, 'POST', {
          name: 'Tidak boleh',
          category: 'tanaman',
          sort_order: 0,
        })
      ).status,
    ).toBe(403)
    expect((await request(app, '/v1/admin/adiwiyata/sites', platformAdminToken)).status).toBe(200)
  })

  it('creates, orders, and explicitly re-maps sites using current-period classes', async () => {
    const { app } = createEnvironment()
    const list = await request(app, '/v1/admin/adiwiyata/sites', adminToken)
    expect(list.status).toBe(200)
    const initial = await list.json()
    expect(initial.data.academic_period.id).toBe(periodId)
    expect(initial.data.sites.map((site: { id: string }) => site.id)).toEqual([
      'd0000000-0000-0000-0000-000000000005',
      activeSiteId,
      oldSiteId,
      'd0000000-0000-0000-0000-000000000003',
    ])
    expect(initial.data.sites.some((site: { name: string }) => site.name === 'Sekolah Lain')).toBe(
      false,
    )

    const created = await request(app, '/v1/admin/adiwiyata/sites', adminToken, 'POST', {
      name: 'Kebun Baru',
      category: 'tanaman',
      class_id: nextClassId,
      sort_order: 10,
    })
    expect(created.status).toBe(201)
    const createdSite = (await created.json()).data
    expect(createdSite.school_id).toBe(schoolId)
    expect(createdSite.created_by).toBe('site-admin')

    const edited = await request(
      app,
      `/v1/admin/adiwiyata/sites/${oldSiteId}`,
      adminToken,
      'PATCH',
      {
        name: 'Kebun Periode Baru',
        category: 'tanaman',
        class_id: nextClassId,
        sort_order: 1,
      },
    )
    expect(edited.status).toBe(200)
    expect((await edited.json()).data.class_id).toBe(nextClassId)

    const general = await request(
      app,
      `/v1/admin/adiwiyata/sites/${oldSiteId}`,
      adminToken,
      'PATCH',
      {
        class_id: null,
      },
    )
    expect(general.status).toBe(200)
    expect((await general.json()).data.class_id).toBeNull()
    const studentDashboard = await request(app, '/v1/adiwiyata/dashboard', studentToken)
    const visibleSites: Array<{ id: string }> = (await studentDashboard.json()).data.sites
    const visibleSiteIds = visibleSites.map((site) => site.id)
    expect(visibleSiteIds.filter((id) => id === oldSiteId)).toHaveLength(1)

    const oldClass = await request(
      app,
      `/v1/admin/adiwiyata/sites/${oldSiteId}`,
      adminToken,
      'PATCH',
      {
        class_id: previousClassId,
      },
    )
    expect(oldClass.status).toBe(422)
    const wrongSchoolClass = await request(
      app,
      `/v1/admin/adiwiyata/sites/${oldSiteId}`,
      adminToken,
      'PATCH',
      {
        class_id: otherSchoolClassId,
      },
    )
    expect(wrongSchoolClass.status).toBe(422)

    const reordered = await request(
      app,
      `/v1/admin/adiwiyata/sites/${activeSiteId}`,
      adminToken,
      'PATCH',
      {
        sort_order: 0,
      },
    )
    expect(reordered.status).toBe(200)
    const after = await (await request(app, '/v1/admin/adiwiyata/sites', adminToken)).json()
    expect(after.data.sites[0].id).toBe(activeSiteId)
  })

  it('rejects Site validation errors and an ambiguous active period', async () => {
    const { app, domainStore } = createEnvironment()
    const invalid = await request(app, '/v1/admin/adiwiyata/sites', adminToken, 'POST', {
      name: '   ',
      category: 'fish',
      class_id: previousClassId,
      sort_order: 1.5,
    })
    expect(invalid.status).toBe(422)

    domainStore.academicPeriods.push({
      id: previousPeriodId,
      school_id: otherSchoolId,
      name: 'Duplicate active period',
      start_date: '2026-07-01',
      end_date: '2026-12-31',
      is_active: true,
    })
    const ambiguous = await request(app, '/v1/admin/adiwiyata/sites', adminToken)
    expect(ambiguous.status).toBe(503)
    expect((await ambiguous.json()).error.code).toBe('ADIWIYATA_CONFIGURATION_ERROR')
  })

  it('soft-deactivates without deleting the row and hides the Site from students', async () => {
    const { app, domainStore } = createEnvironment()
    const response = await request(
      app,
      `/v1/admin/adiwiyata/sites/${activeSiteId}`,
      adminToken,
      'DELETE',
    )
    expect(response.status).toBe(200)
    expect((await response.json()).data.is_active).toBe(false)
    expect(domainStore.adiwiyataSites.has(activeSiteId)).toBe(true)

    const dashboard = await request(app, '/v1/adiwiyata/dashboard', studentToken)
    expect(dashboard.status).toBe(200)
    const sites: Array<{ id: string }> = (await dashboard.json()).data.sites
    expect(sites.map((site) => site.id)).toContain('d0000000-0000-0000-0000-000000000005')
    expect(sites.map((site) => site.id)).not.toContain(activeSiteId)
  })
})
