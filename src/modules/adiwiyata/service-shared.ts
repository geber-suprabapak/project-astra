import { AppError } from '../../lib/errors/app-error.js'
import { ErrorCode } from '../../lib/errors/codes.js'
import type {
  AcademicPeriod,
  AppProviders,
  CalendarException,
  IdentityRole,
  Schedule,
} from '../../providers/types.js'
import { getDayKeyWIB, getTodayWIB } from '../dashboard/service.js'

export interface AdiwiyataSchoolDay {
  is_school_day: boolean
  status: 'scheduled' | 'not_scheduled' | 'holiday'
  reason: string | null
}

export function notEligible(message: string): AppError {
  return new AppError(ErrorCode.ADIWIYATA_NOT_ELIGIBLE, 403, message)
}

export function configurationError(item: string, message: string, count?: number): AppError {
  const details =
    count === undefined
      ? { configuration_item: item }
      : { configuration_item: item, matching_rows: count }
  return new AppError(ErrorCode.ADIWIYATA_CONFIGURATION_ERROR, 503, message, details)
}

export function schoolDayForClass(
  period: AcademicPeriod,
  classId: string,
  schedules: Schedule[],
  exceptions: CalendarException[],
  now: Date,
): AdiwiyataSchoolDay {
  const date = getTodayWIB(now)
  const periodSchedules = schedules.filter(
    (schedule) =>
      schedule.school_id === period.school_id &&
      schedule.academic_period_id === period.id &&
      schedule.is_active,
  )
  if (periodSchedules.length === 0) {
    throw configurationError(
      'schedule',
      'Belum ada jadwal aktif Astra untuk sekolah dan Periode Akademik ini. Admin sekolah perlu memeriksa konfigurasi jadwal.',
      0,
    )
  }
  const holiday = exceptions.find(
    (exception) =>
      exception.date === date &&
      exception.is_holiday &&
      (exception.academic_period_id == null || exception.academic_period_id === period.id) &&
      (exception.school_id == null || exception.school_id === period.school_id),
  )
  if (holiday) return { is_school_day: false, status: 'holiday', reason: holiday.reason }
  const daySchedules = periodSchedules.filter(
    (schedule) => (schedule.day_of_week ?? schedule.hari)?.toLowerCase() === getDayKeyWIB(now),
  )
  const classSchedules = daySchedules.filter((schedule) => schedule.class_id === classId)
  const matching = classSchedules.length
    ? classSchedules
    : daySchedules.filter((schedule) => schedule.class_id === null)
  if (matching.length > 1) {
    throw configurationError(
      'schedule',
      'Astra memiliki beberapa jadwal aktif pada tingkat kelas yang berlaku untuk hari ini. Admin sekolah perlu memeriksa konfigurasi jadwal.',
      matching.length,
    )
  }
  return {
    is_school_day: matching.length === 1,
    status: matching.length === 1 ? 'scheduled' : 'not_scheduled',
    reason: null,
  }
}

export function requireAdiwiyataAdmin(role: IdentityRole | null): void {
  if (role !== 'school_admin' && role !== 'platform_admin') throw AppError.forbidden()
}

export async function getActiveSitePeriod(providers: AppProviders): Promise<AcademicPeriod> {
  const periods = await providers.domainStore.listAcademicPeriods({ isActive: true })
  if (periods.length !== 1) {
    throw configurationError(
      'academic_period',
      'Astra harus memiliki tepat satu Periode Akademik aktif sebelum Site dapat dikelola.',
      periods.length,
    )
  }
  return periods[0]!
}

export async function validateSiteClass(
  providers: AppProviders,
  period: AcademicPeriod,
  classId: string | null | undefined,
): Promise<void> {
  if (classId == null) return
  const classroom = await providers.domainStore.getClassById(classId)
  if (
    !classroom ||
    classroom.school_id !== period.school_id ||
    classroom.academic_period_id !== period.id
  ) {
    throw AppError.validationError({
      fieldErrors: {
        class_id: ['Kelas harus berasal dari Periode Akademik aktif dan sekolah yang sama.'],
      },
    })
  }
}
