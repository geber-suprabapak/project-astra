import type { AppProviders } from '../providers/types.js'

// Hono context variable type augmentation
// This allows c.get('userId') etc. to be typed across all routes

export interface AppContextVariables {
  requestId: string
  userId: string
  rawToken: string
  abortSignal: AbortSignal
  tenantKey: string
  providers: AppProviders
}

export type AppEnv = { Variables: AppContextVariables }
