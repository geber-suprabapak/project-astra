# Modules

## Application and middleware

**Purpose:** Build Hono, attach providers, enforce contract headers, and mount route families.
**Entry points:** `src/index.ts`, `src/app.ts`.

## Mobile API composition

**Purpose:** Mount health, auth, dashboard, attendance, enrollment, permits, profile, files, notifications, and time.
**Entry point:** `src/routes/v1-mobile.ts`.

## Domain modules

**Purpose:** Implement client-facing domain behavior without exposing storage/database internals.
**Entry points:** `src/modules/{attendance,dashboard,enrollment,files,permits,profile,notifications,admin}/`.

**Student read projection:** `src/modules/profile/canonical-profile.ts` is shared by admin student detail and mobile profile. It overlays canonical roster fields only after matching the Student binding to the requested User ID, preserving account-owned security metadata and legacy-only behavior. Generic DomainStore profile reads used by authentication are unchanged.

**Manual Leave creation:** `src/modules/admin/service.ts::createAdminLeaveRequest` authorizes all four Chronos roles or Student self-submission, requires an approved Student target, preserves pending-only creation and actor-owned attachments, and records the creator separately from the target Student. Both admin route aliases use this service; status decisions remain separate.

**Manual Attendance:** `src/modules/admin/service.ts::createManualAttendance` validates the approved Student and related failed/error Attempt before delegating creation to `DomainStore`. The provider commits the Attendance and its actor/reason/Attempt audit record together; notification enqueue happens after that transaction.

## Adiwiyata

**Purpose:** Authorize student camera reports and administrative Site/access management, daily coverage, and per-photo verification.
**Entry points:** `src/modules/adiwiyata/routes.ts`, `src/modules/adiwiyata/admin-routes.ts`, `src/modules/adiwiyata/service.ts`.
**Owns:** Class–Site–WIB-date coverage and server-watermarked final reports. Today's expected pairs reuse current eligible enrollment, active Sites, scoped schedules and holidays; historical dates contain actual reports only.
**Depends on:** Existing profiles, roster/bindings, academic periods, enrollment, schedules, calendar, `DomainStore`, file metadata and the dedicated S3 bucket. Verification and submission share the pair lock in `src/providers/adiwiyata-lock.ts`.
**Read next:** `contracts/astra-v1.json`, `tests/integration/adiwiyata-admin-reports.test.ts`, `tests/integration/adiwiyata-dashboard.test.ts`.

## Providers and clients

**Purpose:** Adapt PostgreSQL, S3-compatible storage, OIDC, Redis, and Robin.
**Entry points:** `src/providers/`, `src/clients/`.
**Non-responsibility:** Route policy and response presentation.

## Notification outbox worker

**Purpose:** Claim persisted notification work, dispatch it through a transport, and record delivered, retry, or terminal-failure state.
**Entry points:** `src/workers/notifications.ts`, `src/workers/notification-worker.ts`, `src/modules/notifications/`.
**Depends on:** `DomainStore` notification operations and a `NotificationTransport`.
