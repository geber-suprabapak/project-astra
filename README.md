# Project Astra

Project Astra is the primary backend and API gateway service for the Skanida Platform. It owns the mobile-facing and client application logic for dashboard data, attendance gates, face enrollment, permits, profile updates, health checks, and canonical server time.

The service sits between clients and internal platform systems:

```text
Skanida Mobile App -> Project Astra (/v1/mobile/*) -> PostgreSQL (Domain Store)
                                                    -> S3-Compatible Object Storage
                                                    -> OIDC / Logto Identity
                                                    -> Robin Face API
```

## Runtime Stack

- Node.js 22 LTS / Bun 1.3
- TypeScript
- Hono
- Zod
- jose
- Postgres.js (`postgres`)
- Pino
- Vitest
- Oxlint and Oxfmt
- Docker
- Bun

Use Bun only for local commands. This repository uses `bun.lock` and declares Bun in `package.json`.

## Application Boundary

Project Astra exposes a stable public API under `/v1/mobile`. Clients (Mobile and Chronos) do not need direct access to database tables, Robin endpoint details, storage bucket internals, or attendance decision implementations.

Astra owns:

- bearer-token verification and request user context via `IdentityProvider`
- deployment-local tenant context
- domain persistence via `DomainStore` (PostgreSQL)
- file metadata and object storage operations via `ObjectStorage` (S3-compatible)
- common response envelopes
- stable error codes
- request validation
- per-route rate limits
- downstream timeouts
- dashboard aggregation and primary action gating
- attendance precheck and submit orchestration
- face enrollment status and upload orchestration
- permit listing and submission
- profile, avatar, and password workflows
- mobile-safe health status
- canonical business time

Robin stays internal and handles technical face recognition only. Astra/PostgreSQL is the single system of record for domain state.

## Project Structure

```text
src/
  app.ts                         Hono app bootstrap, CORS, logging, provider injection, routes
  index.ts                       Server entrypoint
  clients/
    redis.ts                     Redis rate limiting client
    robin/                       Robin HTTP client and schemas
  providers/
    types.ts                     DomainStore, ObjectStorage, IdentityProvider, AppProviders interfaces
    postgres/                    PostgresDomainStore implementation
    storage/                     S3ObjectStorage implementation (AWS SigV4)
    identity/                    OidcIdentityProvider implementation
    memory/                      In-memory provider test doubles
  config/                        env and tenant configuration
  lib/
    errors/                      AppError and stable error codes
    http/                        response envelope and timeout helpers
    logging/                     pino logger
  middleware/                    auth, error handler, request id, rate limit
  modules/
    attendance/                  precheck and submit routes/services
    dashboard/                   dashboard route/service/schema
    enrollment/                  face enrollment routes/services
    health/                      live, ready, mobile health
    permits/                     permit routes/services/schema
    profile/                     profile routes/services/schema
    time/                        canonical time route/service
  routes/
    v1-mobile.ts                 /v1/mobile route composition with provider injection
tests/
  unit/                          unit tests
  integration/                   integration & HTTP contract tests
```

## Response Envelope

Successful responses use:

```json
{
  "success": true,
  "data": {},
  "message": "Optional message",
  "meta": {
    "request_id": "req_...",
    "timestamp": "2026-08-20T..."
  }
}
```

Error responses use:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": {}
  },
  "meta": {
    "request_id": "req_...",
    "timestamp": "2026-08-20T..."
  }
}
```

Stable error codes:

- `AUTH_REQUIRED`
- `AUTH_INVALID`
- `FORBIDDEN`
- `VALIDATION_ERROR`
- `TENANT_MISMATCH`
- `ATTENDANCE_BLOCKED`
- `ENROLLMENT_REQUIRED`
- `DEPENDENCY_UNAVAILABLE`
- `UPSTREAM_TIMEOUT`
- `STORAGE_UPLOAD_FAILED`
- `RESOURCE_NOT_FOUND`
- `CONFLICT`
- `INTERNAL_ERROR`

## API Surface

| Method  | Path                                | Auth | Purpose                                       |
| ------- | ----------------------------------- | ---- | --------------------------------------------- |
| `GET`   | `/live`                             | No   | Process liveness probe                        |
| `GET`   | `/ready`                            | No   | Portable runtime readiness probe              |
| `GET`   | `/v1/mobile/health`                 | No   | Mobile-safe service status                    |
| `GET`   | `/v1/mobile/dashboard`              | Yes  | Dashboard aggregation and primary action gate |
| `POST`  | `/v1/mobile/attendance/precheck`    | Yes  | Validate attendance eligibility before camera |
| `POST`  | `/v1/mobile/attendance/submit`      | Yes  | Identify face and save attendance             |
| `GET`   | `/v1/mobile/face/enrollment/status` | Yes  | Read face enrollment status                   |
| `POST`  | `/v1/mobile/face/enrollment`        | Yes  | Upload enrollment images                      |
| `GET`   | `/v1/mobile/permits`                | Yes  | List permit requests                          |
| `POST`  | `/v1/mobile/permits`                | Yes  | Create permit request                         |
| `GET`   | `/v1/mobile/profile`                | Yes  | Read profile                                  |
| `PATCH` | `/v1/mobile/profile/avatar`         | Yes  | Upload or clear avatar                        |
| `PATCH` | `/v1/mobile/profile/password`       | Yes  | Change password                               |
| `GET`   | `/v1/mobile/time`                   | Yes  | Return canonical BFF time                     |

## Health Semantics

- `/live`: process is running; no downstream checks.
- `/ready`: checks PostgreSQL (`database`), S3 (`objectStorage`), Robin (`mlService`), and Redis (`redis`); returns `503` when any required dependency is unavailable.
- `/v1/mobile/health`: mobile-safe health response with `status: "healthy"` or `status: "unhealthy"` without leaking provider internals.

## Testing & Quality Gates

Run the standard validation gates:

```bash
bun run typecheck
bun run test -- --pool=forks --maxWorkers=1
bun run test:integration -- --pool=forks --maxWorkers=1
```
