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

## Providers and clients

**Purpose:** Adapt PostgreSQL, S3-compatible storage, OIDC, Redis, and Robin.
**Entry points:** `src/providers/`, `src/clients/`.
**Non-responsibility:** Route policy and response presentation.

## Notification outbox worker

**Purpose:** Claim persisted notification work, dispatch it through a transport, and record delivered, retry, or terminal-failure state.
**Entry points:** `src/workers/notifications.ts`, `src/workers/notification-worker.ts`, `src/modules/notifications/`.
**Depends on:** `DomainStore` notification operations and a `NotificationTransport`.
