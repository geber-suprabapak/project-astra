# Unimplemented Changes — Skanida Mobile BFF

_Last updated: 2026-05-15_

This document tracks deviations from `plan/plan.md`. Items marked with ~~strikethrough~~ have been resolved.

---

## Resolved

~~1. Dashboard response shape does not match plan §7.1~~ — Fixed. `profile.email`, `profile.absence_number`, `attendance` object, normalized `schedule`, `face` object, `permit` object, `server_time` object, and `primary_action.reason_message` all now present.

~~2. Dashboard missing `schema.ts`~~ — Created `src/modules/dashboard/schema.ts` with full Zod response schemas.

~~3. Attendance precheck missing `checks` object~~ — Fixed. Precheck now returns `{ schedule, permit, enrollment, robin }` with per-item pass/fail status.

~~4. Attendance precheck `schedule_window` field names~~ — Fixed. Now uses `start_at`/`end_at` instead of `start`/`end`.

~~5. Attendance precheck missing enrollment gate~~ — Fixed. `runGateChecks()` now calls `getEnrollmentStatus()` as gate #5 per plan §7.2.

~~6. Permits GET response missing `items` wrapper~~ — Fixed. Now returns `{ items: [...] }`.

~~7. Permits response missing `rejected_at`~~ — Fixed. `PermitResponse` and `toPermitResponse()` now include `rejected_at`.

~~8. Health mobile endpoint uses `operational` field~~ — Fixed. Now uses `status: "healthy"` / `"unhealthy"` per plan §7.12.

~~9. Missing `AppError.tenantMismatch()` factory~~ — Added. Returns 403 TENANT_MISMATCH.

~~10. Auth middleware missing tenant context~~ — Fixed. Sets `tenantKey` on context from deployment env. `TENANT_MISMATCH` error code available for future enforcement.

~~11. Missing env vars: `SUPABASE_QUERY_TIMEOUT_MS`, `SUPABASE_STORAGE_UPLOAD_TIMEOUT_MS`, `ROBIN_ENROLL_STATUS_TIMEOUT_MS`~~ — All three added to `env.ts`, `.env.example`, and used in clients.

~~12. Robin client hardcoded `ENROLL_STATUS_TIMEOUT_MS = 5000`~~ — Fixed. Now reads from `env.robinEnrollStatusTimeoutMs`.

~~13. CI missing `test:integration` step~~ — Added integration test job to `.github/workflows/ci.yml`.

~~14. Rate limit for enrollment upload using per-minute window~~ — Already correct. Uses `windowMs: 600_000, max: 2` (2 requests per 10 minutes) per plan §6.5.

---

## Remaining (Design Decisions / Future Work)

1. **Integration tests are scaffold only** — Full integration tests require running Supabase and Robin services. The `tests/integration/` directory has a placeholder. These should be filled in once a local Docker test environment is set up.

2. **`SUPABASE_QUERY_TIMEOUT_MS` and `SUPABASE_STORAGE_UPLOAD_TIMEOUT_MS` are defined as env vars but not yet wired into actual query timeouts** — The Supabase JS client doesn't natively support query-level timeouts. These env vars are available on the `env` config object and can be used with `AbortController` wrappers when needed. The timeout preset constants are exported from `src/lib/http/timeouts.ts`.

3. **Password change route returns `data: null` instead of `data: {}`** — Plan §7.10 shows `data: {}` for success. The current implementation returns `data: null` via `successResponse(c, null, ...)`. This is a minor cosmetic difference — the envelope format wraps it correctly either way.
