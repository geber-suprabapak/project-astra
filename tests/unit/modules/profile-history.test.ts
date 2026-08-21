import { describe, expect, it } from 'vitest'
import { getProfile, getStudentEnrollmentHistory } from '../../../src/modules/profile/service.js'
import {
  getAttendanceCalendar,
  getAttendanceHistory,
  getStudentAttendanceHistory,
} from '../../../src/modules/attendance/service.js'
import {
  MemoryDomainStore,
  MemoryIdentityProvider,
  MemoryObjectStorage,
} from '../../../src/providers/memory/index.js'
import type { RobinClient } from '../../../src/clients/robin/client.js'

function setupTestEnvironment() {
  const domainStore = new MemoryDomainStore()
  const objectStorage = new MemoryObjectStorage()
  const identityProvider = new MemoryIdentityProvider()

  const defaultRobinClient: RobinClient = {
    checkReadiness: async () => ({ healthy: true }),
    getEnrollmentStatus: async () => ({
      status: 'enrolled',
      embeddingCount: 10,
      message: 'Ready.',
    }),
    enroll: async () => ({ imagesProcessed: 10, imagesFailed: 0, totalEmbeddings: 10 }),
    identify: async () => ({
      status: 'ok',
      confidence: 0.94,
      qualityScore: 0.91,
      processTimeMs: 38,
      message: 'Face verified successfully',
    }),
    deleteEnrollment: async () => {},
  }

  const providers = {
    domainStore,
    objectStorage,
    identityProvider,
    robinClient: defaultRobinClient,
  }

  // Setup approved student profile
  domainStore.profiles.set('student-1', {
    user_id: 'student-1',
    full_name: 'Budi Santoso',
    email: 'budi@school.sch.id',
    nis: '1001',
    class_name: 'XII RPL 1',
    absence_number: '05',
    role: 'student',
    lifecycle_status: 'approved',
    gender: 'L',
    avatar_url: 'avatars/student-1.jpg',
  })

  // Setup student 2 profile
  domainStore.profiles.set('student-2', {
    user_id: 'student-2',
    full_name: 'Siti Aminah',
    email: 'siti@school.sch.id',
    nis: '1002',
    class_name: 'XII RPL 1',
    absence_number: '12',
    role: 'student',
    lifecycle_status: 'approved',
    gender: 'P',
  })

  // Setup pending student profile
  domainStore.profiles.set('student-pending', {
    user_id: 'student-pending',
    full_name: 'Pending Student',
    email: 'pending@school.sch.id',
    nis: '1003',
    class_name: 'XII RPL 1',
    role: 'student',
    lifecycle_status: 'pending',
  })

  // Setup disabled student profile
  domainStore.profiles.set('student-disabled', {
    user_id: 'student-disabled',
    full_name: 'Disabled Student',
    email: 'disabled@school.sch.id',
    nis: '1004',
    class_name: 'XII RPL 1',
    role: 'student',
    lifecycle_status: 'disabled',
  })

  // Setup teacher profile
  domainStore.profiles.set('teacher-1', {
    user_id: 'teacher-1',
    full_name: 'Pak Guru',
    email: 'guru@school.sch.id',
    role: 'teacher',
    lifecycle_status: 'approved',
  })

  return { domainStore, objectStorage, identityProvider, providers }
}

