import type {
  AcademicPeriod,
  CalendarException,
  ClassEnrollment,
  ClassRoom,
  CreateAcademicPeriodParams,
  CreateCalendarExceptionParams,
  CreateClassParams,
  CreateLocationParams,
  CreatePasswordResetCodeParams,
  CreateScheduleParams,
  EnrollStudentParams,
  ExitStudentEnrollmentParams,
  Location,
  PasswordResetCode,
  ProfileLifecycleStatus,
  PromoteStudentEnrollmentParams,
  Schedule,
  StudentBinding,
  StudentRosterRow,
  TransferStudentEnrollmentParams,
  UpdateAcademicPeriodParams,
  UpdateCalendarExceptionParams,
  UpdateClassParams,
  UpdateLocationParams,
  UpdateScheduleParams,
  UserProfile,
} from '../types.js'
import {
  createMemoryAcademicPeriod,
  createMemoryClass,
  enrollMemoryStudentInClass,
  exitMemoryStudentEnrollment,
  getMemoryAcademicPeriod,
  getMemoryActiveAcademicPeriod,
  getMemoryActiveClassEnrollment,
  getMemoryClassById,
  getMemoryClasses,
  listMemoryAcademicPeriods,
  promoteMemoryStudentEnrollment,
  setMemoryActiveAcademicPeriod,
  transferMemoryStudentEnrollment,
  updateMemoryAcademicPeriod,
  updateMemoryClass,
} from './academic-enrollment.js'
import { MemoryDomainStoreBase } from './domain-store-base.js'
import {
  createMemoryCalendarException,
  createMemoryLocation,
  createMemorySchedule,
  deleteMemoryCalendarException,
  deleteMemoryLocation,
  deleteMemorySchedule,
  getMemoryActiveSchedule,
  getMemoryCalendarExceptionByDate,
  getMemoryCalendarExceptionById,
  getMemoryLocationById,
  getMemoryScheduleById,
  listMemoryCalendarExceptions,
  listMemoryLocations,
  listMemorySchedules,
  updateMemoryCalendarException,
  updateMemoryLocation,
  updateMemorySchedule,
} from './schedules-locations-calendar.js'
import {
  bindMemoryStudentToUser,
  createMemoryPasswordResetCode,
  createMemoryPendingStudentProfile,
  getMemoryActivePasswordResetCode,
  getMemoryProfileByNis,
  getMemoryUserProfile,
  listMemoryStudentProfiles,
  markMemoryPasswordResetCodeUsed,
  unbindMemoryStudentByNis,
  updateMemoryProfileEmail,
  updateMemoryProfileLifecycle,
  updateMemoryUserProfile,
} from './students-profiles.js'

export class MemoryDomainStoreOperations extends MemoryDomainStoreBase {
  async getUserProfile(userId: string): Promise<UserProfile> {
    return getMemoryUserProfile(this, userId)
  }
  async updateUserProfile(userId: string, updates: Partial<UserProfile>): Promise<void> {
    updateMemoryUserProfile(this, userId, updates)
  }
  async getProfileByNis(nis: string): Promise<UserProfile | null> {
    return getMemoryProfileByNis(this, nis)
  }
  async bindStudentToUser(params: { studentId: string; userId: string }): Promise<StudentBinding> {
    return bindMemoryStudentToUser(this, params)
  }
  async unbindStudentByNis(nis: string): Promise<void> {
    return unbindMemoryStudentByNis(this, nis)
  }
  async listStudentProfiles(filter?: {
    lifecycle_status?: ProfileLifecycleStatus
  }): Promise<StudentRosterRow[]> {
    return listMemoryStudentProfiles(this, filter)
  }
  async createPendingStudentProfile(params: {
    userId: string
    nis: string
    email: string
    fullName: string
    className: string
  }): Promise<UserProfile> {
    return createMemoryPendingStudentProfile(this, params)
  }
  async updateProfileLifecycle(
    userId: string,
    status: ProfileLifecycleStatus,
  ): Promise<UserProfile> {
    return updateMemoryProfileLifecycle(this, userId, status)
  }
  async updateProfileEmail(userId: string, email: string): Promise<UserProfile> {
    return updateMemoryProfileEmail(this, userId, email)
  }
  async createPasswordResetCode(params: CreatePasswordResetCodeParams): Promise<PasswordResetCode> {
    return createMemoryPasswordResetCode(this, params)
  }
  async getActivePasswordResetCode(
    userId: string,
    code: string,
  ): Promise<PasswordResetCode | null> {
    return getMemoryActivePasswordResetCode(this, userId, code)
  }
  async markPasswordResetCodeUsed(codeId: string): Promise<void> {
    markMemoryPasswordResetCodeUsed(this, codeId)
  }

