import { describe, expect, it } from 'vitest'
import type { JWTPayload } from 'jose'
import { createApp } from '../../../src/app.js'
import {
  filterSafeSpanAttributes,
  isSensitiveKey,
  sanitizeAuditLogDetails,
} from '../../../src/lib/observability/pii.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { RobinClient } from '../../../src/clients/robin/client.js'

const robinClient: RobinClient = {
  checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
  getEnrollmentStatus: async () => ({ status: 'enrolled', embeddingCount: 1, message: 'Ready' }),
  enroll: async () => ({ imagesProcessed: 1, imagesFailed: 0, totalEmbeddings: 1 }),
  identify: async () => ({ status: 'ok', processTimeMs: 1 }),
  deleteEnrollment: async () => {},
}

function tokenFor(payload: JWTPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${encodedPayload}.signature`
}

describe('Audit Log Sanitization & GET /v1/admin/audit-logs', () => {
  it('sanitizes audit details while keeping triage fields and preserving span PII redaction', () => {
    expect(isSensitiveKey('full_name')).toBe(true)
    expect(filterSafeSpanAttributes({ full_name: 'Secret Student', nis: '12345' })).toEqual({
      nis: '12345',
    })

    const doubleEncoded = JSON.stringify(
      JSON.stringify({
        email: 'budi.santoso@smkn2.sch.id',
        previous_email: 'old@example.com',
        new_email: 'new@example.com',
        phone_number: '081234567890',
        nik: '6371012345678901',
        nisn: '0098765432',
        alamat: 'Jl. Brigjen H. Hasan Basri No. 6',
        nis: '12345',
        full_name: 'Budi Santoso',
        class_name: 'XI RPL 1',
        reason: 'Koreksi kelas semester genap',
        reset_code: '991122',
        token: 'secret-token-value',
        password: 'super-secret-password',
        latitude: -3.316694,
        longitude: 114.590111,
        request_id: 'req-audit-1',
        trace_id: 'trace-audit-1',
      }),
    )

    const sanitized = sanitizeAuditLogDetails(doubleEncoded)
    expect(sanitized).toEqual({
      email: 'b***@smkn2.sch.id',
      previous_email: 'o***@example.com',
      new_email: 'n***@example.com',
      phone_number: '***7890',
      nik: '***8901',
      nisn: '***5432',
      alamat: '[MASKED_ADDRESS]',
      nis: '12345',
      full_name: 'Budi Santoso',
      class_name: 'XI RPL 1',
      reason: 'Koreksi kelas semester genap',
      reset_code: '[REDACTED]',
      token: '[REDACTED]',
      password: '[REDACTED]',
      latitude: '[REDACTED]',
      longitude: '[REDACTED]',
      request_id: 'req-audit-1',
      trace_id: 'trace-audit-1',
    })
  })

  it('enforces role scoping, pagination, date bounds, and sanitization on GET /v1/admin/audit-logs', async () => {
    const domainStore = new MemoryDomainStore()
    const identityProvider = new MemoryIdentityProvider()
    domainStore.profiles.set('platform-1', {
      user_id: 'platform-1',
      full_name: 'Platform Admin',
      role: 'platform_admin',
      lifecycle_status: 'approved',
    })
    domainStore.profiles.set('school-1', {
      user_id: 'school-1',
      full_name: 'School Admin',
      role: 'school_admin',
      lifecycle_status: 'approved',
    })
    domainStore.profiles.set('teacher-1', {
      user_id: 'teacher-1',
      full_name: 'Teacher One',
      role: 'teacher',
      lifecycle_status: 'approved',
    })

    domainStore.auditLogs.push(
      {
        id: 'audit-1',
        actor_id: 'school-1',
        action: 'update_academic_period',
        entity_type: 'academic_period',
        entity_id: 'period-1',
        details: {
          reason: 'Perubahan tanggal',
          email: 'admin@school.sch.id',
          request_id: 'req-1',
          trace_id: 'trace-1',
        },
        created_at: '2026-08-10T02:00:00.000Z',
      },
      {
        id: 'audit-2',
        actor_id: 'platform-1',
        action: 'create_role',
        entity_type: 'role',
        entity_id: 'role-1',
        details: { name: 'auditor' },
        created_at: '2026-08-11T02:00:00.000Z',
      },
      {
        id: 'audit-3',
        actor_id: 'platform-1',
        action: 'bootstrap_school',
        entity_type: 'school',
        entity_id: 'school-uuid',
        details: { slug: 'smkn2' },
        created_at: '2026-08-12T02:00:00.000Z',
      },
      {
        id: 'audit-4',
        actor_id: 'school-1',
        action: 'create_calendar_exception',
        entity_type: 'calendar_exception',
        entity_id: 'exc-1',
        details: { reason: 'HUT RI', request_id: 'req-4' },
        created_at: '2026-08-13T02:00:00.000Z',
      },
    )

    const app = createApp({
      providers: {
        domainStore,
        identityProvider,
        objectStorage: new MemoryObjectStorage(),
        robinClient,
      },
    })

    const teacherToken = tokenFor({
      sub: 'teacher-1',
      roles: ['teacher'],
      scope: 'openid profile admin:read',
    })
    const schoolToken = tokenFor({
      sub: 'school-1',
      roles: ['school_admin'],
      scope: 'openid profile admin:read',
      mfa_verified: true,
      must_change_password: false,
    })
    const platformToken = tokenFor({
      sub: 'platform-1',
      roles: ['platform_admin'],
      scope: 'openid profile admin:read',
      mfa_verified: true,
      must_change_password: false,
    })

    const teacherRes = await app.request('/v1/admin/audit-logs', {
      headers: { Authorization: `Bearer ${teacherToken}` },
    })
    expect(teacherRes.status).toBe(403)

    const invalidDateRes = await app.request(
      '/v1/admin/audit-logs?start_date=2026-08-20&end_date=2026-08-10',
      { headers: { Authorization: `Bearer ${schoolToken}` } },
    )
    expect(invalidDateRes.status).toBe(422)

    const schoolRes = await app.request('/v1/admin/audit-logs?limit=1&offset=0', {
      headers: { Authorization: `Bearer ${schoolToken}` },
    })
    expect(schoolRes.status).toBe(200)
    const schoolBody = await schoolRes.json()
    expect(schoolBody.meta.pagination).toEqual({ limit: 1, offset: 0, has_more: true })
    expect(schoolBody.data[0].id).toBe('audit-4')
    expect(schoolBody.data[0].request_id).toBe('req-4')

    const schoolPage2 = await app.request('/v1/admin/audit-logs?limit=10&offset=0', {
      headers: { Authorization: `Bearer ${schoolToken}` },
    })
    const schoolPage2Body = await schoolPage2.json()
    expect(schoolPage2Body.data.map((d: { id: string }) => d.id)).toEqual(['audit-4', 'audit-1'])
    expect(schoolPage2Body.data[1].details.email).toBe('a***@school.sch.id')
    expect(schoolPage2Body.data[1].trace_id).toBe('trace-1')

    const platformRes = await app.request('/v1/admin/audit-logs?limit=10&offset=0', {
      headers: { Authorization: `Bearer ${platformToken}` },
    })
    const platformBody = await platformRes.json()
    expect(platformBody.data.map((d: { id: string }) => d.id)).toEqual([
      'audit-4',
      'audit-3',
      'audit-2',
      'audit-1',
    ])
  })
})
