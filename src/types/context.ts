import type {
  AppProviders,
  IdentityRole,
  IdentityUser,
  ProfileLifecycleStatus,
} from '../providers/types.js'

// Hono context variable type augmentation
// This allows c.get('userId') etc. to be typed across all routes

export interface AppContextVariables {
  requestId: string
  userId: string
  rawToken: string
  identityUser: IdentityUser
  profileLifecycleStatus: ProfileLifecycleStatus
  profileRole: IdentityRole | null
  abortSignal: AbortSignal
  tenantKey: string
  providers: AppProviders
}

export type AppEnv = { Variables: AppContextVariables }
