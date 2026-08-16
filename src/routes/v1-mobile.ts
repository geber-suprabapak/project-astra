import { Hono } from 'hono'
import { dashboardRouter } from '../modules/dashboard/routes.js'
import { attendanceRouter } from '../modules/attendance/routes.js'
import { enrollmentRouter } from '../modules/enrollment/routes.js'
import { permitsRouter } from '../modules/permits/routes.js'
import { profileRouter } from '../modules/profile/routes.js'
import { timeRouter } from '../modules/time/routes.js'
import { mobileHealthRouter } from '../modules/health/routes.js'
import type { AppEnv } from '../types/context.js'

// All routes under /v1/mobile share auth via individual routers;
// we do NOT apply auth here globally so /health remains public.

export interface V1MobileDeps {
  mobileHealthRouter?: Hono<AppEnv>
}

export function createV1Mobile(deps: V1MobileDeps = {}) {
  const router = new Hono<AppEnv>()

  router.route('/health', deps.mobileHealthRouter ?? mobileHealthRouter)
  router.route('/dashboard', dashboardRouter)
  router.route('/attendance', attendanceRouter)
  router.route('/face/enrollment', enrollmentRouter)
  router.route('/permits', permitsRouter)
  router.route('/profile', profileRouter)
  router.route('/time', timeRouter)

  return router
}

const v1Mobile = createV1Mobile()

export { v1Mobile }
