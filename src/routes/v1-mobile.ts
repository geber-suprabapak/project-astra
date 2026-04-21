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

const v1Mobile = new Hono<AppEnv>()

v1Mobile.route('/health', mobileHealthRouter)
v1Mobile.route('/dashboard', dashboardRouter)
v1Mobile.route('/attendance', attendanceRouter)
v1Mobile.route('/face/enrollment', enrollmentRouter)
v1Mobile.route('/permits', permitsRouter)
v1Mobile.route('/profile', profileRouter)
v1Mobile.route('/time', timeRouter)

export { v1Mobile }
