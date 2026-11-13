import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../../src/lib/errors/app-error.js'
import { getStudent, listStudents } from '../../../src/modules/admin/service.js'
import { MemoryDomainStore } from '../../../src/providers/memory/index.js'
import { getProfile } from '../../../src/modules/profile/service.js'
import { createAdminStudentTestProviders } from './admin-student-service-harness.js'

describe('unit: admin student management service', () => {
  it('projects canonical roster fields consistently for admin and mobile without rewriting profiles', async () => {
    const domainStore = new MemoryDomainStore()
    const providers = createAdminStudentTestProviders(domainStore)
    const legacy = {
      user_id: 's1',
      nis: '1001',
      full_name: 'Legacy Name',
      email: 'account@example.invalid',
      class_name: 'Old Class',
      absence_number: null,
      gender: null,
      role: 'student' as const,
      lifecycle_status: 'approved' as const,
    }
    domainStore.profiles.set('s1', legacy)
    const student = await domainStore.createStudent({
      nis: '1001',
      fullName: 'Canonical Name',
      gender: 'P',
    })
    await domainStore.bindStudentToUser({ studentId: student.id, userId: 's1' })
    const period = await domainStore.createAcademicPeriod({
      name: 'Current',
      startDate: '2026-07-01',
      endDate: '2027-06-30',
      isActive: true,
    })
    const cls = await domainStore.createClass({ name: 'X PPLG 1', academicPeriodId: period.id })
    domainStore.classEnrollments.push({
      id: 'enrollment',
      student_id: student.id,
      user_id: 's1',
      class_id: cls.id,
      academic_period_id: period.id,
      status: 'active',
      absence_number: '6',
    })
    for (const result of [
      await getStudent({ userId: 's1', actorRole: 'school_admin', providers }),
      await getProfile('s1', providers),
    ]) {
      expect(result).toMatchObject({
        user_id: 's1',
        nis: '1001',
        full_name: 'Canonical Name',
        class_name: 'X PPLG 1',
        absence_number: '6',
        gender: 'P',
        email: legacy.email,
        role: 'student',
        lifecycle_status: 'approved',
      })
    }
    expect(domainStore.profiles.get('s1')).toEqual(legacy)
  })

  it('retains legacy details when a canonical roster is absent or belongs to another identity', async () => {
    const domainStore = new MemoryDomainStore()
    const providers = createAdminStudentTestProviders(domainStore)
    const legacy = {
      user_id: 's1',
      nis: '1001',
      full_name: 'Legacy Student',
      class_name: 'Legacy Class',
      absence_number: '4',
      gender: 'L',
      role: 'student' as const,
      lifecycle_status: 'pending' as const,
    }
    domainStore.profiles.set('s1', legacy)
    const params = { userId: 's1', actorRole: 'school_admin' as const, providers }
    expect(await getStudent(params)).toEqual(legacy)
    const canonical = await domainStore.createStudent({
      nis: '1001',
      fullName: 'Other Identity',
      gender: 'P',
    })
    await domainStore.bindStudentToUser({ studentId: canonical.id, userId: 'other-user' })
    expect(await getStudent(params)).toEqual(legacy)
    const read = vi
      .spyOn(domainStore, 'getRosterStudentByNis')
      .mockRejectedValueOnce(new Error('Roster unavailable'))
    await expect(getStudent(params)).rejects.toThrow('Roster unavailable')
    read.mockRestore()
    expect(domainStore.profiles.get('s1')).toEqual(legacy)
  })

  it('lists student profiles with and without lifecycle filter', async () => {
    const domainStore = new MemoryDomainStore()
    const providers = createAdminStudentTestProviders(domainStore)

    domainStore.profiles.set('s1', {
      user_id: 's1',
      nis: '1001',
      full_name: 'Student 1',
      role: 'student',
      lifecycle_status: 'pending',
      gender: null,
    })
    domainStore.profiles.set('s2', {
      user_id: 's2',
      nis: '1002',
      full_name: 'Student 2',
      role: 'student',
      lifecycle_status: 'approved',
      gender: null,
    })
    domainStore.profiles.set('admin-1', {
      user_id: 'admin-1',
      full_name: 'School Admin',
      role: 'school_admin',
      lifecycle_status: 'approved',
      gender: null,
    })

    const allStudents = await listStudents({
      actorRole: 'school_admin',
      providers,
    })
    expect(allStudents.length).toBe(2)

    const pendingStudents = await listStudents({
      status: 'pending',
      actorRole: 'school_admin',
      providers,
    })
    expect(pendingStudents.length).toBe(1)
    expect(pendingStudents[0].user_id).toBe('s1')

    const approvedStudents = await listStudents({
      status: 'approved',
      actorRole: 'platform_admin',
      providers,
    })
    expect(approvedStudents.length).toBe(1)
    expect(approvedStudents[0].user_id).toBe('s2')
  })

  it('rejects list students for non-privileged actors', async () => {
    const providers = createAdminStudentTestProviders()

    await expect(
      listStudents({
        actorRole: 'student',
        providers,
      }),
    ).rejects.toThrowError(AppError)

    await expect(
      listStudents({
        actorRole: null,
        providers,
      }),
    ).rejects.toThrowError(AppError)
  })

  it('allows list students for teacher and staff roles', async () => {
    const providers = createAdminStudentTestProviders()

    const teacherStudents = await listStudents({
      actorRole: 'teacher',
      providers,
    })
    expect(teacherStudents).toEqual([])

    const staffStudents = await listStudents({
      actorRole: 'staff',
      providers,
    })
    expect(staffStudents).toEqual([])
  })

  it('retrieves individual student profile by user_id', async () => {
    const domainStore = new MemoryDomainStore()
    const providers = createAdminStudentTestProviders(domainStore)

    domainStore.profiles.set('s1', {
      user_id: 's1',
      nis: '1001',
      full_name: 'Student 1',
      role: 'student',
      lifecycle_status: 'pending',
      gender: null,
    })

    const student = await getStudent({
      userId: 's1',
      actorRole: 'school_admin',
      providers,
    })
    expect(student.user_id).toBe('s1')
    expect(student.nis).toBe('1001')
  })
})
