import type {
  AcademicPeriod,
  AppProviders,
  AuditLogDetails,
  BatchClassMappingInput,
  BatchStudentOverrideInput,
  BatchTransitionCommitResult,
  BatchTransitionMode,
  BatchTransitionPreview,
  ClassEnrollment,
  ClassEnrollmentStatus,
  ClassRoom,
  IdentityRole,
} from '../../../providers/types.js'
import { assertAdminAccess, assertChronosStaffAccess, withAuditCorrelation } from './shared.js'

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
  requestId?: string
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
    details: withAuditCorrelation(
      {
        name: period.name,
        start_date: period.start_date,
        end_date: period.end_date,
        is_active: period.is_active,
      },
      params.requestId,
    ),
  })

  return period
}

export async function updateAcademicPeriod(params: {
  id: string
  name?: string
  startDate?: string
  endDate?: string
  isActive?: boolean
  overrideLocked?: boolean
  reason?: string
  actorId: string
  actorRole: IdentityRole | null
  requestId?: string
  providers: AppProviders
}): Promise<AcademicPeriod> {
  assertAdminAccess(params.actorRole)
  const period = await params.providers.domainStore.updateAcademicPeriod(params.id, {
    name: params.name,
    startDate: params.startDate,
    endDate: params.endDate,
    isActive: params.isActive,
    overrideLocked: params.overrideLocked,
    reason: params.reason,
  })

  const updateDetails: AuditLogDetails = {
    name: period.name,
    start_date: period.start_date,
    end_date: period.end_date,
    is_active: period.is_active,
    override_locked: params.overrideLocked === true,
  }
  if (params.reason) updateDetails.reason = params.reason

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'update_academic_period',
    entity_type: 'academic_period',
    entity_id: period.id,
    details: withAuditCorrelation(updateDetails, params.requestId),
  })

  return period
}

export async function setActiveAcademicPeriod(params: {
  id: string
  actorId: string
  actorRole: IdentityRole | null
  requestId?: string
  providers: AppProviders
}): Promise<AcademicPeriod> {
  assertAdminAccess(params.actorRole)
  const period = await params.providers.domainStore.setActiveAcademicPeriod(params.id)

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'set_active_academic_period',
    entity_type: 'academic_period',
    entity_id: period.id,
    details: withAuditCorrelation(
      {
        name: period.name,
        is_active: true,
      },
      params.requestId,
    ),
  })

  return period
}

export async function lockAcademicPeriod(params: {
  id: string
  reason: string
  actorId: string
  actorRole: IdentityRole | null
  requestId?: string
  providers: AppProviders
}): Promise<AcademicPeriod> {
  assertAdminAccess(params.actorRole)
  const period = await params.providers.domainStore.lockAcademicPeriod({
    id: params.id,
    reason: params.reason,
    lockedBy: params.actorId,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'lock_academic_period',
    entity_type: 'academic_period',
    entity_id: period.id,
    details: withAuditCorrelation(
      {
        name: period.name,
        lock_reason: params.reason,
      },
      params.requestId,
    ),
  })

  return period
}

export async function unlockAcademicPeriod(params: {
  id: string
  reason: string
  actorId: string
  actorRole: IdentityRole | null
  requestId?: string
  providers: AppProviders
}): Promise<AcademicPeriod> {
  assertAdminAccess(params.actorRole)
  const period = await params.providers.domainStore.unlockAcademicPeriod({
    id: params.id,
    reason: params.reason,
    unlockedBy: params.actorId,
  })

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'unlock_academic_period',
    entity_type: 'academic_period',
    entity_id: period.id,
    details: withAuditCorrelation(
      {
        name: period.name,
        reason: params.reason,
      },
      params.requestId,
    ),
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
  requestId?: string
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
    details: withAuditCorrelation(
      {
        name: cls.name,
        grade: cls.grade,
        academic_period_id: cls.academic_period_id,
      },
      params.requestId,
    ),
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
  requestId?: string
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
    details: withAuditCorrelation(
      {
        name: cls.name,
        grade: cls.grade,
        academic_period_id: cls.academic_period_id,
      },
      params.requestId,
    ),
  })

  return cls
}

export async function deleteClass(params: {
  id: string
  overrideLocked?: boolean
  reason?: string
  actorId: string
  actorRole: IdentityRole | null
  requestId?: string
  providers: AppProviders
}): Promise<void> {
  assertAdminAccess(params.actorRole)
  await params.providers.domainStore.deleteClass(params.id, {
    overrideLocked: params.overrideLocked,
    reason: params.reason,
  })

  const deleteDetails: AuditLogDetails = {
    id: params.id,
    override_locked: params.overrideLocked === true,
  }
  if (params.reason) deleteDetails.reason = params.reason

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'delete_class',
    entity_type: 'class',
    entity_id: params.id,
    details: withAuditCorrelation(deleteDetails, params.requestId),
  })
}

