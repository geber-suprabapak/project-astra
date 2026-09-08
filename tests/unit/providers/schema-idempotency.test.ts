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

  it('keeps enrollment absence numbers positive and canonical at the database boundary', () => {
    const schemaPath = resolve(__dirname, '../../../db/schema.sql')
    const schemaSql = readFileSync(schemaPath, 'utf-8')

    expect(schemaSql).toMatch(/class_enrollments_absence_number_check/i)
    expect(schemaSql).toMatch(/absence_number IS NULL OR absence_number ~ '\^\[1-9\]\[0-9\]\*\$'/i)
    expect(schemaSql).toMatch(
      /uq_active_class_absence_number ON class_enrollments\(class_id, academic_period_id, absence_number\)/i,
    )
  })
})
