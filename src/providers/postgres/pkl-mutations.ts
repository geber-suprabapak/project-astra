import postgres, { type Sql, type TransactionSql } from 'postgres'
import { AppError } from '../../lib/errors/app-error.js'
import {
  authorizePklMutation,
  authorizePklTransition,
  canManagePkl,
  pklRosterRoles,
} from '../../modules/pkl/policy.js'
import {
  completePklWrite,
  preparePklWrite,
  validatePklQuery,
  type PklImport,
  type PklInput,
  type PklMutation,
  type PklRow,
  type PklTransition,
} from '../../modules/pkl/resources.js'
import { lockCmsAuthority } from './cms-authority.js'
import { recordPklCheckIn } from './pkl-attendance.js'
import { pklWhere } from './pkl-query.js'
import {
  asPklId,
  auditPkl,
  bindingsForPkl,
  parentPklInternship,
  pklRecordById,
  translatePklError,
  validatePklRelationships,
} from './pkl-shared.js'

export async function applyPklMutation(tx: TransactionSql, params: PklMutation): Promise<PklRow> {
  await lockCmsAuthority(tx, params.access)
  const data = preparePklWrite(params)
  let before: PklRow | null = null
  if (params.action !== 'create') {
    const id = asPklId(params.id)
    const query = validatePklQuery(params.resource, { id, limit: 1 })
    const rows = await tx<
      { data: PklRow }[]
    >`SELECT to_jsonb(content.*) AS data FROM ${tx('pkl.' + params.resource)} AS content WHERE ${pklWhere(tx, { resource: params.resource, query, access: params.access })} FOR UPDATE`
    before = rows[0]?.data ?? null
    if (!before) throw AppError.notFound('PKL record')
  }
  const merged: PklInput = { ...before, ...data }
  const bindings = await bindingsForPkl(tx, params.access)
  const internship = await parentPklInternship(tx, params, merged)
  authorizePklMutation(params, data, bindings, before, internship)
  if (params.action === 'delete') {
    if (params.resource === 'certificate_templates' && before!.is_active === true) {
      throw AppError.conflict('Deactivate the certificate template first.')
    }
    await tx`UPDATE ${tx('pkl.' + params.resource)} SET deleted_at = now(), updated_at = now() WHERE id = ${before!.id}`
    await auditPkl(tx, params.access, params.resource, 'delete', before, null)
    return before!
  }
  const indicator = await validatePklRelationships(tx, params, data, merged, internship)
  completePklWrite(params, data, before, indicator)
  if (params.resource === 'certificate_templates' && data.is_active === true) {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended('pkl:active-certificate-template',0))`
    await tx`UPDATE pkl.certificate_templates SET is_active = false, updated_at = now() WHERE is_active = true AND deleted_at IS NULL`
  }
  const columns = Object.keys(data)
  const table = tx('pkl.' + params.resource)
  const rows =
    params.action === 'create'
      ? await tx<
          { data: PklRow }[]
        >`INSERT INTO ${table} AS record (${tx(columns)}) SELECT ${tx(columns)} FROM jsonb_populate_record(NULL::${table},${tx.json(data)}) RETURNING to_jsonb(record.*) AS data`
      : await tx<
          { data: PklRow }[]
        >`UPDATE ${table} AS record SET (${tx(columns)}) = (SELECT ${tx(columns)} FROM jsonb_populate_record(NULL::${table},${tx.json(data)})), updated_at = now() WHERE id = ${before!.id} RETURNING to_jsonb(record.*) AS data`
  const after = rows[0]!.data
  await auditPkl(tx, params.access, params.resource, params.action, before, after)
  if (
    params.resource === 'daily_journals' &&
    params.action === 'create' &&
    params.access.role === 'siswa' &&
    after.status !== 'draft'
  ) {
    await recordPklCheckIn(
      tx,
      params.access,
      internship!,
      asPklId(internship!.student_id),
      String(after.date),
      {},
      'Hadir (otomatis dari pengisian jurnal harian)',
    )
  }
  if (params.resource === 'registrations' && params.action === 'create') {
    await tx`INSERT INTO pkl.status_history(registration_id,to_status,changed_by,changed_by_role,notes) VALUES (${after.id},${String(after.status)},${params.access.id},${params.access.role},'Initial registration')`
  }
  return after
}

export async function mutatePklRecord(sql: Sql, params: PklMutation): Promise<PklRow> {
  try {
    return await sql.begin((tx) => applyPklMutation(tx, params))
  } catch (error) {
    if (error instanceof postgres.PostgresError) translatePklError(error)
    throw error
  }
}

export async function transitionPklRegistration(sql: Sql, params: PklTransition): Promise<PklRow> {
  try {
    return await sql.begin(async (tx) => {
      await lockCmsAuthority(tx, params.access)
      const before = await pklRecordById(tx, 'registrations', params.id, 'update')
      const bindings = await bindingsForPkl(tx, params.access)
      authorizePklTransition(params, before, bindings)
      const data: PklInput = { status: params.status }
      if (params.industry_id) {
        if (!canManagePkl(params.access) && params.access.role !== 'siswa') {
          throw AppError.forbidden()
        }
        await pklRecordById(tx, 'industries', params.industry_id)
        data.industry_id = params.industry_id
      }
      if (params.status === 'MENUNGGU_INDUSTRI' && !(data.industry_id ?? before.industry_id)) {
        throw AppError.validationError('Choose an industry first.')
      }
      if (params.status === 'MENCARI_INDUSTRI' || params.status === 'DITOLAK') {
        data.reviewed_by = params.access.id
        data.reviewed_at = new Date().toISOString()
        data.review_notes = params.notes ?? null
      }
      if (params.status === 'DITOLAK') {
        if (!params.notes?.trim()) throw AppError.validationError('Rejection reason is required.')
        data.rejection_reason = params.notes
      }
      if (params.status === 'DITERIMA') {
        data.accepted_industry_id = asPklId(data.industry_id ?? before.industry_id)
        data.accepted_by = params.access.id
        data.accepted_at = new Date().toISOString()
      }
      const columns = Object.keys(data)
      const rows = await tx<
        { data: PklRow }[]
      >`UPDATE pkl.registrations AS record SET (${tx(columns)}) = (SELECT ${tx(columns)} FROM jsonb_populate_record(NULL::pkl.registrations,${tx.json(data)})), updated_at = now() WHERE id = ${params.id} RETURNING to_jsonb(record.*) AS data`
      const after = rows[0]!.data
      await tx`INSERT INTO pkl.status_history(registration_id,from_status,to_status,changed_by,changed_by_role,notes) VALUES (${params.id},${String(before.status)},${params.status},${params.access.id},${params.access.role},${params.notes ?? null})`
      await auditPkl(tx, params.access, 'registrations', 'transition', before, after)
      return after
    })
  } catch (error) {
    if (error instanceof postgres.PostgresError) translatePklError(error)
    throw error
  }
}

export async function importPklRecords(sql: Sql, params: PklImport): Promise<PklRow[]> {
  if (
    !canManagePkl(params.access) &&
    !(params.resource === 'roster' && pklRosterRoles.has(params.access.role))
  ) {
    throw AppError.forbidden()
  }
  try {
    return await sql.begin(async (tx) => {
      const rows: PklRow[] = []
      for (const data of params.rows) {
        rows.push(
          await applyPklMutation(tx, {
            resource: params.resource,
            access: params.access,
            data,
            action: 'create',
          }),
        )
      }
      return rows
    })
  } catch (error) {
    if (error instanceof postgres.PostgresError) translatePklError(error)
    throw error
  }
}
