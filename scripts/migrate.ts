import postgres from 'postgres'
import { env } from '../src/config/env.js'
import { runMigrations } from '../src/providers/postgres/migrate.js'
import { logger } from '../src/lib/logging/logger.js'

async function main() {
  logger.info(
    { databaseUrl: env.databaseUrl.replace(/:[^:@]+@/, ':***@') },
    'Running database migration',
  )

  const sql = postgres(env.databaseUrl, {
    max: 1,
    connect_timeout: env.databaseConnectTimeoutSeconds,
  })

  try {
    await runMigrations(sql)
    logger.info('Migration completed successfully')
  } catch (err) {
    logger.error({ err }, 'Migration failed')
    process.exit(1)
  } finally {
    await sql.end()
  }
}

await main()
