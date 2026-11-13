import type {
  AcademicPeriod,
  AppProviders,
  ClassEnrollment,
  ClassEnrollmentStatus,
  ClassRoom,
  IdentityRole,
} from '../../../providers/types.js'
import { assertAdminAccess, assertChronosStaffAccess } from './shared.js'

// --- Academic Periods ---

export async function listAcademicPeriods(params: {
  actorRole: IdentityRole | null
  filter?: { isActive?: boolean }
  providers: AppProviders
}): Promise<AcademicPeriod[]> {
  assertChronosStaffAccess(params.actorRole)
  return params.providers.domainStore.listAcademicPeriods(params.filter)
}

export async function createAcademicPeriod(params: {
  name: string
  startDate: string
  endDate: string
  isActive?: boolean
  schoolId?: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<AcademicPeriod> {
  assertAdminAccess(params.actorRole)
  const period = await params.providers.domainStore.createAcademicPeriod({
    name: params.name,
    startDate: params.startDate,
    endDate: params.endDate,
    isActive: params.isActive,
    schoolId: params.schoolId,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'create_academic_period',
    entity_type: 'academic_period',
    entity_id: period.id,
    details: {
      name: period.name,
      start_date: period.start_date,
      end_date: period.end_date,
      is_active: period.is_active,
    },
  })

  return period
}

export async function updateAcademicPeriod(params: {
  id: string
  name?: string
  startDate?: string
  endDate?: string
  isActive?: boolean
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<AcademicPeriod> {
  assertAdminAccess(params.actorRole)
  const period = await params.providers.domainStore.updateAcademicPeriod(params.id, {
    name: params.name,
    startDate: params.startDate,
    endDate: params.endDate,
    isActive: params.isActive,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'update_academic_period',
    entity_type: 'academic_period',
    entity_id: period.id,
    details: {
      name: period.name,
      start_date: period.start_date,
      end_date: period.end_date,
      is_active: period.is_active,
    },
  })

  return period
}

export async function setActiveAcademicPeriod(params: {
  id: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<AcademicPeriod> {
  assertAdminAccess(params.actorRole)
  const period = await params.providers.domainStore.setActiveAcademicPeriod(params.id)

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'set_active_academic_period',
    entity_type: 'academic_period',
    entity_id: period.id,
    details: {
      name: period.name,
      is_active: true,
    },
  })

  return period
}

// --- Classes ---

export async function listClasses(params: {
  schoolId?: string
  academicPeriodId?: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<ClassRoom[]> {
  assertChronosStaffAccess(params.actorRole)
  return params.providers.domainStore.getClasses(params.schoolId, params.academicPeriodId)
}

export async function createClass(params: {
  name: string
  grade?: number | null
  academicPeriodId?: string | null
  schoolId?: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<ClassRoom> {
  assertAdminAccess(params.actorRole)
  const cls = await params.providers.domainStore.createClass({
    name: params.name,
    grade: params.grade,
    academicPeriodId: params.academicPeriodId,
    schoolId: params.schoolId,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'create_class',
    entity_type: 'class',
    entity_id: cls.id,
    details: {
      name: cls.name,
      grade: cls.grade,
      academic_period_id: cls.academic_period_id,
    },
  })

  return cls
}

export async function updateClass(params: {
  id: string
  name?: string
  grade?: number | null
  academicPeriodId?: string | null
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<ClassRoom> {
  assertAdminAccess(params.actorRole)
  const cls = await params.providers.domainStore.updateClass(params.id, {
    name: params.name,
    grade: params.grade,
    academicPeriodId: params.academicPeriodId,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'update_class',
    entity_type: 'class',
    entity_id: cls.id,
    details: {
      name: cls.name,
      grade: cls.grade,
      academic_period_id: cls.academic_period_id,
    },
  })

  return cls
}

// --- Class Enrollments ---

export async function listClassEnrollments(params: {
  userId?: string
  classId?: string
  academicPeriodId?: string
  status?: ClassEnrollmentStatus
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<ClassEnrollment[]> {
  assertChronosStaffAccess(params.actorRole)
  return params.providers.domainStore.listClassEnrollments({
    userId: params.userId,
    classId: params.classId,
    academicPeriodId: params.academicPeriodId,
    status: params.status,
  })
}

export async function enrollStudent(params: {
  userId: string
  classId: string
  academicPeriodId: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<ClassEnrollment> {
  assertAdminAccess(params.actorRole)
  const enrollment = await params.providers.domainStore.enrollStudentInClass({
    userId: params.userId,
    classId: params.classId,
    academicPeriodId: params.academicPeriodId,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'enroll_student',
    entity_type: 'class_enrollment',
    entity_id: enrollment.id,
    details: {
      user_id: enrollment.user_id,
      class_id: enrollment.class_id,
      academic_period_id: enrollment.academic_period_id,
      status: enrollment.status,
    },
  })

  return enrollment
}

export async function transferStudentEnrollment(params: {
  userId: string
  toClassId: string
  academicPeriodId: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<{ previous: ClassEnrollment; current: ClassEnrollment }> {
  assertAdminAccess(params.actorRole)
  const result = await params.providers.domainStore.transferStudentEnrollment({
    userId: params.userId,
    toClassId: params.toClassId,
    academicPeriodId: params.academicPeriodId,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'transfer_student_enrollment',
    entity_type: 'class_enrollment',
    entity_id: result.current.id,
    details: {
      user_id: params.userId,
      from_class_id: result.previous.class_id,
      to_class_id: result.current.class_id,
      academic_period_id: params.academicPeriodId,
    },
  })

  return result
}

export async function promoteStudentEnrollment(params: {
  userId: string
  fromAcademicPeriodId: string
  toAcademicPeriodId: string
  toClassId: string
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<{ previous: ClassEnrollment; current: ClassEnrollment }> {
  assertAdminAccess(params.actorRole)
  const result = await params.providers.domainStore.promoteStudentEnrollment({
    userId: params.userId,
    fromAcademicPeriodId: params.fromAcademicPeriodId,
    toAcademicPeriodId: params.toAcademicPeriodId,
    toClassId: params.toClassId,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'promote_student_enrollment',
    entity_type: 'class_enrollment',
    entity_id: result.current.id,
    details: {
      user_id: params.userId,
      from_academic_period_id: params.fromAcademicPeriodId,
      to_academic_period_id: params.toAcademicPeriodId,
      to_class_id: result.current.class_id,
    },
  })

  return result
}

export async function exitStudentEnrollment(params: {
  userId: string
  academicPeriodId: string
  status?: 'archived' | 'graduated'
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<ClassEnrollment> {
  assertAdminAccess(params.actorRole)
  const enrollment = await params.providers.domainStore.exitStudentEnrollment({
    userId: params.userId,
    academicPeriodId: params.academicPeriodId,
    status: params.status,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'exit_student_enrollment',
    entity_type: 'class_enrollment',
    entity_id: enrollment.id,
    details: {
      user_id: params.userId,
      academic_period_id: params.academicPeriodId,
      status: enrollment.status,
    },
  })

  return enrollment
}
