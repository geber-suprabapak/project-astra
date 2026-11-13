import { z } from 'zod'

export const createScheduleSchema = z
  .object({
    school_id: z.string().min(1).nullable().optional(),
    schoolId: z.string().min(1).nullable().optional(),
    class_id: z.string().min(1).nullable().optional(),
    classId: z.string().min(1).nullable().optional(),
    academic_period_id: z.string().min(1).nullable().optional(),
    academicPeriodId: z.string().min(1).nullable().optional(),
    location_id: z.string().min(1).nullable().optional(),
    locationId: z.string().min(1).nullable().optional(),
    day_of_week: z.string().min(1).optional(),
    dayOfWeek: z.string().min(1).optional(),
    start_time: z
      .string()
      .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time format must be HH:mm or HH:mm:ss')
      .optional(),
    startTime: z
      .string()
      .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time format must be HH:mm or HH:mm:ss')
      .optional(),
    end_time: z
      .string()
      .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time format must be HH:mm or HH:mm:ss')
      .optional(),
    endTime: z
      .string()
      .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time format must be HH:mm or HH:mm:ss')
      .optional(),
    start_checkout: z
      .string()
      .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time format must be HH:mm or HH:mm:ss')
      .optional(),
    startCheckout: z
      .string()
      .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time format must be HH:mm or HH:mm:ss')
      .optional(),
    end_checkout: z
      .string()
      .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time format must be HH:mm or HH:mm:ss')
      .optional(),
    endCheckout: z
      .string()
      .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time format must be HH:mm or HH:mm:ss')
      .optional(),
    grace_period_minutes: z.number().int().min(0).default(0).optional(),
    gracePeriodMinutes: z.number().int().min(0).default(0).optional(),
    is_active: z.boolean().default(true).optional(),
    isActive: z.boolean().default(true).optional(),
  })
  .refine((data) => Boolean(data.day_of_week || data.dayOfWeek), {
    message: 'Day of week is required.',
    path: ['day_of_week'],
  })
  .refine((data) => Boolean(data.start_time || data.startTime), {
    message: 'Start time is required.',
    path: ['start_time'],
  })
  .refine((data) => Boolean(data.end_time || data.endTime), {
    message: 'End time is required.',
    path: ['end_time'],
  })
  .refine((data) => Boolean(data.start_checkout || data.startCheckout), {
    message: 'Start checkout is required.',
    path: ['start_checkout'],
  })
  .refine((data) => Boolean(data.end_checkout || data.endCheckout), {
    message: 'End checkout is required.',
    path: ['end_checkout'],
  })

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>

export const updateScheduleSchema = z.object({
  class_id: z.string().min(1).nullable().optional(),
  classId: z.string().min(1).nullable().optional(),
  academic_period_id: z.string().min(1).nullable().optional(),
  academicPeriodId: z.string().min(1).nullable().optional(),
  location_id: z.string().min(1).nullable().optional(),
  locationId: z.string().min(1).nullable().optional(),
  day_of_week: z.string().min(1).optional(),
  dayOfWeek: z.string().min(1).optional(),
  start_time: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .optional(),
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .optional(),
  end_time: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .optional(),
  endTime: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .optional(),
  start_checkout: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .optional(),
  startCheckout: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .optional(),
  end_checkout: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .optional(),
  endCheckout: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .optional(),
  grace_period_minutes: z.number().int().min(0).optional(),
  gracePeriodMinutes: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>

export const scheduleResponseSchema = z.object({
  id: z.string(),
  school_id: z.string().nullable().optional(),
  class_id: z.string().nullable().optional(),
  academic_period_id: z.string().nullable().optional(),
  location_id: z.string().nullable().optional(),
  day_of_week: z.string().optional(),
  hari: z.string().optional(),
  mulai_masuk: z.string().nullable().optional(),
  selesai_masuk: z.string().nullable().optional(),
  mulai_pulang: z.string().nullable().optional(),
  selesai_pulang: z.string().nullable().optional(),
  kompensasi_waktu: z.number().nullable().optional(),
  is_active: z.boolean(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export type ScheduleResponse = z.infer<typeof scheduleResponseSchema>

export const createLocationSchema = z.object({
  school_id: z.string().min(1).nullable().optional(),
  schoolId: z.string().min(1).nullable().optional(),
  name: z.string().min(1, 'Location name is required.'),
  latitude: z.number({
    error: (iss) => (iss.input === undefined ? 'Latitude is required.' : undefined),
  }),
  longitude: z.number({
    error: (iss) => (iss.input === undefined ? 'Longitude is required.' : undefined),
  }),
  radius_meters: z.number().positive().default(100.0).optional(),
  radiusMeters: z.number().positive().default(100.0).optional(),
  is_active: z.boolean().default(true).optional(),
  isActive: z.boolean().default(true).optional(),
})

export type CreateLocationInput = z.infer<typeof createLocationSchema>

export const updateLocationSchema = z.object({
  name: z.string().min(1).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  radius_meters: z.number().positive().optional(),
  radiusMeters: z.number().positive().optional(),
  is_active: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

export type UpdateLocationInput = z.infer<typeof updateLocationSchema>

export const locationResponseSchema = z.object({
  id: z.string(),
  school_id: z.string().nullable().optional(),
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  radius_meters: z.number(),
  is_active: z.boolean(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export type LocationResponse = z.infer<typeof locationResponseSchema>

export const createCalendarExceptionSchema = z.object({
  school_id: z.string().min(1).nullable().optional(),
  schoolId: z.string().min(1).nullable().optional(),
  academic_period_id: z.string().min(1).nullable().optional(),
  academicPeriodId: z.string().min(1).nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  reason: z.string().min(1, 'Reason is required.'),
  is_holiday: z.boolean().default(true).optional(),
  isHoliday: z.boolean().default(true).optional(),
})

export type CreateCalendarExceptionInput = z.infer<typeof createCalendarExceptionSchema>

export const updateCalendarExceptionSchema = z.object({
  academic_period_id: z.string().min(1).nullable().optional(),
  academicPeriodId: z.string().min(1).nullable().optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
    .optional(),
  reason: z.string().min(1).optional(),
  is_holiday: z.boolean().optional(),
  isHoliday: z.boolean().optional(),
})

export type UpdateCalendarExceptionInput = z.infer<typeof updateCalendarExceptionSchema>

export const calendarExceptionResponseSchema = z.object({
  id: z.string(),
  school_id: z.string().nullable().optional(),
  academic_period_id: z.string().nullable().optional(),
  date: z.string(),
  reason: z.string(),
  is_holiday: z.boolean(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export type CalendarExceptionResponse = z.infer<typeof calendarExceptionResponseSchema>