describe('Student Profile and History Unit Tests', () => {
  describe('getProfile', () => {
    it('returns authorized profile with lifecycle status and signed avatar URL', async () => {
      const { providers } = setupTestEnvironment()

      const profile = await getProfile('student-1', providers)
      expect(profile.user_id).toBe('student-1')
      expect(profile.full_name).toBe('Budi Santoso')
      expect(profile.email).toBe('budi@school.sch.id')
      expect(profile.nis).toBe('1001')
      expect(profile.class_name).toBe('XII RPL 1')
      expect(profile.absence_number).toBe('05')
      expect(profile.gender).toBe('L')
      expect(profile.role).toBe('student')
      expect(profile.lifecycle_status).toBe('approved')
      expect(profile.avatar_url).toContain('student-1.jpg')
    })

    it('returns profile with active class enrollment context when enrolled', async () => {
      const { domainStore, providers } = setupTestEnvironment()

      // Create academic period and class
      const period = await domainStore.createAcademicPeriod({
        name: '2026/2027 Ganjil',
        startDate: '2026-07-01',
        endDate: '2026-12-31',
        isActive: true,
      })
      const cls = await domainStore.createClass({
        name: 'XII RPL 2 Dynamic',
        grade: 12,
        academicPeriodId: period.id,
      })

      // Enroll student
      await domainStore.enrollStudentInClass({
        userId: 'student-1',
        classId: cls.id,
        academicPeriodId: period.id,
      })

      const profile = await getProfile('student-1', providers)
      expect(profile.class_name).toBe('XII RPL 2 Dynamic')
      expect(profile.active_enrollment).toBeDefined()
      expect(profile.active_enrollment?.class_id).toBe(cls.id)
      expect(profile.active_enrollment?.academic_period_id).toBe(period.id)
    })
  })

  describe('getStudentEnrollmentHistory', () => {
    it('returns student class enrollment history across periods', async () => {
      const { domainStore, providers } = setupTestEnvironment()

      const period1 = await domainStore.createAcademicPeriod({
        name: '2025/2026 Genap',
        startDate: '2026-01-01',
        endDate: '2026-06-30',
        isActive: false,
      })
      const class1 = await domainStore.createClass({
        name: 'XI RPL 1',
        grade: 11,
        academicPeriodId: period1.id,
      })
      await domainStore.enrollStudentInClass({
        userId: 'student-1',
        classId: class1.id,
        academicPeriodId: period1.id,
      })

      const period2 = await domainStore.createAcademicPeriod({
        name: '2026/2027 Ganjil',
        startDate: '2026-07-01',
        endDate: '2026-12-31',
        isActive: true,
      })
      const class2 = await domainStore.createClass({
        name: 'XII RPL 1',
        grade: 12,
        academicPeriodId: period2.id,
      })
      await domainStore.enrollStudentInClass({
        userId: 'student-1',
        classId: class2.id,
        academicPeriodId: period2.id,
      })

      const history = await getStudentEnrollmentHistory('student-1', providers)
      expect(history.length).toBe(2)
      expect(history.some((h) => h.class_name === 'XI RPL 1')).toBe(true)
      expect(history.some((h) => h.class_name === 'XII RPL 1')).toBe(true)
    })

    it('rejects non-student roles from querying student enrollment history', async () => {
      const { providers } = setupTestEnvironment()

      await expect(getStudentEnrollmentHistory('teacher-1', providers)).rejects.toThrow(
        'Only students have class enrollment history.',
      )
    })
  })

  describe('getAttendanceHistory', () => {
    it('returns student attendance records with date range filtering', async () => {
      const { domainStore, providers } = setupTestEnvironment()

      // Seed attendances for student-1
      domainStore.attendancesList.push(
        {
          id: 'att-1',
          user_id: 'student-1',
          date: '2026-04-10',
          status: 'Hadir',
          action_type: 'check_in',
          latitude: -7.1234,
          longitude: 112.1234,
          created_at: '2026-04-10T07:05:00.000Z',
        },
        {
          id: 'att-2',
          user_id: 'student-1',
          date: '2026-04-10',
          status: 'Pulang',
          action_type: 'check_out',
          latitude: -7.1234,
          longitude: 112.1234,
          created_at: '2026-04-10T15:05:00.000Z',
        },
        {
          id: 'att-3',
          user_id: 'student-1',
          date: '2026-04-11',
          status: 'Terlambat',
          action_type: 'check_in',
          latitude: -7.1234,
          longitude: 112.1234,
          created_at: '2026-04-11T07:25:00.000Z',
        },
        {
          id: 'att-4',
          user_id: 'student-2', // Different student
          date: '2026-04-10',
          status: 'Hadir',
          action_type: 'check_in',
          latitude: -7.1234,
          longitude: 112.1234,
          created_at: '2026-04-10T07:02:00.000Z',
        },
      )

      // Query student-1 full history
      const result = await getAttendanceHistory({
        userId: 'student-1',
        providers,
      })

      expect(result.items.length).toBe(3)
      expect(result.items.every((i) => i.user_id === 'student-1')).toBe(true)

      // Query with date filter
      const filtered = await getAttendanceHistory({
        userId: 'student-1',
        startDate: '2026-04-11',
        endDate: '2026-04-11',
        providers,
      })
      expect(filtered.items.length).toBe(1)
      expect(filtered.items[0].id).toBe('att-3')
      expect(filtered.items[0].status).toBe('Terlambat')
    })

    it('rejects unapproved students from accessing attendance history', async () => {
      const { providers } = setupTestEnvironment()

      await expect(
        getStudentAttendanceHistory({ userId: 'student-pending', providers }),
      ).rejects.toThrow('Only approved students can access attendance history.')

      await expect(
        getStudentAttendanceHistory({ userId: 'student-disabled', providers }),
      ).rejects.toThrow('Only approved students can access attendance history.')
    })
  })

  describe('getAttendanceCalendar', () => {
    it('aggregates attendances, approved leave requests, and calendar holidays into monthly calendar result', async () => {
      const { domainStore, providers } = setupTestEnvironment()

      // 1. Seed attendances
      domainStore.attendancesList.push(
        {
          id: 'att-1',
          user_id: 'student-1',
          date: '2026-04-01',
          status: 'Hadir',
          action_type: 'check_in',
          created_at: '2026-04-01T07:05:00.000Z',
        },
        {
          id: 'att-2',
          user_id: 'student-1',
          date: '2026-04-01',
          status: 'Pulang',
          action_type: 'check_out',
          created_at: '2026-04-01T15:00:00.000Z',
        },
        {
          id: 'att-3',
          user_id: 'student-1',
          date: '2026-04-02',
          status: 'Terlambat',
          action_type: 'check_in',
          created_at: '2026-04-02T07:30:00.000Z',
        },
        {
          id: 'att-4',
          user_id: 'student-1',
          date: '2026-04-03',
          status: 'Alpha',
          action_type: null,
          created_at: '2026-04-03T12:00:00.000Z',
        },
      )

      // 2. Seed leave requests
      domainStore.permits.push(
        {
          id: 'leave-1',
          user_id: 'student-1',
          kategori_izin: 'sakit',
          deskripsi: 'Demam dan flu berat',
          status: true,
          link_foto: 'permits/surat-dokter.jpg',
          tanggal: '2026-04-06T00:00:00+07:00',
          approval_status: 'approved',
          created_at: '2026-04-06T06:30:00.000Z',
          rejection_reason: null,
          rejected_at: null,
        },
        {
          id: 'leave-2',
          user_id: 'student-1',
          kategori_izin: 'pergi',
          deskripsi: 'Acara keluarga di luar kota',
          status: true,
          link_foto: null,
          tanggal: '2026-04-07T00:00:00+07:00',
          approval_status: 'approved',
          created_at: '2026-04-07T06:30:00.000Z',
          rejection_reason: null,
          rejected_at: null,
        },
        {
          id: 'leave-rejected',
          user_id: 'student-1',
          kategori_izin: 'pergi',
          deskripsi: 'Bolos',
          status: false,
          link_foto: null,
          tanggal: '2026-04-08T00:00:00+07:00',
          approval_status: 'rejected',
          created_at: '2026-04-08T06:30:00.000Z',
          rejection_reason: 'Alasan tidak jelas',
          rejected_at: '2026-04-08T08:00:00.000Z',
        },
      )

      // 3. Seed calendar holiday
      await domainStore.createCalendarException({
        date: '2026-04-15',
        reason: 'Hari Raya Idul Fitri',
        isHoliday: true,
      })

      const calendar = await getAttendanceCalendar({
        userId: 'student-1',
        year: 2026,
        month: 4,
        providers,
      })

      expect(calendar.year).toBe(2026)
      expect(calendar.month).toBe(4)
      expect(calendar.start_date).toBe('2026-04-01')
      expect(calendar.end_date).toBe('2026-04-30')

      // Check statistics
      expect(calendar.stats.hadir).toBe(1)
      expect(calendar.stats.terlambat).toBe(1)
      expect(calendar.stats.alpha).toBe(1)
      expect(calendar.stats.sakit).toBe(1)
      expect(calendar.stats.izin).toBe(1)

      // Check day items
      const apr1 = calendar.items.find((i) => i.date === '2026-04-01')
      expect(apr1?.status).toBe('present')
      expect(apr1?.check_in_time).toBe('2026-04-01T07:05:00.000Z')
      expect(apr1?.check_out_time).toBe('2026-04-01T15:00:00.000Z')

      const apr2 = calendar.items.find((i) => i.date === '2026-04-02')
      expect(apr2?.status).toBe('late')
      expect(apr2?.is_late).toBe(true)

      const apr3 = calendar.items.find((i) => i.date === '2026-04-03')
      expect(apr3?.status).toBe('absent')

      const apr6 = calendar.items.find((i) => i.date === '2026-04-06')
      expect(apr6?.status).toBe('sick')
      expect(apr6?.attachment_url).toBeDefined()

      const apr7 = calendar.items.find((i) => i.date === '2026-04-07')
      expect(apr7?.status).toBe('leave')

      const apr15 = calendar.items.find((i) => i.date === '2026-04-15')
      expect(apr15?.status).toBe('holiday')
      expect(apr15?.holiday_reason).toBe('Hari Raya Idul Fitri')

      // Rejected leave requests are not counted in monthly leave stats
      const apr8 = calendar.items.find((i) => i.date === '2026-04-08')
      expect(apr8).toBeUndefined()
    })
  })
})
