import { Hono } from 'hono'
import { auth } from '../../middleware/auth.js'
import { privilegedAuth } from '../../middleware/privileged-auth.js'
import { rateLimits } from '../../middleware/rate-limit.js'
import type { AppEnv } from '../../types/context.js'
import { createAdiwiyataAdminRouter } from '../adiwiyata/admin-routes.js'
import { registerAcademicEnrollmentRoutes } from './routes/academic-enrollment.js'
import { registerAttendanceRoutes } from './routes/attendance.js'
import { registerBackupRoutes } from './routes/backup.js'
import { registerBootstrapRosterRoutes } from './routes/bootstrap-roster.js'
import { registerLeaveRequestRoutes } from './routes/leave-requests.js'
import { registerNotificationRoutes } from './routes/notifications.js'
import { registerRbacStaffRoutes } from './routes/rbac-staff.js'
import { registerScheduleLocationCalendarRoutes } from './routes/schedules-locations-calendar.js'
import type { AdminRouterDeps } from './routes/shared.js'
import { registerStudentRoutes } from './routes/students.js'

export type { AdminRouterDeps }

export function createAdminRouter(deps: AdminRouterDeps = {}) {
  const router = new Hono<AppEnv>()

  router.use('*', auth)
  router.use('*', privilegedAuth)
  router.use('*', rateLimits.adminSession)
  router.route('/adiwiyata', createAdiwiyataAdminRouter({ providers: deps.providers }))

  registerBootstrapRosterRoutes(router, deps)
  registerStudentRoutes(router, deps)
  registerRbacStaffRoutes(router, deps)
  registerAcademicEnrollmentRoutes(router, deps)
  registerScheduleLocationCalendarRoutes(router, deps)
  registerAttendanceRoutes(router, deps)
  registerLeaveRequestRoutes(router, deps)
  registerNotificationRoutes(router, deps)
  registerBackupRoutes(router, deps)

  return router
}

export const adminRouter = createAdminRouter()
