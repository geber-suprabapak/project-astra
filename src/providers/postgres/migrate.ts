import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Sql } from 'postgres'
import { logger } from '../../lib/logging/logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function runMigrations(sql: Sql, schemaPath?: string): Promise<void> {
  const defaultPath = resolve(__dirname, '../../../db/schema.sql')
  const resolvedPath = schemaPath ? resolve(schemaPath) : defaultPath

  logger.info({ path: resolvedPath }, 'Applying greenfield PostgreSQL schema')

  try {
    const schemaSql = readFileSync(resolvedPath, 'utf-8')
    await sql.unsafe(schemaSql)
    logger.info('Greenfield PostgreSQL schema applied successfully')
  } catch (err) {
    logger.error({ err, path: resolvedPath }, 'Failed to apply PostgreSQL schema')
    throw err
  }
}
