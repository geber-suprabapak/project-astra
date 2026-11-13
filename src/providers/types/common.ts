import { z } from 'zod'

export const profileLifecycleStatusSchema = z.enum(['pending', 'approved', 'rejected', 'disabled'])
export type ProfileLifecycleStatus = z.infer<typeof profileLifecycleStatusSchema>

export const identityRoleSchema = z.enum([
  'platform_admin',
  'school_admin',
  'teacher',
  'student',
  'staff',
])
export type IdentityRole = z.infer<typeof identityRoleSchema>

export type UserMetadataValue = string | number | boolean | null | undefined
export type UserMetadata = Record<string, UserMetadataValue>

export function toWibDate(value: string): string {
  const candidate = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate
  const parsed = new Date(candidate)
  if (Number.isNaN(parsed.getTime())) return candidate.slice(0, 10)
  return new Date(parsed.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export type AuditLogPrimitiveValue = string | number | boolean | null | undefined

export type AuditLogDetailValue =
  | AuditLogPrimitiveValue
  | readonly string[]
  | Record<string, AuditLogPrimitiveValue>
export type AuditLogDetails = Record<string, AuditLogDetailValue>

export interface AuditLogEntry {
  actor_id?: string | null
  action: string
  entity_type: string
  entity_id?: string | null
  details?: AuditLogDetails | null
}

export interface AuditLog {
  id: string
  actor_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  details: AuditLogDetails | null
  created_at: string
}
