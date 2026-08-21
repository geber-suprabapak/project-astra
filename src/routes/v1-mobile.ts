import { Hono } from 'hono'
import { createDashboardRouter, dashboardRouter } from '../modules/dashboard/routes.js'
import { createAttendanceRouter, attendanceRouter } from '../modules/attendance/routes.js'
import { createEnrollmentRouter, enrollmentRouter } from '../modules/enrollment/routes.js'
import { createPermitsRouter, permitsRouter } from '../modules/permits/routes.js'
import { createProfileRouter, profileRouter } from '../modules/profile/routes.js'
import { timeRouter } from '../modules/time/routes.js'
import { createMobileHealthRouter, mobileHealthRouter } from '../modules/health/routes.js'
import { createStudentAuthRouter, studentAuthRouter } from '../modules/auth/routes.js'
import { createFilesRouter, filesRouter } from '../modules/files/routes.js'
import { createNotificationRouter, notificationRouter } from '../modules/notifications/routes.js'
import type { AppProviders } from '../providers/types.js'
import type { AppEnv } from '../types/context.js'

export interface V1MobileDeps {
  providers?: AppProviders
  mobileHealthRouter?: Hono<AppEnv>
  dashboardRouter?: Hono<AppEnv>
  attendanceRouter?: Hono<AppEnv>
  enrollmentRouter?: Hono<AppEnv>
  permitsRouter?: Hono<AppEnv>
  profileRouter?: Hono<AppEnv>
  authRouter?: Hono<AppEnv>
  filesRouter?: Hono<AppEnv>
  notificationRouter?: Hono<AppEnv>
}

export function createV1Mobile(deps: V1MobileDeps = {}) {
  const router = new Hono<AppEnv>()

  const health =
    deps.mobileHealthRouter ??
    (deps.providers
      ? createMobileHealthRouter({ providers: deps.providers })
      : mobileHealthRouter)
  const dashboard =
    deps.dashboardRouter ??
    (deps.providers ? createDashboardRouter({ providers: deps.providers }) : dashboardRouter)
  const attendance =
    deps.attendanceRouter ??
    (deps.providers ? createAttendanceRouter({ providers: deps.providers }) : attendanceRouter)
  const enrollment =
    deps.enrollmentRouter ??
    (deps.providers ? createEnrollmentRouter({ providers: deps.providers }) : enrollmentRouter)
  const permits =
    deps.permitsRouter ??
    (deps.providers ? createPermitsRouter({ providers: deps.providers }) : permitsRouter)
  const profile =
    deps.profileRouter ??
    (deps.providers ? createProfileRouter({ providers: deps.providers }) : profileRouter)
  const auth =
    deps.authRouter ??
    (deps.providers ? createStudentAuthRouter({ providers: deps.providers }) : studentAuthRouter)
  const files =
    deps.filesRouter ??
    (deps.providers ? createFilesRouter({ providers: deps.providers }) : filesRouter)
  const notifications =
    deps.notificationRouter ??
    (deps.providers ? createNotificationRouter({ providers: deps.providers }) : notificationRouter)

  router.route('/health', health)
  router.route('/auth', auth)
  router.route('/dashboard', dashboard)
  router.route('/attendance', attendance)
  router.route('/face/enrollment', enrollment)
  router.route('/permits', permits)
  router.route('/leave-requests', permits)
  router.route('/profile', profile)
  router.route('/files', files)
  router.route('/notifications', notifications)
  router.route('/time', timeRouter)

  return router
}

export const v1Mobile = createV1Mobile()

