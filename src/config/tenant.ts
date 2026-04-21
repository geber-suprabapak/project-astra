import { env } from './env.js'

export interface TenantContext {
  tenantKey: string
  tenantName: string
}

export function getTenantContext(): TenantContext {
  return {
    tenantKey: env.tenantKey,
    tenantName: env.tenantName,
  }
}
