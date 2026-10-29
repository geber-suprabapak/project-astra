# Invariants

## INV-ASTRA-020 — Leave history exposes only audit snapshots

**Rule:** Approval, rejection, reopening and force-finish audit rows snapshot the actor's profile name and role. The authorized history endpoint returns only those actions, timestamp and snapshot fields; legacy values remain null, actor IDs/raw details stay internal, and the existing audit retention behavior applies without a second store or TTL.
**Evidence:** `src/modules/admin/routes.ts`, `src/modules/admin/service.ts`, `src/providers/postgres/domain-store.ts`, `src/providers/memory/index.ts`, `contracts/astra-v1.json`, `tests/integration/leave-requests.test.ts`.

## INV-ASTRA-018 — Manual Attendance and audit commit together

**Rule:** A Manual Attendance is persisted with its actor, reason, and related Attempt audit record in the same PostgreSQL transaction. If the audit insert fails, the transaction fails and the Attendance does not commit. The Memory provider removes any partially persisted audit before returning the failure. Notification enqueue occurs after the Attendance/audit commit and may fail independently.
**Evidence:** `src/modules/admin/service.ts`, `src/providers/postgres/domain-store.ts`, `src/providers/memory/index.ts`, `tests/unit/providers/postgres-domain-store.test.ts`, `tests/unit/modules/attendance-exceptions-service.test.ts`.

## INV-ASTRA-019 — Manual Attendance uses an eligible same-day Attempt

**Rule:** Only the canonical `school_admin` role may create Manual Attendance. The related Attempt must be `failed` or `error`, belong to the same Student, match the action, have a valid timestamp, and fall on the same WIB date as the Attendance.
**Evidence:** `src/modules/admin/service.ts`, `src/providers/types.ts`, `tests/unit/modules/attendance-exceptions-service.test.ts`.

## INV-ASTRA-017 — File sizes cross the PostgreSQL boundary as numbers

**Rule:** FileRecord size_bytes is a number or null on create, get, list and lifecycle-update responses. PostgreSQL bigint storage is projected through a numeric driver type so verification can compare it strictly with S3 object bytes. Null and zero are preserved. Upload verification still checks object existence, MIME and exact size; existing rejected files are never silently reactivated.
**Evidence:** `src/providers/postgres/domain-store.ts`, `src/modules/files/service.ts`, `tests/integration/postgres-file-records.test.ts`. The real PostgreSQL test pins a transaction, asserts pg_temp resolution and uses ON COMMIT DROP for its private file table.

## INV-ASTRA-016 — Chronos roles may create pending Leave Requests

**Rule:** Approved platform administrators, school administrators, teachers and staff with the admin API scope may create a pending Leave Request for an approved Student. The Student may still submit only for themselves. Creation retains actor-owned permit attachments, attachment-purpose/lifecycle validation, and the creator audit identity; it does not grant approval/rejection/reopen/force-finish privileges. Route aliases delegate creation authorization to the same service. This follows the owner decision of 28 October 2026 that users admitted to Chronos may use its manual Leave creation feature.
**Evidence:** `src/modules/admin/routes.ts`, `src/modules/admin/service.ts`, `tests/unit/modules/admin-leave-service.test.ts`, `tests/integration/leave-requests.test.ts`, `tests/integration/challenger-scope1.test.ts`.

## INV-ASTRA-015 — Leave student fields follow the verified canonical binding

**Rule:** Leave detail, collection and write responses project name, class and absence number from the canonical Student only when its binding, User ID and profile NIS agree for a student profile. The latest active enrollment supplies class/absence; a bound student without an active enrollment clears stale legacy class/absence. Legacy-only and mismatched bindings retain legacy fields. PostgreSQL collections use one query without per-row roster reads; reads do not rewrite profiles or enrollments. Write enrichment preserves the committed leave snapshot and remains best effort if its subsequent read fails.
**Evidence:** `src/providers/postgres/domain-store.ts`, `src/providers/memory/index.ts`, `tests/unit/providers/leave-profile-projection.test.ts`, `tests/unit/providers/postgres-domain-store.test.ts`, `tests/integration/postgres-leave-lifecycle.test.ts`.

## INV-ASTRA-014 — Staff session revocation retains a token-time cutoff

