import { describe, expect, it } from 'vitest'
import {
  acceptRosterReport,
  bootstrapSchool,
  createSchoolAdmin,
  getBootstrapStatus,
  getRosterReport,
  openStudentSignup,
  validateAndStageRoster,
} from '../../../src/modules/admin/service.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { RobinClient } from '../../../src/clients/robin/client.js'
import type { AppProviders, CreateStudentParams, Student } from '../../../src/providers/types.js'
import { AppError } from '../../../src/lib/errors/app-error.js'

const mockRobinClient: RobinClient = {
  checkReadiness: async () => ({ healthy: true, modelReady: true, qdrantConnected: true }),
  getEnrollmentStatus: async () => ({
    status: 'not_enrolled',
    embeddingCount: 0,
    message: 'No enrollment found.',
  }),
  enroll: async () => ({
    status: 'ok',
    userId: 'platform-admin-1',
    samplesReceived: 0,
    embeddingsCreated: 0,
    message: 'Enrollment complete.',
  }),
  identify: async () => ({
    status: 'no_match',
    candidateId: null,
    confidence: 0,
    threshold: 0.7,
    qualityScore: 0,
    processTimeMs: 0,
  }),
  deleteEnrollment: async () => {},
}

interface TestProvidersContext {
  providers: AppProviders
  domainStore: MemoryDomainStore
}

