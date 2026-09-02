# Invariants

## INV-ASTRA-001 — `/v1` uses the supported contract version

**Rule:** Outside tests, `/v1/*` without `X-Astra-Contract-Version: v1` is rejected before domain routing.
**Evidence:** `src/app.ts`.

## INV-ASTRA-002 — Astra owns domain authority

**Rule:** Clients do not directly own domain persistence, storage authorization, or Robin behavior.
**Evidence:** `README.md`, `src/providers/types.ts`.

## INV-ASTRA-003 — Robin does not create attendance

**Rule:** Preserve Astra’s attendance orchestration boundary around technical face results.
**Evidence:** `README.md`, `src/modules/attendance/service.ts`.

## INV-ASTRA-004 — Submission follows server gate evaluation

**Rule:** A submitted action must remain consistent with server eligibility/window checks.
**Evidence:** `src/modules/attendance/service.ts`, `src/providers/postgres/domain-store.ts`.

## INV-ASTRA-005 — Reopening resets the leave decision and records side effects

**Rule:** Reopening a leave request returns it to pending with `status=false` and cleared rejection metadata, while preserving its audit-log and notification-outbox side effects.
**Evidence:** `src/modules/admin/service.ts`, `tests/integration/leave-requests.test.ts`, `tests/integration/challenger-adversarial-reopen.test.ts`.

## INV-ASTRA-006 — Delivery failures remain visible in the outbox

**Rule:** A failed notification delivery remains pending with exponential backoff until the retry limit, then becomes failed; only a successful transport result becomes delivered.
**Evidence:** `src/workers/notification-worker.ts`, `tests/unit/modules/notification-worker.test.ts`, `tests/integration/notifications.test.ts`.
