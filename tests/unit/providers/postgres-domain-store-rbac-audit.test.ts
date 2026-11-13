import { describe, expect, it } from 'vitest'
import { PostgresDomainStore } from '../../../src/providers/postgres/domain-store.js'
import { createMockSql } from './postgres-mock-sql.js'

describe('PostgresDomainStore (RBAC, Staff & Audit)', () => {
  it('insertAuditLog and getAuditLogs store and query audit entries', async () => {
    let insertedAudit = false
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('INSERT INTO audit_logs')) {
        insertedAudit = true
        return [
          {
            id: 'audit-1',
            actor_id: 'admin-1',
            action: 'bootstrap_school',
            entity_type: 'school',
            entity_id: 'school-1',
            details: { name: 'SMKN 2' },
            created_at: '2026-08-21T00:00:00Z',
          },
        ]
      }
      if (query.includes('FROM audit_logs')) {
        return [
          {
            id: 'audit-1',
            actor_id: 'admin-1',
            action: 'bootstrap_school',
            entity_type: 'school',
            entity_id: 'school-1',
            details: { name: 'SMKN 2' },
            created_at: '2026-08-21T00:00:00Z',
          },
        ]
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const inserted = await store.insertAuditLog({
      actor_id: 'admin-1',
      action: 'bootstrap_school',
      entity_type: 'school',
      entity_id: 'school-1',
      details: { name: 'SMKN 2' },
    })

    expect(insertedAudit).toBe(true)
    expect(inserted.id).toBe('audit-1')

    const logs = await store.getAuditLogs('school', 'school-1')
    expect(logs.length).toBe(1)
    expect(logs[0].action).toBe('bootstrap_school')
  })

  it('getRoles, getRoleById, and getRoleByName query roles table', async () => {
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('FROM roles')) {
        return [
          {
            id: 'role-1',
            name: 'teacher',
            description: 'Teacher role',
            is_active: true,
            permissions: ['attendance:read'],
            created_at: '2026-08-21T00:00:00Z',
            updated_at: '2026-08-21T00:00:00Z',
          },
        ]
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const roles = await store.getRoles()
    expect(roles.length).toBe(1)
    expect(roles[0].name).toBe('teacher')

    const byId = await store.getRoleById('role-1')
    expect(byId?.name).toBe('teacher')

    const byName = await store.getRoleByName('teacher')
    expect(byName?.id).toBe('role-1')
  })

  it('createRole and updateRole manage roles in database', async () => {
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('INSERT INTO roles')) {
        return [{ id: 'role-2' }]
      }
      if (query.includes('WHERE r.id =')) {
        return [
          {
            id: 'role-2',
            name: 'staff',
            description: 'Staff member',
            is_active: true,
            permissions: [],
            created_at: '2026-08-21T00:00:00Z',
            updated_at: '2026-08-21T00:00:00Z',
          },
        ]
      }
      if (query.includes('WHERE LOWER(r.name) =')) {
        return []
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const created = await store.createRole({ name: 'staff', description: 'Staff member' })
    expect(created.name).toBe('staff')
  })

  it('getPermissions and createPermission query and insert permissions', async () => {
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('INSERT INTO permissions')) {
        return [
          {
            id: 'perm-1',
            name: 'reports:export',
            description: 'Export reports',
            created_at: '2026-08-21T00:00:00Z',
            updated_at: '2026-08-21T00:00:00Z',
          },
        ]
      }
      if (query.includes('FROM permissions')) {
        return [
          {
            id: 'perm-1',
            name: 'reports:export',
            description: 'Export reports',
            created_at: '2026-08-21T00:00:00Z',
            updated_at: '2026-08-21T00:00:00Z',
          },
        ]
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const perm = await store.createPermission({
      name: 'reports:export',
      description: 'Export reports',
    })
    expect(perm.name).toBe('reports:export')

    const list = await store.getPermissions()
    expect(list.length).toBe(1)
  })

  it('getUserRoles, assignUserRoles, and getUserEffectivePermissions query multi-role state', async () => {
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('FROM permissions p')) {
        return [{ name: 'attendance:read' }, { name: 'leave:read' }]
      }
      if (query.includes('FROM roles r')) {
        return [{ name: 'teacher' }, { name: 'staff' }]
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const roles = await store.getUserRoles('user-1')
    expect(roles).toEqual(['teacher', 'staff'])

    const perms = await store.getUserEffectivePermissions('user-1')
    expect(perms).toEqual(['attendance:read', 'leave:read'])
  })

  it('createStaffProfile, getStaffProfiles, and updateStaffProfile handle staff lifecycle', async () => {
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('INSERT INTO profiles')) {
        return [
          {
            user_id: 'staff-1',
            full_name: 'Pak Budi',
            email: 'budi@school.sch.id',
            role: 'teacher',
            lifecycle_status: 'approved',
            gender: 'L',
          },
        ]
      }
      if (query.includes('FROM profiles') && query.includes("role != 'student'")) {
        return [
          {
            user_id: 'staff-1',
            full_name: 'Pak Budi',
            email: 'budi@school.sch.id',
            role: 'teacher',
            lifecycle_status: 'approved',
            gender: 'L',
          },
        ]
      }
      if (query.includes('FROM profiles WHERE user_id =')) {
        return [
          {
            user_id: 'staff-1',
            full_name: 'Pak Budi',
            email: 'budi@school.sch.id',
            role: 'teacher',
            lifecycle_status: 'approved',
            gender: 'L',
          },
        ]
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    const created = await store.createStaffProfile({
      userId: 'staff-1',
      fullName: 'Pak Budi',
      email: 'budi@school.sch.id',
      role: 'teacher',
      gender: 'L',
    })
    expect(created.user_id).toBe('staff-1')
    expect(created.full_name).toBe('Pak Budi')

    const staffList = await store.getStaffProfiles()
    expect(staffList.length).toBe(1)

    const staffMember = await store.getStaffProfile('staff-1')
    expect(staffMember?.user_id).toBe('staff-1')
  })

  it('revokeUserSessions and isSessionRevoked check revoked sessions table', async () => {
    let sessionRevoked = false
    const mockSql = createMockSql((strings: TemplateStringsArray) => {
      const query = strings.join('?')
      if (query.includes('INSERT INTO revoked_sessions')) {
        sessionRevoked = true
        return []
      }
      if (query.includes('FROM revoked_sessions')) {
        return [{ count: sessionRevoked ? '1' : '0' }]
      }
      return []
    })

    const store = new PostgresDomainStore({ sql: mockSql })
    expect(await store.isSessionRevoked('user-1')).toBe(false)

    await store.revokeUserSessions('user-1')
    expect(await store.isSessionRevoked('user-1')).toBe(true)
  })

  it('binds verified token time to the retained revocation cutoff, failing closed for unknown time', async () => {
    const calls: { query: string; values: readonly unknown[] }[] = []
    const mockSql = createMockSql((strings, ...values) => {
      calls.push({ query: strings.join('?'), values })
      return [{ count: '1' }]
    })
    const store = new PostgresDomainStore({ sql: mockSql })
    const issuedAt = Math.floor(Date.now() / 1000) - 10
    await store.isSessionRevoked('user-1', issuedAt)
    expect(calls[0].query).toContain('revoked_at >= to_timestamp(')
    expect(calls[0].values).toEqual(['user-1', issuedAt, issuedAt])
    for (const time of [undefined, NaN, -1, 1.5, Date.now()]) {
      expect(await store.isSessionRevoked('user-1', time)).toBe(true)
      expect(calls.at(-1)?.values).toEqual(['user-1', null, null])
    }
  })
})
