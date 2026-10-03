# Invariants

## INV-ADIWIYATA-001 — Coverage uses current obligations only for today

**Rule:** Today's expected Class–Site pairs require an approved eligible student with one valid current enrollment and an active visible Site. Exact-Class schedules override period-wide schedules for the scoped WIB weekday; holidays suppress obligations. A general Site occurs once per eligible Class. Historical dates contain only actual reported/verified pairs, preserving old Classes and inactive Sites without creating retrospective missing obligations.
**Evidence:** `src/modules/adiwiyata/service.ts`, `tests/integration/adiwiyata-admin-reports.test.ts`.

## INV-ADIWIYATA-002 — Evidence authority and retention belong to Astra files

**Rule:** Students see only their own photo; other-photo reads require an approved Astra administrator and `files:read:any`. Ordinary file deletion cannot remove report evidence. Canonical `files.created_at` determines the exact 365-day deadline and caps signed URLs; expiry or object loss retains report and audit metadata. Upload and verification serialize on the same Class–Site–WIB-date lock, and rejected object writes remain tracked until cleanup is confirmed.
**Evidence:** `src/modules/adiwiyata/service.ts`, `src/modules/files/service.ts`, `src/providers/postgres/domain-store.ts`, `src/providers/adiwiyata-lock.ts`, `tests/unit/modules/files-service.test.ts`.

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

## INV-ASTRA-005 — Reopening rejected leave requests resets the decision

**Rule:** Reopening a rejected leave request returns it to pending with `status=false` and cleared rejection metadata, while preserving its audit-log and notification-outbox side effects. An approved Leave Period is immutable and cannot be reopened or extended.
**Evidence:** `src/modules/admin/service.ts`, `tests/integration/leave-requests.test.ts`, `tests/integration/challenger-adversarial-reopen.test.ts`.

## INV-ASTRA-006 — Delivery failures remain visible in the outbox

**Rule:** A failed notification delivery remains pending with exponential backoff until the retry limit, then becomes failed; only a successful transport result becomes delivered.
**Evidence:** `src/workers/notification-worker.ts`, `tests/unit/modules/notification-worker.test.ts`, `tests/integration/notifications.test.ts`.

## INV-ASTRA-007 — Backup audit preservation and status evaluation

**Rule:** Backup operations require a non-null lowercase 64-character hex SHA-256 checksum for all results and record actor, scope, format, range, checksum, counts, bytes, and result under entity_type `backup` and entity_id `year_month`. `insertAuditLog` returns the exact persisted `AuditLog` record without re-querying. `DomainStore.getAuditLogs` returns records newest-first across all adapters. GET `/v1/admin/backups/status` returns HTTP 200 with `{ completed: boolean, record: BackupStatusRecord | null }`; `completed=true` only when a persisted matching `details.result=completed` log exists using the latest completed record with strictly validated canonical fields without fabricating defaults, while absent or failed-only records return `completed=false` and `record=null`. Malformed completed log details surface an internal error.
**Evidence:** `src/modules/admin/service.ts`, `contracts/astra-v1.json`, `tests/integration/admin-backup.test.ts`.
