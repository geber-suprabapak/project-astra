import { z } from 'zod'
import {
  sanitizeAuditLogDetails,
  type SanitizedAuditDetails,
} from '../../../lib/observability/pii.js'
import type { AppProviders, IdentityRole } from '../../../providers/types.js'
import { assertAdminAccess } from './shared.js'

export const SCHOOL_ADMIN_ALLOWED_ENTITY_TYPES = [
  'academic_period',
  'class',
  'class_enrollment',
  'student',
  'profile',
  'schedule',
  'location',
  'calendar_exception',
  'attendance',
  'leave_request',
  'roster_report',
  'face_enrollment',
  'adiwiyata_report',
  'adiwiyata_site',
  'adiwiyata_eligibility',
  'backup',
  'notification',
] as const

export const SCHOOL_ADMIN_EXCLUDED_ACTIONS = [
  'bootstrap_school',
  'create_school_admin',
  'assign_user_roles',
  'create_role',
  'update_role',
  'create_permission',
] as const

export interface SanitizedAuditLogItem {
  id: string
  actor_id: string | null
  actor_name: string | null
  action: string
  entity_type: string
  entity_id: string | null
  details: SanitizedAuditDetails | null
  request_id: string | null
  trace_id: string | null
  created_at: string
}

export interface ListAdminAuditLogsResult {
  items: SanitizedAuditLogItem[]
  hasMore: boolean
}

export async function listAdminAuditLogs(params: {
  limit: number
  offset: number
  entityType?: string
  action?: string
  actorId?: string
  startDate?: string
  endDate?: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<ListAdminAuditLogsResult> {
  assertAdminAccess(params.actorRole)

  const isSchoolAdmin = params.actorRole === 'school_admin'
  const result = await params.providers.domainStore.queryAuditLogs({
    limit: params.limit,
    offset: params.offset,
    entityType: params.entityType,
    action: params.action,
    actorId: params.actorId,
    startDate: params.startDate,
    endDate: params.endDate,
    allowedEntityTypes: isSchoolAdmin ? SCHOOL_ADMIN_ALLOWED_ENTITY_TYPES : undefined,
    excludedActions: isSchoolAdmin ? SCHOOL_ADMIN_EXCLUDED_ACTIONS : undefined,
  })

  const items: SanitizedAuditLogItem[] = result.items.map((row) => {
    const sanitized = sanitizeAuditLogDetails(row.details)
    const requestParsed = z.string().safeParse(sanitized?.request_id)
    const traceParsed = z.string().safeParse(sanitized?.trace_id)
    return {
      id: row.id,
      actor_id: row.actor_id,
      actor_name: row.actor_name ?? null,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      details: sanitized,
      request_id: requestParsed.success ? requestParsed.data : null,
      trace_id: traceParsed.success ? traceParsed.data : null,
      created_at: row.created_at,
    }
  })

  return {
    items,
    hasMore: result.hasMore,
  }
}
