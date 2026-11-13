import { AppError } from '../../../lib/errors/app-error.js'
import type { AppProviders, AuditLog, IdentityRole } from '../../../providers/types.js'
import {
  backupLogDetailsSchema,
  isValidDateInMonth,
  isValidRealYearMonth,
  type BackupStatusQuery,
  type BackupStatusRecord,
  type BackupStatusResponse,
  type CreateBackupInput,
} from '../schema.js'
import { assertAdminAccess } from './shared.js'

export async function recordAdminBackup(params: {
  input: CreateBackupInput
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<AuditLog> {
  assertAdminAccess(params.actorRole)

  const {
    year_month,
    scope,
    format,
    start_date,
    end_date,
    checksum,
    record_count,
    byte_length,
    result,
  } = params.input

  const inserted = await params.providers.domainStore.insertAuditLog({
    actor_id: params.actorId,
    action: 'backup',
    entity_type: 'backup',
    entity_id: year_month,
    details: {
      actor: params.actorId,
      actor_id: params.actorId,
      scope,
      format,
      start_date,
      end_date,
      range: {
        start_date,
        end_date,
      },
      checksum: checksum ?? null,
      counts: record_count,
      record_count,
      bytes: byte_length,
      byte_length,
      result,
    },
  })

  return inserted
}

export async function getAdminBackupStatus(params: {
  query: BackupStatusQuery
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<BackupStatusResponse> {
  assertAdminAccess(params.actorRole)

  const yearMonth = params.query.year_month
  const scope = params.query.scope

  const logs = await params.providers.domainStore.getAuditLogs('backup', yearMonth)

  // completed=true only when a persisted matching details.result=completed log exists,
  // using latest completed record. No completed record, including failed-only,
  // returns completed=false and record=null.
  const completedLogs = logs.filter((log) => {
    if (scope && log.details?.scope !== scope) return false
    return log.details?.result === 'completed'
  })

  if (completedLogs.length === 0) {
    return {
      completed: false,
      record: null,
    }
  }

  // DomainStore.getAuditLogs invariant guarantees newest-first for all adapters.
  const latestLog = completedLogs[0]

  const ym = latestLog.entity_id || yearMonth
  if (!isValidRealYearMonth(ym)) {
    throw AppError.internal('Persisted backup audit log contains invalid entity_id year_month.')
  }

  const parseResult = backupLogDetailsSchema.safeParse(latestLog.details)
  if (!parseResult.success) {
    throw AppError.internal(
      'Persisted backup audit log details are malformed or missing required fields.',
    )
  }

  const details = parseResult.data
  if (
    !isValidDateInMonth(details.start_date, ym) ||
    !isValidDateInMonth(details.end_date, ym) ||
    details.start_date > details.end_date
  ) {
    throw AppError.internal('Persisted backup audit log contains invalid date range for month.')
  }

  const startDate = details.start_date
  const endDate = details.end_date
  const recordCount = (details.record_count ?? details.counts)!
  const byteLength = (details.byte_length ?? details.bytes)!
  const format = details.format
  const recordScope = details.scope
  const checksum = details.checksum
  const actor = details.actor ?? latestLog.actor_id

  const record: BackupStatusRecord = {
    id: latestLog.id,
    year_month: ym,
    scope: recordScope,
    format,
    start_date: startDate,
    end_date: endDate,
    range: {
      start_date: startDate,
      end_date: endDate,
    },
    checksum,
    record_count: recordCount,
    counts: recordCount,
    byte_length: byteLength,
    bytes: byteLength,
    result: 'completed',
    actor_id: latestLog.actor_id,
    actor,
    created_at: latestLog.created_at,
  }

  return {
    completed: true,
    record,
  }
}
