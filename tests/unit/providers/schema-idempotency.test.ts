import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('db/schema.sql idempotency', () => {
  it('contains idempotent schedule and location seed statements with explicit conflict targets', () => {
    const schemaPath = resolve(__dirname, '../../../db/schema.sql')
    const schemaSql = readFileSync(schemaPath, 'utf-8')

    // Schedules seed must specify explicit id column and ON CONFLICT (id) DO NOTHING
    expect(schemaSql).toMatch(/INSERT INTO schedules \([^)]*id[^)]*\)/i)
    expect(schemaSql).toMatch(/INSERT INTO schedules[\s\S]*ON CONFLICT \(id\) DO NOTHING/i)

    // Locations seed must specify ON CONFLICT (id) DO NOTHING
    expect(schemaSql).toMatch(/INSERT INTO locations[\s\S]*ON CONFLICT \(id\) DO NOTHING/i)

    // Verify all table creations are IF NOT EXISTS
    const createTableStatements = schemaSql.match(/CREATE TABLE[^(]+/gi) ?? []
    for (const stmt of createTableStatements) {
      expect(stmt.toUpperCase()).toContain('IF NOT EXISTS')
    }
  })
})
