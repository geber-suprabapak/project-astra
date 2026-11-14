import { describe, expect, it } from 'vitest'
import {
  bootstrapSchool,
  createSchoolAdmin,
  validateAndStageRoster,
} from '../../../src/modules/admin/service.js'
import { AppError } from '../../../src/lib/errors/app-error.js'
import { createTestProviders } from './admin-bootstrap-service-harness.js'

describe('admin bootstrap service unit tests', () => {
  it('bootstrapSchool creates school, initial academic period, and audit log', async () => {
    const { providers, domainStore } = createTestProviders()

    const school = await bootstrapSchool({
      name: 'SMK Negeri 2 Banjarmasin',
      slug: 'smkn2bjm',
      timezone: 'Asia/Jakarta',
      actorId: 'platform-admin-1',
      actorRole: 'platform_admin',
      providers,
    })

    expect(school.name).toBe('SMK Negeri 2 Banjarmasin')
    expect(school.slug).toBe('smkn2bjm')
    expect(school.timezone).toBe('Asia/Jakarta')
    expect(school.signup_open).toBe(false)

    // Check academic period created
    const activePeriod = await domainStore.getActiveAcademicPeriod()
    expect(activePeriod).not.toBeNull()
    expect(activePeriod?.school_id).toBe(school.id)

    // Check audit log
    const auditLogs = await domainStore.getAuditLogs('school', school.id)
    expect(auditLogs.length).toBe(1)
    expect(auditLogs[0].action).toBe('bootstrap_school')
    expect(auditLogs[0].actor_id).toBe('platform-admin-1')
  })

  it('bootstrapSchool throws conflict if a school is already configured', async () => {
    const { providers } = createTestProviders()

    await bootstrapSchool({
      name: 'School One',
      slug: 'school-one',
      actorId: 'platform-admin-1',
      actorRole: 'platform_admin',
      providers,
    })

    await expect(
      bootstrapSchool({
        name: 'School Two',
        slug: 'school-two',
        actorId: 'platform-admin-1',
        actorRole: 'platform_admin',
        providers,
      }),
    ).rejects.toThrow('A school has already been configured')
  })

  it('bootstrapSchool denies non-platform_admin actors', async () => {
    const { providers } = createTestProviders()

    await expect(
      bootstrapSchool({
        name: 'School One',
        slug: 'school-one',
        actorId: 'school-admin-1',
        actorRole: 'school_admin',
        providers,
      }),
    ).rejects.toThrow(AppError)
  })

  it('createSchoolAdmin creates profile and audit log for school_admin', async () => {
    const { providers, domainStore } = createTestProviders()

    const profile = await createSchoolAdmin({
      userId: 'school-admin-1',
      fullName: 'Kepala Sekolah',
      email: 'admin@school.sch.id',
      actorId: 'platform-admin-1',
      actorRole: 'platform_admin',
      providers,
    })

    expect(profile.user_id).toBe('school-admin-1')
    expect(profile.role).toBe('school_admin')
    expect(profile.lifecycle_status).toBe('approved')

    const auditLogs = await domainStore.getAuditLogs('profile', 'school-admin-1')
    expect(auditLogs.length).toBe(1)
    expect(auditLogs[0].action).toBe('create_school_admin')
  })

  it('validateAndStageRoster rejects empty NIS, duplicate NIS, empty full_name, and empty class_name', async () => {
    const { providers, domainStore } = createTestProviders()

    // First bootstrap school
    await bootstrapSchool({
      name: 'SMK Negeri 2 Banjarmasin',
      slug: 'smkn2bjm',
      actorId: 'platform-admin-1',
      actorRole: 'platform_admin',
      providers,
    })

    // Pre-populate an existing student profile
    domainStore.profiles.set('existing-student', {
      user_id: 'existing-student',
      nis: '9999',
      full_name: 'Existing Student',
      lifecycle_status: 'approved',
      role: 'student',
    })

    const report = await validateAndStageRoster({
      rows: [
        {
          nis: '1000',
          full_name: 'Valid Student 0',
          class_name: 'XII RPL 1',
          gender: 'L',
          absence_number: 1,
        },
        {
          nis: '',
          full_name: 'Empty NIS',
          class_name: 'XII RPL 1',
          gender: 'L',
          absence_number: 2,
        },
        {
          nis: '1001',
          full_name: 'Valid Student 1',
          class_name: 'XII RPL 1',
          gender: 'L',
          absence_number: 3,
        },
        {
          nis: '1001',
          full_name: 'Duplicate Batch NIS',
          class_name: 'XII RPL 1',
          gender: 'L',
          absence_number: 4,
        },
        {
          nis: '9999',
          full_name: 'Canonical Duplicate NIS',
          class_name: 'XII RPL 1',
          gender: 'L',
          absence_number: 5,
        },
        { nis: '1002', full_name: '', class_name: 'XII RPL 1', gender: 'L', absence_number: 6 },
        {
          nis: '1003',
          full_name: 'Valid Student 2',
          class_name: '',
          gender: 'L',
          absence_number: 7,
        },
      ],
      academicPeriodId: 'b0000000-0000-0000-0000-000000000001',
      actorId: 'school-admin-1',
      actorRole: 'school_admin',
      providers,
    })

    expect(report.total_rows).toBe(7)
    expect(report.valid_rows).toBe(1)
    expect(report.rejected_rows).toBe(6)
    expect(report.status).toBe('rejected')
    expect(report.review_state).toBe('rejected')
    expect(report.rejected_items.length).toBe(6)

    expect(report.rejected_items[0].reason).toContain('NIS cannot be empty')
    expect(report.rejected_items[1].reason).toContain('Duplicate NIS "1001" in roster batch')
    expect(report.rejected_items[2].reason).toContain('Duplicate NIS "1001" in roster batch')
    expect(report.rejected_items[3].reason).toContain(
      'NIS "9999" already exists in the student roster',
    )
    expect(report.rejected_items[4].reason).toContain('Full name cannot be empty')
    expect(report.rejected_items[5].reason).toContain('Class name cannot be empty')
  })

  it('rejects an existing canonical Student NIS without mutating its records', async () => {
    const { providers, domainStore } = createTestProviders()
    const school = await bootstrapSchool({
      name: 'SMK Negeri 2 Banjarmasin',
      slug: 'smkn2bjm',
      actorId: 'platform-admin-1',
      actorRole: 'platform_admin',
      providers,
    })
    const period = await domainStore.getActiveAcademicPeriod()
    const classes = await domainStore.getClasses(school.id, period?.id)
    const existingStudent = await domainStore.createStudent({
      nis: '1001',
      fullName: 'Existing Canonical Student',
      gender: 'L',
    })
    domainStore.classEnrollments.push({
      id: 'existing-enrollment',
      student_id: existingStudent.id,
      user_id: 'existing-user',
      class_id: classes[0]!.id,
      academic_period_id: period!.id,
      absence_number: '7',
      status: 'active',
    })
    domainStore.profiles.set('existing-user', {
      user_id: 'existing-user',
      nis: '1001',
      full_name: 'Existing Canonical Student',
      role: 'student',
      lifecycle_status: 'approved',
    })
    await domainStore.bindStudentToUser({ studentId: existingStudent.id, userId: 'existing-user' })

    const beforeStudent = await domainStore.getStudentByNis('1001')
    const beforeEnrollment = { ...domainStore.classEnrollments[0] }
    const beforeProfile = { ...domainStore.profiles.get('existing-user')! }
    const beforeBinding = { ...domainStore.studentBindings.get(existingStudent.id)! }

    const report = await validateAndStageRoster({
      rows: [
        {
          nis: '1001',
          full_name: 'Different Name',
          class_name: classes[0]!.name,
          class_id: classes[0]!.id,
          gender: 'P',
          absence_number: 8,
        },
      ],
      academicPeriodId: period!.id,
      actorId: 'school-admin-1',
      actorRole: 'school_admin',
      providers,
    })

    expect(report.status).toBe('rejected')
    expect(report.rejected_items[0]?.reason).toContain('already exists in the student roster')
    expect(await domainStore.getStudentByNis('1001')).toEqual(beforeStudent)
    expect(domainStore.classEnrollments[0]).toEqual(beforeEnrollment)
    expect(domainStore.profiles.get('existing-user')).toEqual(beforeProfile)
    expect(domainStore.studentBindings.get(existingStudent.id)).toEqual(beforeBinding)
  })

  it('validateAndStageRoster rejects invalid class references when classes are registered', async () => {
    const { providers, domainStore } = createTestProviders()

    const school = await bootstrapSchool({
      name: 'SMK Negeri 2 Banjarmasin',
      slug: 'smkn2bjm',
      actorId: 'platform-admin-1',
      actorRole: 'platform_admin',
      providers,
    })

    // Register a valid class
    await domainStore.createClass({
      schoolId: school.id,
      academicPeriodId: 'b0000000-0000-0000-0000-000000000001',
      name: 'XII RPL 1',
      grade: 12,
    })

    const report = await validateAndStageRoster({
      rows: [
        {
          nis: '1001',
          full_name: 'Student One',
          class_name: 'XII RPL 1',
          gender: 'L',
          absence_number: 1,
        },
        {
          nis: '1002',
          full_name: 'Student Two',
          class_name: 'NonExistentClass',
          gender: 'L',
          absence_number: 2,
        },
      ],
      academicPeriodId: 'b0000000-0000-0000-0000-000000000001',
      actorId: 'school-admin-1',
      actorRole: 'school_admin',
      providers,
    })

    expect(report.total_rows).toBe(2)
    expect(report.valid_rows).toBe(1)
    expect(report.rejected_rows).toBe(1)
    expect(report.status).toBe('rejected')
    expect(report.rejected_items[0].reason).toContain('Invalid class reference: "NonExistentClass"')
  })
})
