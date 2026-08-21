import { env } from '../../config/env.js'

/** Named timeout presets */
export const timeouts = {
  /** Robin readiness check: 3000ms (configurable via env) */
  robinReadiness: env.robinReadyTimeoutMs,
  /** Robin identify: 30000ms (configurable via env) */
  robinIdentify: env.robinIdentifyTimeoutMs,
  /** Robin enrollment status: 5000ms (configurable via env) */
  robinEnrollStatus: env.robinEnrollStatusTimeoutMs,
  /** Robin enrollment upload: 60000ms (configurable via env) */
  robinEnroll: env.robinEnrollTimeoutMs,
  /** Database query: 5000ms default */
  dbQuery: env.dbQueryTimeoutMs,
  /** Storage upload: 15000ms default */
  storageUpload: env.storageUploadTimeoutMs,
} as const
