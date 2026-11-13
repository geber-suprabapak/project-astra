import { describe, expect, it } from 'vitest'
import { createApp } from '../../../src/app.js'
import { AppError } from '../../../src/lib/errors/app-error.js'
import { ErrorCode } from '../../../src/lib/errors/codes.js'
import { getStudent, listClasses, listStudents } from '../../../src/modules/admin/service.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { IdentityRole } from '../../../src/providers/types.js'
import {
  adminRoles,
  createAdversarialTestProviders,
  mockRobinClient,
  nonAdminRoles,
  toAdversarialRole,
  tokenFor,
} from './adversarial-rbac-m0-harness.js'

describe('Adversarial Challenge M0: Astra Authorization & Privilege Boundaries', () => {
  describe('1. Service Layer Read & Lookup Matrix', () => {
    it('allows listStudents for platform_admin, school_admin, teacher, and staff only', async () => {
      const domainStore = new MemoryDomainStore()
      const providers = createAdversarialTestProviders(domainStore)

      domainStore.profiles.set('s1', {
        user_id: 's1',
        nis: '1001',
        full_name: 'Siswa Test',
        role: 'student',
        lifecycle_status: 'approved',
        gender: null,
      })

      const allowedRoles: IdentityRole[] = ['platform_admin', 'school_admin', 'teacher', 'staff']
      for (const role of allowedRoles) {
        const result = await listStudents({
          actorRole: role,
          providers,
        })
        expect(Array.isArray(result)).toBe(true)
        expect(result.length).toBe(1)
      }

      const forbiddenRoles: (IdentityRole | null | undefined)[] = [
        'student',
        null,
        undefined,
        toAdversarialRole('guru'),
        toAdversarialRole('wali_kelas'),
        toAdversarialRole('siswa'),
        toAdversarialRole('root'),
        toAdversarialRole(''),
        toAdversarialRole('__proto__'),
      ]
      for (const role of forbiddenRoles) {
        try {
          await listStudents({
            actorRole: role ?? null,
            providers,
          })
          expect.fail(`Expected listStudents to reject role: ${String(role)}`)
        } catch (err: unknown) {
          expect(err).toBeInstanceOf(AppError)
          // SAFETY: Checked as AppError above
          const appErr = err as AppError
          expect(appErr.httpStatus).toBe(403)
          expect(appErr.code).toBe(ErrorCode.FORBIDDEN)
        }
      }
    })

    it('allows listClasses for platform_admin, school_admin, teacher, and staff only', async () => {
      const domainStore = new MemoryDomainStore()
      const providers = createAdversarialTestProviders(domainStore)

      await domainStore.createClass({ name: 'X RPL 1', grade: 10 })

      const allowedRoles: IdentityRole[] = ['platform_admin', 'school_admin', 'teacher', 'staff']
      for (const role of allowedRoles) {
        const result = await listClasses({
          actorRole: role,
          providers,
        })
        expect(Array.isArray(result)).toBe(true)
        expect(result.length).toBeGreaterThanOrEqual(1)
      }

      const forbiddenRoles: (IdentityRole | null | undefined)[] = [
        'student',
        null,
        undefined,
        toAdversarialRole('guru'),
        toAdversarialRole('wali_kelas'),
        toAdversarialRole('siswa'),
        toAdversarialRole('root'),
        toAdversarialRole(''),
      ]
      for (const role of forbiddenRoles) {
        try {
          await listClasses({
            actorRole: role ?? null,
            providers,
          })
          expect.fail(`Expected listClasses to reject role: ${String(role)}`)
        } catch (err: unknown) {
          expect(err).toBeInstanceOf(AppError)
          // SAFETY: Checked as AppError above
          const appErr = err as AppError
          expect(appErr.httpStatus).toBe(403)
          expect(appErr.code).toBe(ErrorCode.FORBIDDEN)
        }
      }
    })

    it('strictly rejects non-admin roles for getStudent with HTTP 403', async () => {
      const domainStore = new MemoryDomainStore()
      const providers = createAdversarialTestProviders(domainStore)

      domainStore.profiles.set('target-student', {
        user_id: 'target-student',
        nis: '1001',
        full_name: 'Target Student',
        role: 'student',
        lifecycle_status: 'approved',
        gender: null,
      })

      // Admin access succeeds
      for (const role of adminRoles) {
        const student = await getStudent({
          userId: 'target-student',
          actorRole: role,
          providers,
        })
        expect(student.user_id).toBe('target-student')
      }

      // Non-admin roles must fail with 403
      for (const role of nonAdminRoles) {
        try {
          await getStudent({
            userId: 'target-student',
            actorRole: role ?? null,
            providers,
          })
          expect.fail(`Expected getStudent to reject role: ${String(role)}`)
        } catch (err: unknown) {
          expect(err).toBeInstanceOf(AppError)
          // SAFETY: Checked as AppError above
          const appErr = err as AppError
          expect(appErr.httpStatus).toBe(403)
          expect(appErr.code).toBe(ErrorCode.FORBIDDEN)
        }
      }
    })
  })

  describe('2. HTTP Integration Layer Route Boundaries', () => {
    function setupIntegrationEnv() {
      const domainStore = new MemoryDomainStore()
      const identityProvider = new MemoryIdentityProvider()

      // Seed admin
      domainStore.profiles.set('admin-user', {
        user_id: 'admin-user',
        full_name: 'Admin User',
        email: 'admin@school.sch.id',
        role: 'school_admin',
        lifecycle_status: 'approved',
        gender: null,
      })

      // Seed teacher
      domainStore.profiles.set('teacher-user', {
        user_id: 'teacher-user',
        full_name: 'Teacher User',
        email: 'teacher@school.sch.id',
        role: 'teacher',
        lifecycle_status: 'approved',
        gender: null,
      })

      // Seed staff
      domainStore.profiles.set('staff-user', {
        user_id: 'staff-user',
        full_name: 'Staff User',
        email: 'staff@school.sch.id',
        role: 'staff',
        lifecycle_status: 'approved',
        gender: null,
      })

      // Seed student
      domainStore.profiles.set('student-user', {
        user_id: 'student-user',
        full_name: 'Student User',
        email: 'student@school.sch.id',
        role: 'student',
        lifecycle_status: 'approved',
        gender: null,
      })

      // Seed target student for mutation tests
      domainStore.profiles.set('target-student', {
        user_id: 'target-student',
        nis: '8888',
        full_name: 'Target Student',
        email: 'target@school.sch.id',
        role: 'student',
        lifecycle_status: 'approved',
        gender: null,
      })

      const app = createApp({
        providers: {
          domainStore,
          objectStorage: new MemoryObjectStorage(),
          identityProvider,
          robinClient: mockRobinClient,
        },
      })

      return { app, domainStore }
    }

    interface StandardEnvelope {
      success: boolean
      data?: unknown
      error?: { code: string; message: string }
    }

    it('teacher and staff can call GET /v1/admin/students and GET /v1/admin/classes with 200 OK', async () => {
      const { app } = setupIntegrationEnv()

      const teacherToken = tokenFor({
        sub: 'teacher-user',
        roles: ['teacher'],
        scope: 'openid profile admin:read',
        must_change_password: false,
      })

      const staffToken = tokenFor({
        sub: 'staff-user',
        roles: ['staff'],
        scope: 'openid profile admin:read',
        must_change_password: false,
      })

      for (const token of [teacherToken, staffToken]) {
        const studentRes = await app.request('/v1/admin/students', {
          headers: { Authorization: `Bearer ${token}` },
        })
        expect(studentRes.status).toBe(200)
        // SAFETY: Endpoint returns standard JSON envelope
        const studentData = (await studentRes.json()) as StandardEnvelope
        expect(studentData.success).toBe(true)
        expect(Array.isArray(studentData.data)).toBe(true)

        const classRes = await app.request('/v1/admin/classes', {
          headers: { Authorization: `Bearer ${token}` },
        })
        expect(classRes.status).toBe(200)
        // SAFETY: Endpoint returns standard JSON envelope
        const classData = (await classRes.json()) as StandardEnvelope
        expect(classData.success).toBe(true)
      }
    })

    it('student is rejected with 403 Forbidden on GET /v1/admin/students even with admin:read scope', async () => {
      const { app } = setupIntegrationEnv()

      const spoofedStudentToken = tokenFor({
        sub: 'student-user',
        roles: ['student'],
        scope: 'openid profile admin:read',
        must_change_password: false,
      })

      const res = await app.request('/v1/admin/students', {
        headers: { Authorization: `Bearer ${spoofedStudentToken}` },
      })
      expect(res.status).toBe(403)
      // SAFETY: Endpoint returns standard JSON envelope
      const body = (await res.json()) as StandardEnvelope
      expect(body.success).toBe(false)
      expect(body.error?.code).toBe('FORBIDDEN')
    })

    it('all student mutation endpoints strictly reject teacher and staff with HTTP 403', async () => {
      const { app } = setupIntegrationEnv()

      const teacherToken = tokenFor({
        sub: 'teacher-user',
        roles: ['teacher'],
        scope: 'openid profile admin:read',
        must_change_password: false,
      })

      const staffToken = tokenFor({
        sub: 'staff-user',
        roles: ['staff'],
        scope: 'openid profile admin:read',
        must_change_password: false,
      })

      const mutationEndpoints = [
        { path: '/v1/admin/students/target-student', method: 'GET', body: null },
        { path: '/v1/admin/students/target-student/approve', method: 'POST', body: {} },
        {
          path: '/v1/admin/students/target-student/reject',
          method: 'POST',
          body: { reason: 'test' },
        },
        { path: '/v1/admin/students/target-student/disable', method: 'POST', body: {} },
        { path: '/v1/admin/students/target-student/reset-code', method: 'POST', body: {} },
        {
          path: '/v1/admin/students/target-student/email',
          method: 'PATCH',
          body: { email: 'new@school.sch.id' },
        },
        { path: '/v1/admin/students/target-student/face-enrollment', method: 'DELETE', body: null },
      ]

      for (const token of [teacherToken, staffToken]) {
        for (const endpoint of mutationEndpoints) {
          const res = await app.request(endpoint.path, {
            method: endpoint.method,
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: endpoint.body ? JSON.stringify(endpoint.body) : undefined,
          })

          expect(res.status).toBe(403)
          // SAFETY: Endpoint returns standard JSON envelope
          const body = (await res.json()) as StandardEnvelope
          expect(body.success).toBe(false)
          expect(body.error?.code).toBe('FORBIDDEN')
        }
      }
    })

    it('school_admin successfully executes student mutations', async () => {
      const { app } = setupIntegrationEnv()

      const adminToken = tokenFor({
        sub: 'admin-user',
        roles: ['school_admin'],
        scope: 'openid profile admin:read',
        must_change_password: false,
      })

      // GET student
      const getRes = await app.request('/v1/admin/students/target-student', {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      expect(getRes.status).toBe(200)

      // Reset code
      const resetRes = await app.request('/v1/admin/students/target-student/reset-code', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      expect(resetRes.status).toBe(201)

      // Update email
      const emailRes = await app.request('/v1/admin/students/target-student/email', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'updated@school.sch.id' }),
      })
      expect(emailRes.status).toBe(200)
    })
  })
})