  async getActiveSchedule(
    dayKey: string,
    params?: { classId?: string; academicPeriodId?: string },
  ): Promise<Schedule | null> {
    return getMemoryActiveSchedule(this, dayKey, params)
  }
  async listSchedules(filter?: {
    classId?: string
    academicPeriodId?: string
    dayOfWeek?: string
    isActive?: boolean
  }): Promise<Schedule[]> {
    return listMemorySchedules(this, filter)
  }
  async getScheduleById(id: string): Promise<Schedule | null> {
    return getMemoryScheduleById(this, id)
  }
  async createSchedule(params: CreateScheduleParams): Promise<Schedule> {
    return createMemorySchedule(this, params)
  }
  async updateSchedule(id: string, params: UpdateScheduleParams): Promise<Schedule> {
    return updateMemorySchedule(this, id, params)
  }
  async deleteSchedule(id: string): Promise<void> {
    deleteMemorySchedule(this, id)
  }

  async listLocations(filter?: { isActive?: boolean }): Promise<Location[]> {
    return listMemoryLocations(this, filter)
  }
  async getLocationById(id: string): Promise<Location | null> {
    return getMemoryLocationById(this, id)
  }
  async createLocation(params: CreateLocationParams): Promise<Location> {
    return createMemoryLocation(this, params)
  }
  async updateLocation(id: string, params: UpdateLocationParams): Promise<Location> {
    return updateMemoryLocation(this, id, params)
  }
  async deleteLocation(id: string): Promise<void> {
    deleteMemoryLocation(this, id)
  }

  async listCalendarExceptions(filter?: {
    academicPeriodId?: string
    startDate?: string
    endDate?: string
  }): Promise<CalendarException[]> {
    return listMemoryCalendarExceptions(this, filter)
  }
  async getCalendarExceptionById(id: string): Promise<CalendarException | null> {
    return getMemoryCalendarExceptionById(this, id)
  }
  async getCalendarExceptionByDate(
    date: string,
    academicPeriodId?: string,
  ): Promise<CalendarException | null> {
    return getMemoryCalendarExceptionByDate(this, date, academicPeriodId)
  }
  async createCalendarException(params: CreateCalendarExceptionParams): Promise<CalendarException> {
    return createMemoryCalendarException(this, params)
  }
  async updateCalendarException(
    id: string,
    params: UpdateCalendarExceptionParams,
  ): Promise<CalendarException> {
    return updateMemoryCalendarException(this, id, params)
  }
  async deleteCalendarException(id: string): Promise<void> {
    deleteMemoryCalendarException(this, id)
  }

  async listAcademicPeriods(filter?: { isActive?: boolean }): Promise<AcademicPeriod[]> {
    return listMemoryAcademicPeriods(this, filter)
  }
  async getAcademicPeriod(id: string): Promise<AcademicPeriod | null> {
    return getMemoryAcademicPeriod(this, id)
  }
  async getActiveAcademicPeriod(): Promise<AcademicPeriod | null> {
    return getMemoryActiveAcademicPeriod(this)
  }
  async createAcademicPeriod(params: CreateAcademicPeriodParams): Promise<AcademicPeriod> {
    return createMemoryAcademicPeriod(this, params)
  }
  async updateAcademicPeriod(
    id: string,
    params: UpdateAcademicPeriodParams,
  ): Promise<AcademicPeriod> {
    return updateMemoryAcademicPeriod(this, id, params)
  }
  async setActiveAcademicPeriod(id: string): Promise<AcademicPeriod> {
    return setMemoryActiveAcademicPeriod(this, id)
  }

  async getClasses(schoolId?: string, academicPeriodId?: string): Promise<ClassRoom[]> {
    return getMemoryClasses(this, schoolId, academicPeriodId)
  }
  async getClassById(id: string): Promise<ClassRoom | null> {
    return getMemoryClassById(this, id)
  }
  async createClass(params: CreateClassParams): Promise<ClassRoom> {
    return createMemoryClass(this, params)
  }
  async updateClass(id: string, params: UpdateClassParams): Promise<ClassRoom> {
    return updateMemoryClass(this, id, params)
  }

  async getActiveClassEnrollment(
    userId: string,
    academicPeriodId?: string,
  ): Promise<ClassEnrollment | null> {
    return getMemoryActiveClassEnrollment(this, userId, academicPeriodId)
  }
  async enrollStudentInClass(params: EnrollStudentParams): Promise<ClassEnrollment> {
    return enrollMemoryStudentInClass(this, params)
  }
  async transferStudentEnrollment(
    params: TransferStudentEnrollmentParams,
  ): Promise<{ previous: ClassEnrollment; current: ClassEnrollment }> {
    return transferMemoryStudentEnrollment(this, params)
  }
  async promoteStudentEnrollment(
    params: PromoteStudentEnrollmentParams,
  ): Promise<{ previous: ClassEnrollment; current: ClassEnrollment }> {
    return promoteMemoryStudentEnrollment(this, params)
  }
  async exitStudentEnrollment(params: ExitStudentEnrollmentParams): Promise<ClassEnrollment> {
    return exitMemoryStudentEnrollment(this, params)
  }
  async getStudentEnrollmentHistory(userId: string): Promise<ClassEnrollment[]> {
    return this.listClassEnrollments({ userId })
  }
}
