# Task List — Skanida Mobile BFF Implementation Completion

Priority order: P0 = blocks functional correctness, P1 = important but not blocking core flow, P2 = hardening/quality.

---

## P0 — Response Shape & Core Logic Fixes

- [ ] **DASH-01**: Refactor `dashboard/service.ts` and `dashboard/routes.ts` to return the plan-compliant response shape:
  - Add `email` and `absence_number` to `profile`
  - Restructure `attendance` to `{ today_status, has_checked_in, has_checked_out, check_in_time, check_out_time, total_work_hours }`
  - Normalize `schedule` to `{ day_key, start_check_in_at, end_check_in_at, start_check_out_at, end_check_out_at, compensation_minutes }`
  - Add `face` object: `{ server_status, enrollment_status, message }`
  - Add `permit` object: `{ has_active_permit, active_category }`
  - Add `server_time` object: `{ now, timezone, source }`
  - Add `reason_message` to `primary_action`

- [ ] **DASH-02**: Create `src/modules/dashboard/schema.ts` with Zod schemas for request and response validation.

- [ ] **ATT-01**: Add `checks` object to attendance precheck response: `{ schedule: "pass"|"fail", permit: "pass"|"fail", enrollment: "pass"|"fail", robin: "pass"|"fail" }`.

- [ ] **ATT-02**: Rename `schedule_window` fields from `start`/`end` to `start_at`/`end_at` to match plan.

- [ ] **ATT-03**: Add enrollment status check as gate #5 in `runGateChecks()`. Call Robin `getEnrollmentStatus()` before allowing attendance.

- [ ] **PERM-01**: Wrap `GET /v1/mobile/permits` response in `{ items: [...] }` envelope.

- [ ] **PERM-02**: Add `rejected_at` field to permit response items.

- [ ] **HLTH-01**: Change `GET /v1/mobile/health` response field from `operational` to `status` with value `"healthy"` (matching plan Section 7.12).

---

## P0 — Middleware & Configuration Fixes

- [ ] **AUTH-01**: Add tenant validation in `src/middleware/auth.ts`. After JWT verification, check that the token's tenant claim matches `TENANT_KEY`. Throw `AppError.tenantMismatch()` on mismatch.

- [ ] **ERR-01**: Add `AppError.tenantMismatch()` factory method in `src/lib/errors/app-error.ts` (code: `TENANT_MISMATCH`, status: 403).

- [ ] **ENV-01**: Add `SUPABASE_QUERY_TIMEOUT_MS` env var (default: 5000ms) to `src/config/env.ts` and `.env.example`.

- [ ] **ENV-02**: Add `SUPABASE_STORAGE_UPLOAD_TIMEOUT_MS` env var (default: 15000ms) to `src/config/env.ts` and `.env.example`.

- [ ] **ENV-03**: Add `ROBIN_ENROLL_STATUS_TIMEOUT_MS` env var (default: 5000ms) to `src/config/env.ts`. Replace the hardcoded `5000` in `src/clients/robin/client.ts`.

- [ ] **TMO-01**: Add named timeout presets in `src/middleware/timeout.ts` or a shared `src/lib/http/timeouts.ts`:
  - `SUPABASE_QUERY_TIMEOUT_MS`
  - `SUPABASE_STORAGE_UPLOAD_TIMEOUT_MS`
  - Apply these timeouts in Supabase admin and storage client calls.

- [ ] **RATE-01**: Add per-10-minute rate limiting support for enrollment upload (`2 requests per 10 minutes`). Current `MemoryRateLimitStore` only supports per-minute windows.

---

## P1 — Test Coverage

- [ ] **TEST-01**: Write unit tests for `src/middleware/auth.ts`:
  - Missing token → 401 AUTH_REQUIRED
  - Invalid token → 401 AUTH_INVALID
  - Valid token → sets userId and rawToken on context

- [ ] **TEST-02**: Write unit tests for tenant resolution:
  - Correct deployment tenant context from env
  - Mismatched tenant from JWT → 403 TENANT_MISMATCH

- [ ] **TEST-03**: Write unit tests for attendance schema validation:
  - Payload over 5MB → VALIDATION_ERROR
  - action_type invalid enum → VALIDATION_ERROR
  - Missing latitude/longitude → VALIDATION_ERROR

- [ ] **TEST-04**: Write unit tests for enrollment file validation:
  - File count != 10 → VALIDATION_ERROR
  - File size > 2MB → VALIDATION_ERROR
  - Non-JPEG content type → VALIDATION_ERROR

- [ ] **TEST-05**: Write unit tests for permit schema validation:
  - Description < 10 chars → VALIDATION_ERROR
  - Description > 500 chars → VALIDATION_ERROR
  - Category not in enum → VALIDATION_ERROR

- [ ] **TEST-06**: Write unit tests for avatar clear vs multipart modes.

- [ ] **TEST-07**: Write unit tests for Robin response normalization:
  - Enrollment status 404 → `not_enrolled`
  - Timeout → 504 UPSTREAM_TIMEOUT
  - Dependency failure → 503 DEPENDENCY_UNAVAILABLE

- [ ] **TEST-08**: Write unit tests for attendance business rules:
  - Active permit blocks attendance
  - Schedule outside window blocks attendance
  - Unenrolled face blocks attendance
  - No schedule blocks attendance

---

## P2 — Integration Tests & CI

- [ ] **ITEST-01**: Set up integration test infrastructure in `tests/integration/` (Supabase + Robin mock servers or test containers).

- [ ] **ITEST-02**: Write Robin client integration tests:
  - Readiness success
  - Identify success
  - Identify timeout
  - Enroll status not found (404)
  - Enroll upload success and failure

- [ ] **ITEST-03**: Write Supabase client integration tests:
  - Profile read
  - Avatar signed URL generation
  - Permit insert
  - Attendance persistence

- [ ] **ITEST-04**: Write endpoint-level integration tests:
  - Dashboard happy path
  - Attendance precheck blocked by permit
  - Attendance submit happy path
  - Attendance submit blocked before persistence
  - Permit create with attachment
  - Avatar upload and clear

- [ ] **CI-01**: Add `bun run test:integration` step to `.github/workflows/ci.yml`.

---

## P2 — Hardening

- [ ] **HARD-01**: Update `.env.example` to clearly show `SUPABASE_JWT_SECRET` and `SUPABASE_JWKS_URL` as alternatives with a comment explaining the XOR relationship.

- [ ] **HARD-02**: Add `dashboard/schema.ts` response validation middleware to the dashboard route (Zod response schema).

- [ ] **HARD-03**: Consider adding Zod response validation to all module routes to enforce response envelope compliance at runtime.

- [ ] **HARD-04**: Add `rejected_at` mapping in `src/modules/permits/service.ts` `toPermitResponse()` function.

---

## Summary

| Priority  | Count  | Category                          |
| --------- | ------ | --------------------------------- |
| P0        | 12     | Response shape & middleware fixes |
| P1        | 8      | Unit test coverage                |
| P2        | 8      | Integration tests & hardening     |
| **Total** | **28** |                                   |
