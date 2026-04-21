// Hono context variable type augmentation
// This allows c.get('userId') etc. to be typed across all routes

export interface AppContextVariables {
  requestId: string
  userId: string
  rawToken: string
  abortSignal: AbortSignal
}

export type AppEnv = { Variables: AppContextVariables }
