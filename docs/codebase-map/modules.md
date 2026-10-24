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