**Rule:** Authentication passes only the verified identity provider's `issuedAt` into the revocation query. Retained `revoked_at` rows reject tokens issued at/before the latest cutoff; missing, malformed or future timing remains denied when a marker exists. JWT second precision conservatively rejects the entire cutoff second. Staff role changes/re-enable revoke Logto sessions and all associated grants before domain publication, then write a new cutoff in the profile transaction. Disabling/rejecting restricts the profile first so an IdP outage cannot leave access enabled; subsequent revocation failure returns an error without a success audit. Logto sessions are listed with the supported API and deleted by `payload.uid` with `revokeGrantsTarget=all`; failures propagate and prevent profile/audit success. Revocation rows are never cleared to re-enable an account. Issuer/database clock consistency is required; this is not a distributed transaction or proof of every concurrent session race.
**Evidence:** `src/middleware/auth.ts`, `src/providers/identity/oidc-identity.ts`, `src/providers/postgres/domain-store.ts`, `src/providers/memory/index.ts`, `src/modules/admin/service.ts`, `tests/integration/staff-roles.test.ts`, `tests/unit/providers/oidc-identity.test.ts`, `tests/unit/providers/postgres-domain-store.test.ts`. Supported session endpoints: [Logto session API](https://docs.logto.io/sessions/manage-user-sessions), [grant revocation option](https://openapi.logto.io/operation/operation-deleteusersession). Installed Logto source: `/etc/logto/packages/core/src/routes/admin-user/session.ts`.

## INV-ASTRA-013 — Operational academic reads are distinct from policy writes

**Rule:** Approved platform administrators, school administrators, teachers and staff with the admin API scope can read academic periods and class enrollments for operational roster/attendance summaries. Policy creation, enrollment changes and other configuration mutations retain administrator-only checks. Student profiles remain denied even with an over-scoped token. This matches the existing operational student/class/attendance read policy and Chronos's documented teacher/staff dashboard access.
**Evidence:** `src/modules/admin/service.ts`, `tests/integration/academic-attendance-policy.test.ts`, Chronos `docs/rbac-implementation.md`.

## INV-ASTRA-012 — Staff assigned roles precede domain publication

**Rule:** Staff creation assigns the primary and extra roles through the identity provider before publishing an approved profile or success audit. When identity creation is configured, callers cannot supply a different User ID. Role updates replace the complete identity role set before updating the profile; roles-only input retains the primary role. A school administrator cannot modify an existing platform administrator. Identity failures propagate; no manual `customData` role is an authorization substitute. These operations are not a distributed transaction: a failed create may retain an identity without a profile, and database/session-revocation recovery requires separate validation.
**Evidence:** `src/modules/admin/service.ts`, `src/providers/identity/oidc-identity.ts`, `tests/unit/modules/admin-staff-service.test.ts`, `tests/unit/providers/oidc-identity.test.ts`.

## INV-ASTRA-011 — Student profile reads use binding-verified canonical fields

**Rule:** Admin student detail and mobile profile share the canonical student read projection. Overlay roster name, class, absence number and gender only when a canonical Student and its binding match the requested User ID. Account email, role, lifecycle and avatar remain profile-owned; legacy-only or mismatched bindings keep the legacy profile. Roster read failures propagate instead of masquerading as missing values. Mobile active-enrollment absence number takes precedence when available. Reads do not rewrite profiles or enrollments.
**Evidence:** `src/modules/profile/canonical-profile.ts`, `src/modules/profile/service.ts`, `src/modules/admin/service.ts`, `tests/unit/modules/admin-student-service.test.ts`, `tests/unit/modules/profile-history.test.ts`.

## INV-ASTRA-010 — Monthly attendance counts days

**Rule:** Monthly totals count days, not requests. Present, late and absent use aggregated daily attendance; approved leave expands inclusively through its effective end, clipped to the selected month, with legacy approvals treated as one day. Historical date filters reach the DomainStore before its collection limit. Repeated attendance records and checkout on the same date do not add days.
**Evidence:** `src/modules/attendance/service.ts`, `tests/integration/profile-history.test.ts`.

## INV-ASTRA-008 — Identity success precedes student approval

**Rule:** Assign the student role and activate the identity before writing the approved profile lifecycle. Identity failures leave the previous lifecycle and do not emit approval audit/notification success. Retry repeats idempotent identity operations; Astra's profile gate remains authoritative if the final database write fails. This ordering does not provide a distributed transaction or atomic audit/outbox publication.
**Evidence:** `src/modules/admin/service.ts`, `tests/unit/modules/admin-student-service.test.ts`, `src/middleware/auth.ts`.

## INV-ASTRA-009 — Serialized JSON persists as structured JSONB

**Rule:** Bind serialized audit details and outbox payloads as text before casting to JSONB, so postgres.js cannot encode them into JSON strings. Read legacy double-encoded audit/outbox records without rewriting durable state. Rejection/reopening clear period fields as SQL nulls in the same transaction as the required audit insert.
**Evidence:** `src/providers/postgres/domain-store.ts`, `tests/integration/postgres-leave-lifecycle.test.ts`.

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
