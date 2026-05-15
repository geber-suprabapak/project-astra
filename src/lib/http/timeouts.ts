import { env } from '../../config/env.js'

/** Named timeout presets — plan.md §6.4 */
export const timeouts = {
  /** Robin readiness check: 3000ms (configurable via env) */
  robinReadiness: env.robinReadyTimeoutMs,
  /** Robin identify: 30000ms (configurable via env) */
  robinIdentify: env.robinIdentifyTimeoutMs,
  /** Robin enrollment status: 5000ms (configurable via env) */
  robinEnrollStatus: env.robinEnrollStatusTimeoutMs,
  /** Robin enrollment upload: 60000ms (configurable via env) */
  robinEnroll: env.robinEnrollTimeoutMs,
  /** Supabase query: 5000ms default */
  supabaseQuery: env.supabaseQueryTimeoutMs,
  /** Storage upload: 15000ms default */
  supabaseStorageUpload: env.supabaseStorageUploadTimeoutMs,
} as const