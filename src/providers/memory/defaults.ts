import type { AcademicPeriod, ClassRoom, Location, Permission, Role, Schedule } from '../types.js'

export const DEFAULT_PERMISSIONS: Permission[] = [
  {
    id: 'd0000000-0000-0000-0000-000000000001',
    name: 'admin:read',
    description: 'Read administrative state and session',
  },
  {
    id: 'd0000000-0000-0000-0000-000000000002',
    name: 'admin:write',
    description: 'Write administrative configuration',
  },
  {
    id: 'd0000000-0000-0000-0000-000000000003',
    name: 'roles:manage',
    description: 'Create and modify roles and permissions',
  },
  {
    id: 'd0000000-0000-0000-0000-000000000004',
    name: 'staff:manage',
    description: 'Create and manage staff members and assign roles',
  },
  {
    id: 'd0000000-0000-0000-0000-000000000005',
    name: 'student:manage',
    description: 'Manage student profiles and approvals',
  },
  {
    id: 'd0000000-0000-0000-0000-000000000006',
    name: 'roster:manage',
    description: 'Stage and review student roster imports',
  },
  {
    id: 'd0000000-0000-0000-0000-000000000007',
    name: 'attendance:read',
    description: 'View attendance records',
  },
  {
    id: 'd0000000-0000-0000-0000-000000000008',
    name: 'attendance:write',
    description: 'Submit attendance check-in/out',
  },
  {
    id: 'd0000000-0000-0000-0000-000000000009',
    name: 'attendance:manual',
    description: 'Record manual attendance exceptions',
  },
  {
    id: 'd0000000-0000-0000-0000-000000000010',
    name: 'leave:read',
    description: 'View leave requests',
  },
  {
    id: 'd0000000-0000-0000-0000-000000000011',
    name: 'leave:submit',
    description: 'Submit leave requests',
  },
  {
    id: 'd0000000-0000-0000-0000-000000000012',
    name: 'leave:approve',
    description: 'Approve or reject leave requests',
  },
  {
    id: 'd0000000-0000-0000-0000-000000000013',
    name: 'profile:read',
    description: 'View profile information',
  },
  {
    id: 'd0000000-0000-0000-0000-000000000014',
    name: 'profile:write',
    description: 'Update profile information',
  },
]

export const DEFAULT_ROLES: Role[] = [
  {
    id: 'c0000000-0000-0000-0000-000000000001',
    name: 'platform_admin',
    description: 'Platform Administrator with full access',
    is_active: true,
    permissions: [
      'admin:read',
      'admin:write',
      'roles:manage',
      'staff:manage',
      'student:manage',
      'roster:manage',
    ],
  },
  {
    id: 'c0000000-0000-0000-0000-000000000002',
    name: 'school_admin',
    description: 'School Administrator for school-level operations',
    is_active: true,
    permissions: [
      'admin:read',
      'staff:manage',
      'student:manage',
      'roster:manage',
      'attendance:read',
      'attendance:manual',
      'leave:read',
      'leave:approve',
    ],
  },
  {
    id: 'c0000000-0000-0000-0000-000000000003',
    name: 'teacher',
    description: 'Teacher with attendance and leave management access',
    is_active: true,
    permissions: ['attendance:read', 'attendance:manual', 'leave:read', 'leave:approve'],
  },
  {
    id: 'c0000000-0000-0000-0000-000000000004',
    name: 'staff',
    description: 'General staff with operational read access',
    is_active: true,
    permissions: ['attendance:read', 'leave:read'],
  },
  {
    id: 'c0000000-0000-0000-0000-000000000005',
    name: 'student',
    description: 'Student with attendance check-in and leave submission access',
    is_active: true,
    permissions: ['attendance:read', 'attendance:write', 'leave:read', 'leave:submit'],
  },
]

export const DEFAULT_LOCATIONS: Location[] = [
  {
    id: 'a0000000-0000-0000-0000-000000000001',
    name: 'School Campus',
    latitude: -6.2,
    longitude: 106.816666,
    radius_meters: 5000.0,
    is_active: true,
  },
]

export const DEFAULT_SCHEDULES: Schedule[] = [
  {
    id: 'b0000000-0000-0000-0000-000000000001',
    day_of_week: 'senin',
    hari: 'senin',
    mulai_masuk: '06:00:00',
    selesai_masuk: '07:15:00',
    mulai_pulang: '15:00:00',
    selesai_pulang: '18:00:00',
    kompensasi_waktu: 15,
    is_active: true,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000002',
    day_of_week: 'selasa',
    hari: 'selasa',
    mulai_masuk: '06:00:00',
    selesai_masuk: '07:15:00',
    mulai_pulang: '15:00:00',
    selesai_pulang: '18:00:00',
    kompensasi_waktu: 15,
    is_active: true,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000003',
    day_of_week: 'rabu',
    hari: 'rabu',
    mulai_masuk: '06:00:00',
    selesai_masuk: '07:15:00',
    mulai_pulang: '15:00:00',
    selesai_pulang: '18:00:00',
    kompensasi_waktu: 15,
    is_active: true,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000004',
    day_of_week: 'kamis',
    hari: 'kamis',
    mulai_masuk: '06:00:00',
    selesai_masuk: '07:15:00',
    mulai_pulang: '15:00:00',
    selesai_pulang: '18:00:00',
    kompensasi_waktu: 15,
    is_active: true,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000005',
    day_of_week: 'jumat',
    hari: 'jumat',
    mulai_masuk: '06:00:00',
    selesai_masuk: '07:15:00',
    mulai_pulang: '11:30:00',
    selesai_pulang: '14:00:00',
    kompensasi_waktu: 15,
    is_active: true,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000006',
    day_of_week: 'sabtu',
    hari: 'sabtu',
    mulai_masuk: '06:00:00',
    selesai_masuk: '07:15:00',
    mulai_pulang: '12:00:00',
    selesai_pulang: '15:00:00',
    kompensasi_waktu: 15,
    is_active: true,
  },
]

export const DEFAULT_ACADEMIC_PERIODS: AcademicPeriod[] = [
  {
    id: 'b0000000-0000-0000-0000-000000000001',
    school_id: '11111111-1111-1111-1111-111111111111',
    name: '2026/2027 Ganjil',
    start_date: '2026-07-01',
    end_date: '2026-12-31',
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
]

export const DEFAULT_CLASSES: ClassRoom[] = [
  {
    id: 'c0000000-0000-0000-0000-000000000001',
    school_id: '11111111-1111-1111-1111-111111111111',
    academic_period_id: 'b0000000-0000-0000-0000-000000000001',
    name: 'XII RPL 1',
    grade: 12,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
]
