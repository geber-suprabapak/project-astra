import { describe, expect, it } from 'vitest'
import {
  acceptRosterReport,
  bootstrapSchool,
  getBootstrapStatus,
  getRosterReport,
  openStudentSignup,
  validateAndStageRoster,
} from '../../../src/modules/admin/service.js'
import type { MemoryIdentityProvider } from '../../../src/providers/memory/index.js'
import type { CreateStudentParams, Student } from '../../../src/providers/types.js'
import { AppError } from '../../../src/lib/errors/app-error.js'
import { createTestProviders } from './admin-bootstrap-service-harness.js'

describe('admin bootstrap acceptance & signup unit tests', () => {
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

  it('acceptRosterReport allows platform_admin and denies teacher', async () => {
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
        actorId: 'teacher-1',
        actorRole: 'teacher',
        providers,
      }),
    ).rejects.toThrow(AppError)

    const accepted = await acceptRosterReport({
      id: staged.id,
      actorId: 'platform-admin-1',
      actorRole: 'platform_admin',
      providers,
    })
    expect(accepted.status).toBe('accepted')
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

  it('openStudentSignup denies teacher', async () => {
    const { providers } = createTestProviders()

    await expect(
      openStudentSignup({
        actorId: 'teacher-1',
        actorRole: 'teacher',
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
