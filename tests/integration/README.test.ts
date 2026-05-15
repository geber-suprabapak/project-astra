/**
 * Integration test placeholder.
 *
 * These tests require running Supabase and Robin services.
 * They are designed to be run with `bun run test:integration`
 * after setting up the required environment variables in .env.test
 * or pointing to a local Docker environment.
 *
 * See docker-compose.yml for local Supabase/Robin setup.
 *
 * Test categories:
 * 1. Robin client integration (readiness, identify, enroll status, enroll upload)
 * 2. Supabase client integration (profile read, avatar signed URL, permit insert, attendance persistence)
 * 3. Endpoint-level integration (dashboard happy path, attendance precheck blocked by permit,
 *    attendance submit happy path, permit create with attachment, avatar upload and clear)
 */

import { describe, it, expect } from 'vitest'

describe('Integration tests placeholder', () => {
  it('placeholder — integration tests require running services', () => {
    // This file exists to ensure the integration test runner has at least one test.
    // Replace this with actual integration tests when services are available.
    expect(true).toBe(true)
  })
})
