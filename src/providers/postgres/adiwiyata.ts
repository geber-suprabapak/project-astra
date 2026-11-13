import type { Sql } from 'postgres'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
import type {
  AdiwiyataEligibility,
  AdiwiyataSite,
  CreateAdiwiyataSiteParams,
  UpdateAdiwiyataSiteParams,
} from '../types.js'
import { withPgError } from './shared.js'

export interface AdiwiyataSiteFilter {
  schoolId?: string
  isActive?: boolean
}

export async function getAdiwiyataEligibility(
  sql: Sql,
  userId: string,
): Promise<AdiwiyataEligibility | null> {
  return withPgError(
    (err) => logger.error({ err, userId }, 'Failed to query Adiwiyata eligibility'),
    async () => {
      const rows = await sql<AdiwiyataEligibility[]>`
        SELECT id, user_id, added_by, is_active, created_at::text, updated_at::text
        FROM adiwiyata_eligibility
        WHERE user_id = ${userId}
        LIMIT 1
      `
      return rows[0] ?? null
    },
  )
}

export async function listAdiwiyataEligibility(sql: Sql): Promise<AdiwiyataEligibility[]> {
  return withPgError(
    (err) => logger.error({ err }, 'Failed to list Adiwiyata eligibility'),
    async () => {
      const rows = await sql<AdiwiyataEligibility[]>`
        SELECT id, user_id, added_by, is_active, created_at::text, updated_at::text
        FROM adiwiyata_eligibility
        ORDER BY created_at ASC, id ASC
      `
      return rows ?? []
    },
  )
}

export async function upsertAdiwiyataEligibility(
  sql: Sql,
  userId: string,
  addedBy: string,
): Promise<AdiwiyataEligibility> {
  return withPgError(
    (err) => logger.error({ err, userId }, 'Failed to upsert Adiwiyata eligibility'),
    async () => {
      const rows = await sql<AdiwiyataEligibility[]>`
        INSERT INTO adiwiyata_eligibility (user_id, added_by, is_active)
        VALUES (${userId}, ${addedBy}, TRUE)
        ON CONFLICT (user_id) DO UPDATE
        SET is_active = TRUE, updated_at = NOW()
        RETURNING id, user_id, added_by, is_active, created_at::text, updated_at::text
      `
      if (!rows[0]) throw AppError.internal('Failed to activate Adiwiyata eligibility.')
      return rows[0]
    },
  )
}

export async function setAdiwiyataEligibilityActive(
  sql: Sql,
  id: string,
  isActive: boolean,
): Promise<AdiwiyataEligibility | null> {
  return withPgError(
    (err) => logger.error({ err, id, isActive }, 'Failed to update Adiwiyata eligibility state'),
    async () => {
      const rows = await sql<AdiwiyataEligibility[]>`
        UPDATE adiwiyata_eligibility
        SET is_active = ${isActive}, updated_at = NOW()
        WHERE id = ${id}::uuid
        RETURNING id, user_id, added_by, is_active, created_at::text, updated_at::text
      `
      return rows[0] ?? null
    },
  )
}

export async function listAdiwiyataSites(
  sql: Sql,
  filter?: AdiwiyataSiteFilter,
): Promise<AdiwiyataSite[]> {
  return withPgError(
    (err) => logger.error({ err, filter }, 'Failed to list Adiwiyata Sites'),
    async () => {
      const rows = await sql<AdiwiyataSite[]>`
        SELECT id, school_id, name, category, class_id, is_active, sort_order, created_by,
               created_at::text, updated_at::text
        FROM adiwiyata_sites
        WHERE (${filter?.schoolId ?? null}::uuid IS NULL OR school_id = ${filter?.schoolId ?? null}::uuid)
          AND (${filter?.isActive ?? null}::boolean IS NULL OR is_active = ${filter?.isActive ?? null})
        ORDER BY sort_order ASC, name ASC
      `
      return rows ?? []
    },
  )
}

export async function createAdiwiyataSite(
  sql: Sql,
  params: CreateAdiwiyataSiteParams,
): Promise<AdiwiyataSite> {
  return withPgError(
    (err) => logger.error({ err, params }, 'Failed to create Adiwiyata Site'),
    async () => {
      const rows = await sql<AdiwiyataSite[]>`
        INSERT INTO adiwiyata_sites (school_id, name, category, class_id, sort_order, created_by)
        VALUES (
          ${params.schoolId}::uuid,
          ${params.name},
          ${params.category},
          ${params.classId ?? null}::uuid,
          ${params.sortOrder ?? 0},
          ${params.createdBy}
        )
        RETURNING id, school_id, name, category, class_id, is_active, sort_order, created_by,
                  created_at::text, updated_at::text
      `
      if (!rows[0]) throw AppError.internal('Failed to create Adiwiyata Site.')
      return rows[0]
    },
  )
}

export async function updateAdiwiyataSite(
  sql: Sql,
  id: string,
  schoolId: string,
  params: UpdateAdiwiyataSiteParams,
): Promise<AdiwiyataSite | null> {
  return withPgError(
    (err) => logger.error({ err, id, schoolId, params }, 'Failed to update Adiwiyata Site'),
    async () => {
      const rows = await sql<AdiwiyataSite[]>`
        UPDATE adiwiyata_sites
        SET name = CASE WHEN ${params.name !== undefined} THEN ${params.name ?? null} ELSE name END,
            category = CASE WHEN ${params.category !== undefined} THEN ${params.category ?? null} ELSE category END,
            class_id = CASE WHEN ${params.classId !== undefined} THEN ${params.classId ?? null}::uuid ELSE class_id END,
            sort_order = CASE WHEN ${params.sortOrder !== undefined} THEN ${params.sortOrder ?? null} ELSE sort_order END,
            is_active = CASE WHEN ${params.isActive !== undefined} THEN ${params.isActive ?? null} ELSE is_active END,
            updated_at = NOW()
        WHERE id = ${id}::uuid AND school_id = ${schoolId}::uuid
        RETURNING id, school_id, name, category, class_id, is_active, sort_order, created_by,
                  created_at::text, updated_at::text
      `
      return rows[0] ?? null
    },
  )
}