// --- Class Enrollments ---

export async function listClassEnrollments(params: {
  studentId?: string
  userId?: string
  classId?: string
  academicPeriodId?: string
  status?: ClassEnrollmentStatus
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<ClassEnrollment[]> {
  assertChronosStaffAccess(params.actorRole)
  return params.providers.domainStore.listClassEnrollments({
    studentId: params.studentId,
    userId: params.userId,
    classId: params.classId,
    academicPeriodId: params.academicPeriodId,
    status: params.status,
  })
}

export async function enrollStudent(params: {
  studentId?: string
  userId?: string
  classId: string
  academicPeriodId: string
  absenceNumber?: string | null
  effectiveDate?: string
  overrideLocked?: boolean
  reason?: string
  actorId: string
  actorRole: IdentityRole | null
  requestId?: string
  providers: AppProviders
}): Promise<ClassEnrollment> {
  assertAdminAccess(params.actorRole)
  const enrollment = await params.providers.domainStore.enrollStudentInClass({
    studentId: params.studentId,
    userId: params.userId,
    classId: params.classId,
    academicPeriodId: params.academicPeriodId,
    absenceNumber: params.absenceNumber,
    effectiveDate: params.effectiveDate,
    overrideLocked: params.overrideLocked,
    reason: params.reason,
  })

  const enrollDetails: AuditLogDetails = {
    student_id: enrollment.student_id ?? null,
    user_id: enrollment.user_id,
    class_id: enrollment.class_id,
    academic_period_id: enrollment.academic_period_id,
    status: enrollment.status,
    override_locked: params.overrideLocked === true,
  }
  if (params.reason) enrollDetails.reason = params.reason

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'enroll_student',
    entity_type: 'class_enrollment',
    entity_id: enrollment.id,
    details: withAuditCorrelation(enrollDetails, params.requestId),
  })

  return enrollment
}

export async function transferStudentEnrollment(params: {
  studentId?: string
  userId?: string
  toClassId: string
  academicPeriodId: string
  absenceNumber?: string | null
  effectiveDate?: string
  overrideLocked?: boolean
  reason?: string
  actorId: string
  actorRole: IdentityRole | null
  requestId?: string
  providers: AppProviders
}): Promise<{ previous: ClassEnrollment; current: ClassEnrollment }> {
  assertAdminAccess(params.actorRole)
  const result = await params.providers.domainStore.transferStudentEnrollment({
    studentId: params.studentId,
    userId: params.userId,
    toClassId: params.toClassId,
    academicPeriodId: params.academicPeriodId,
    absenceNumber: params.absenceNumber,
    effectiveDate: params.effectiveDate,
    overrideLocked: params.overrideLocked,
    reason: params.reason,
  })

  const transferDetails: AuditLogDetails = {
    student_id: result.current.student_id ?? params.studentId ?? null,
    user_id: result.current.user_id ?? params.userId ?? null,
    from_class_id: result.previous.class_id,
    to_class_id: result.current.class_id,
    academic_period_id: params.academicPeriodId,
    override_locked: params.overrideLocked === true,
  }
  if (params.reason) transferDetails.reason = params.reason

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'transfer_student_enrollment',
    entity_type: 'class_enrollment',
    entity_id: result.current.id,
    details: withAuditCorrelation(transferDetails, params.requestId),
  })

  return result
}

export async function promoteStudentEnrollment(params: {
  studentId?: string
  userId?: string
  fromAcademicPeriodId: string
  toAcademicPeriodId: string
  toClassId: string
  absenceNumber?: string | null
  effectiveDate?: string
  overrideLocked?: boolean
  reason?: string
  actorId: string
  actorRole: IdentityRole | null
  requestId?: string
  providers: AppProviders
}): Promise<{ previous: ClassEnrollment; current: ClassEnrollment }> {
  assertAdminAccess(params.actorRole)
  const result = await params.providers.domainStore.promoteStudentEnrollment({
    studentId: params.studentId,
    userId: params.userId,
    fromAcademicPeriodId: params.fromAcademicPeriodId,
    toAcademicPeriodId: params.toAcademicPeriodId,
    toClassId: params.toClassId,
    absenceNumber: params.absenceNumber,
    effectiveDate: params.effectiveDate,
    overrideLocked: params.overrideLocked,
    reason: params.reason,
  })

  const promoteDetails: AuditLogDetails = {
    student_id: result.current.student_id ?? params.studentId ?? null,
    user_id: result.current.user_id ?? params.userId ?? null,
    from_academic_period_id: params.fromAcademicPeriodId,
    to_academic_period_id: params.toAcademicPeriodId,
    to_class_id: result.current.class_id,
    override_locked: params.overrideLocked === true,
  }
  if (params.reason) promoteDetails.reason = params.reason

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'promote_student_enrollment',
    entity_type: 'class_enrollment',
    entity_id: result.current.id,
    details: withAuditCorrelation(promoteDetails, params.requestId),
  })

  return result
}