function createTestProviders(): TestProvidersContext {
  const domainStore = new MemoryDomainStore()
  const providers: AppProviders = {
    domainStore,
    objectStorage: new MemoryObjectStorage(),
    identityProvider: new MemoryIdentityProvider(),
    robinClient: mockRobinClient,
  }
  return { providers, domainStore }
}

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

  it('acceptRosterReport succeeds for clean report and commits canonical student records', async () => {
    const { providers, domainStore } = createTestProviders()

    await bootstrapSchool({
      name: 'SMK Negeri 2 Banjarmasin',
      slug: 'smkn2bjm',
      actorId: 'platform-admin-1',
      actorRole: 'platform_admin',
      providers,
    })

    const staged = await validateAndStageRoster({
      rows: [
        {
          nis: '1001',
          full_name: 'Ahmad Fauzi',
          class_name: 'XII RPL 1',
          grade: 12,
          gender: 'L',
          absence_number: 1,
        },
        {
          nis: '1002',
          full_name: 'Budi Utomo',
          class_name: 'XII RPL 1',
          grade: 12,
          gender: 'L',
          absence_number: 2,
        },
      ],
      academicPeriodId: 'b0000000-0000-0000-0000-000000000001',
      actorId: 'school-admin-1',
      actorRole: 'school_admin',
      providers,
    })

    expect(staged.valid_rows).toBe(2)
    expect(staged.rejected_rows).toBe(0)
    expect(staged.status).toBe('staged')

    // Accepts report by school_admin
    const accepted = await acceptRosterReport({
      id: staged.id,
      actorId: 'school-admin-1',
      actorRole: 'school_admin',
      providers,
    })

    expect(accepted.status).toBe('accepted')
    expect(accepted.review_state).toBe('accepted')
    expect(accepted.accepted_by).toBe('school-admin-1')

    // Check canonical students created without identity profiles
    const student1 = await domainStore.getStudentByNis('1001')
    expect(student1).not.toBeNull()
    expect(student1?.full_name).toBe('Ahmad Fauzi')
    expect(await domainStore.getProfileByNis('1001')).toBeNull()

    const student2 = await domainStore.getStudentByNis('1002')
    expect(student2).not.toBeNull()
    expect(student2?.full_name).toBe('Budi Utomo')

    // Check class enrollment created
    expect(domainStore.classEnrollments.length).toBe(2)
  })

  it('rolls back the entire Memory acceptance when a later row fails', async () => {
    const { providers, domainStore } = createTestProviders()

    await bootstrapSchool({
      name: 'SMK Negeri 2 Banjarmasin',
      slug: 'smkn2bjm',
      actorId: 'platform-admin-1',
      actorRole: 'platform_admin',
      providers,
    })
    const period = await domainStore.getActiveAcademicPeriod()
    const classes = await domainStore.getClasses(domainStore.schools[0]!.id, period?.id)
    const staged = await validateAndStageRoster({
      rows: [
        {
          nis: '1001',
          full_name: 'First Student',
          class_name: classes[0]!.name,
          class_id: classes[0]!.id,
          gender: 'L',
          absence_number: 1,
        },
        {
          nis: '1002',
          full_name: 'Second Student',
          class_name: classes[0]!.name,
          class_id: classes[0]!.id,
          gender: 'P',
          absence_number: 2,
        },
      ],
      academicPeriodId: period!.id,
      actorId: 'school-admin-1',
      actorRole: 'school_admin',
      providers,
    })
    const auditCountBeforeAccept = domainStore.auditLogs.length
    const reportBeforeAccept = structuredClone(staged)
    const auditBeforeAccept = structuredClone(domainStore.auditLogs)
    const originalCreateStudent = domainStore.createStudent.bind(domainStore)
    let createCount = 0
    domainStore.createStudent = async (params: CreateStudentParams): Promise<Student> => {
      createCount += 1
      if (createCount === 2) throw AppError.internal('Injected acceptance failure')
      return originalCreateStudent(params)
    }

    await expect(
      acceptRosterReport({
        id: staged.id,
        actorId: 'school-admin-1',
        actorRole: 'school_admin',
        providers,
      }),
    ).rejects.toThrow('Injected acceptance failure')

    expect(domainStore.students.size).toBe(0)
    expect(domainStore.classEnrollments).toHaveLength(0)
    expect(domainStore.studentBindings.size).toBe(0)
    expect(domainStore.profiles.size).toBe(0)
    // SAFETY: The test provider is created by createTestProviders above.
    expect((providers.identityProvider as MemoryIdentityProvider).users.size).toBe(0)
    expect(domainStore.auditLogs).toHaveLength(auditCountBeforeAccept)
    expect(domainStore.auditLogs).toEqual(auditBeforeAccept)
    expect(await domainStore.getRosterReport(staged.id)).toEqual(reportBeforeAccept)
  })

  it('acceptRosterReport denies platform_admin (requires school_admin)', async () => {
    const { providers } = createTestProviders()

    await bootstrapSchool({
      name: 'SMK Negeri 2 Banjarmasin',
      slug: 'smkn2bjm',
      actorId: 'platform-admin-1',
      actorRole: 'platform_admin',
      providers,
    })

    const staged = await validateAndStageRoster({
      rows: [
        {
          nis: '1001',
          full_name: 'Ahmad Fauzi',
          class_name: 'XII RPL 1',
          gender: 'L',
          absence_number: 1,
        },
      ],
      academicPeriodId: 'b0000000-0000-0000-0000-000000000001',
      actorId: 'school-admin-1',
      actorRole: 'school_admin',
      providers,
    })

    await expect(
      acceptRosterReport({
        id: staged.id,
        actorId: 'platform-admin-1',
        actorRole: 'platform_admin',
        providers,
      }),
    ).rejects.toThrow(AppError)
  })

  it('acceptRosterReport fails when report contains rejected rows', async () => {
    const { providers } = createTestProviders()

    await bootstrapSchool({
      name: 'SMK Negeri 2 Banjarmasin',
      slug: 'smkn2bjm',
      actorId: 'platform-admin-1',
      actorRole: 'platform_admin',
      providers,
    })

    const staged = await validateAndStageRoster({
      rows: [
        {
          nis: '',
          full_name: 'Ahmad Fauzi',
          class_name: 'XII RPL 1',
          gender: 'L',
          absence_number: 1,
        },
      ],
      academicPeriodId: 'b0000000-0000-0000-0000-000000000001',
      actorId: 'school-admin-1',
      actorRole: 'school_admin',
      providers,
    })

    try {
      await acceptRosterReport({
        id: staged.id,
        actorId: 'school-admin-1',
        actorRole: 'school_admin',
        providers,
      })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      // SAFETY: Error verified as AppError
      const appErr = err as AppError
      expect(appErr.httpStatus).toBe(422)
      expect(appErr.details).toContain('Cannot accept a roster report with rejected rows')
    }
  })

  it('openStudentSignup fails without an accepted roster report and succeeds after acceptance', async () => {
    const { providers } = createTestProviders()

    await bootstrapSchool({
      name: 'SMK Negeri 2 Banjarmasin',
      slug: 'smkn2bjm',
      actorId: 'platform-admin-1',
      actorRole: 'platform_admin',
      providers,
    })

    // Try to open signup before roster accepted
    try {
      await openStudentSignup({
        actorId: 'school-admin-1',
        actorRole: 'school_admin',
        providers,
      })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(AppError)
      // SAFETY: Error verified as AppError
      const appErr = err as AppError
      expect(appErr.httpStatus).toBe(422)
      expect(appErr.details).toContain(
        'Student signup cannot be opened before an accepted roster report exists',
      )
    }

    // Stage and accept roster
    const staged = await validateAndStageRoster({
      rows: [
        {
          nis: '1001',
          full_name: 'Ahmad Fauzi',
          class_name: 'XII RPL 1',
          gender: 'L',
          absence_number: 1,
        },
      ],
      academicPeriodId: 'b0000000-0000-0000-0000-000000000001',
      actorId: 'school-admin-1',
      actorRole: 'school_admin',
      providers,
    })

    await acceptRosterReport({
      id: staged.id,
      actorId: 'school-admin-1',
      actorRole: 'school_admin',
      providers,
    })

    // Now opening signup succeeds
    const result = await openStudentSignup({
      actorId: 'school-admin-1',
      actorRole: 'school_admin',
      providers,
    })

    expect(result.signup_open).toBe(true)

    // Check bootstrap status
    const status = await getBootstrapStatus(providers)
    expect(status.signup_open).toBe(true)
    expect(status.roster_accepted).toBe(true)
    expect(status.school_configured).toBe(true)
  })

  it('openStudentSignup denies platform_admin', async () => {
    const { providers } = createTestProviders()

    await expect(
      openStudentSignup({
        actorId: 'platform-admin-1',
        actorRole: 'platform_admin',
        providers,
      }),
    ).rejects.toThrow(AppError)
  })

  it('getRosterReport returns report or throws 404', async () => {
    const { providers } = createTestProviders()

    await bootstrapSchool({
      name: 'SMK Negeri 2 Banjarmasin',
      slug: 'smkn2bjm',
      actorId: 'platform-admin-1',
      actorRole: 'platform_admin',
      providers,
    })

    const staged = await validateAndStageRoster({
      rows: [
        {
          nis: '1001',
          full_name: 'Ahmad Fauzi',
          class_name: 'XII RPL 1',
          gender: 'L',
          absence_number: 1,
        },
      ],
      academicPeriodId: 'b0000000-0000-0000-0000-000000000001',
      actorId: 'school-admin-1',
      actorRole: 'school_admin',
      providers,
    })

    const found = await getRosterReport({
      id: staged.id,
      actorRole: 'school_admin',
      providers,
    })
    expect(found.id).toBe(staged.id)

    await expect(
      getRosterReport({
        id: 'non-existent-report-id',
        actorRole: 'school_admin',
        providers,
      }),
    ).rejects.toThrow('Roster report not found.')
  })
})