export async function exitStudentEnrollment(params: {
  studentId?: string
  userId?: string
  academicPeriodId: string
  status?: 'archived' | 'graduated'
  effectiveDate?: string
  overrideLocked?: boolean
  reason?: string
  actorId: string
  actorRole: IdentityRole | null
  requestId?: string
  providers: AppProviders
}): Promise<ClassEnrollment> {
  assertAdminAccess(params.actorRole)
  const enrollment = await params.providers.domainStore.exitStudentEnrollment({
    studentId: params.studentId,
    userId: params.userId,
    academicPeriodId: params.academicPeriodId,
    status: params.status,
    effectiveDate: params.effectiveDate,
    overrideLocked: params.overrideLocked,
    reason: params.reason,
  })

  const exitDetails: AuditLogDetails = {
    student_id: enrollment.student_id ?? params.studentId ?? null,
    user_id: enrollment.user_id ?? params.userId ?? null,
    academic_period_id: params.academicPeriodId,
    status: enrollment.status,
    override_locked: params.overrideLocked === true,
  }
  if (params.reason) exitDetails.reason = params.reason

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'exit_student_enrollment',
    entity_type: 'class_enrollment',
    entity_id: enrollment.id,
    details: withAuditCorrelation(exitDetails, params.requestId),
  })

  return enrollment
}

export async function previewBatchEnrollmentTransition(params: {
  fromAcademicPeriodId: string
  toAcademicPeriodId: string
  mode: BatchTransitionMode
  classMappings?: BatchClassMappingInput[]
  overrides?: BatchStudentOverrideInput[]
  clearConflictingAbsenceNumbers?: boolean
  effectiveDate?: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<BatchTransitionPreview> {
  assertAdminAccess(params.actorRole)
  return params.providers.domainStore.previewBatchEnrollmentTransition({
    fromAcademicPeriodId: params.fromAcademicPeriodId,
    toAcademicPeriodId: params.toAcademicPeriodId,
    mode: params.mode,
    classMappings: params.classMappings,
    overrides: params.overrides,
    clearConflictingAbsenceNumbers: params.clearConflictingAbsenceNumbers,
    effectiveDate: params.effectiveDate,
  })
}

export async function commitBatchEnrollmentTransition(params: {
  fromAcademicPeriodId: string
  toAcademicPeriodId: string
  mode: BatchTransitionMode
  classMappings?: BatchClassMappingInput[]
  overrides?: BatchStudentOverrideInput[]
  clearConflictingAbsenceNumbers?: boolean
  effectiveDate?: string
  sourceHash: string
  overrideLocked?: boolean
  reason?: string
  actorId: string
  actorRole: IdentityRole | null
  requestId?: string
  providers: AppProviders
}): Promise<BatchTransitionCommitResult> {
  assertAdminAccess(params.actorRole)
  const result = await params.providers.domainStore.commitBatchEnrollmentTransition({
    fromAcademicPeriodId: params.fromAcademicPeriodId,
    toAcademicPeriodId: params.toAcademicPeriodId,
    mode: params.mode,
    classMappings: params.classMappings,
    overrides: params.overrides,
    clearConflictingAbsenceNumbers: params.clearConflictingAbsenceNumbers,
    effectiveDate: params.effectiveDate,
    sourceHash: params.sourceHash,
    overrideLocked: params.overrideLocked,
    reason: params.reason,
  })

  const batchDetails: AuditLogDetails = {
    from_academic_period_id: result.from_academic_period_id,
    to_academic_period_id: result.to_academic_period_id,
    mode: result.mode,
    total: result.summary.total,
    promoted: result.summary.promoted,
    continued: result.summary.continued,
    retained: result.summary.retained,
    transferred: result.summary.transferred,
    graduated: result.summary.graduated,
    exited: result.summary.exited,
    created_count: result.created_count,
    closed_count: result.closed_count,
    override_locked: params.overrideLocked === true,
  }
  if (params.reason) batchDetails.reason = params.reason

  await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'batch_transition_enrollments',
    entity_type: 'academic_period',
    entity_id: params.toAcademicPeriodId,
    details: withAuditCorrelation(batchDetails, params.requestId),
  })

  return result
}
