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
db/
  schema.sql                     Greenfield PostgreSQL schema definition
src/
  app.ts                         Hono app bootstrap, CORS, logging, provider injection, routes
  index.ts                       Server entrypoint
  clients/
    redis.ts                     Redis rate limiting client
    robin/                       Robin HTTP client and schemas
  providers/
    types.ts                     DomainStore, ObjectStorage, IdentityProvider, AppProviders interfaces
    postgres/                    PostgresDomainStore & migration runner
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
scripts/
  migrate.ts                     PostgreSQL migration execution script
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
- `/ready`: checks PostgreSQL (`database`), S3 (`objectStorage`), OIDC/Logto (`identity`), Robin (`mlService`), and Redis (`redis`); returns `503` when any required dependency is unavailable.
- `/v1/mobile/health`: mobile-safe health response with `status: "healthy"` or `status: "unhealthy"` without leaking provider internals.

## Environment Variables

All configuration is parsed and validated at boot via `src/config/env.ts`.

### Core & Tenant

| Variable | Default / Required | Description |
| -------- | ------------------ | ----------- |
| `NODE_ENV` | `development` | Runtime environment (`development`, `production`, `test`). |
| `PORT` | `3000` | HTTP server port. |
| `LOG_LEVEL` | `info` | Pino log level (`fatal`, `error`, `warn`, `info`, `debug`, `trace`). |
| `SERVICE_NAME` | `skanida-bff` | Service identifier for structured logs. |
| `TENANT_KEY` | **Required** | Deployment tenant slug identifier. |
| `TENANT_NAME` | **Required** | Display name of the school tenant. |
| `BUSINESS_TIMEZONE` | `Asia/Jakarta` | Timezone for canonical time and schedule calculations. |
| `CORS_ALLOWED_ORIGINS` | `""` | Comma-separated allowed origins (required in production; wildcards disallowed in production). |

### PostgreSQL Database

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/astra` | PostgreSQL connection string (supports direct or PgBouncer). |
| `DATABASE_MAX_CONNECTIONS` | `10` | Maximum connection pool size. |
| `DATABASE_IDLE_TIMEOUT_SECONDS` | `30` | Idle connection timeout in seconds. |
| `DATABASE_CONNECT_TIMEOUT_SECONDS` | `5` | Connection establishment timeout in seconds. |
| `DB_QUERY_TIMEOUT_MS` | `5000` | Database query timeout in milliseconds. |

### S3-Compatible Object Storage

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `S3_ENDPOINT` | `http://localhost:9000` | S3-compatible API endpoint (MinIO, Ceph, Garage, AWS S3). |
| `S3_REGION` | `us-east-1` | S3 region. |
| `S3_ACCESS_KEY_ID` | `minioadmin` | S3 access key ID. |
| `S3_SECRET_ACCESS_KEY` | `minioadmin` | S3 secret access key. |
| `S3_BUCKET_AVATARS` | `avatars` | Bucket name for profile avatars. |
| `S3_BUCKET_PERMITS` | `perizinan` | Bucket name for permit attachment files. |
| `S3_FORCE_PATH_STYLE` | `true` | Use path-style bucket addressing. |
| `S3_PUBLIC_URL` | _(Optional)_ | Optional custom base URL for public or presigned asset access. |
| `STORAGE_UPLOAD_TIMEOUT_MS` | `15000` | Storage upload timeout in milliseconds. |

### OIDC / Logto Authentication & Helper

| Variable | Default / Required | Description |
| -------- | ------------------ | ----------- |
| `OIDC_JWT_SECRET` | _(Required if no JWKS)_ | Secret key for symmetric HS256 JWT verification. |
| `OIDC_JWKS_URL` | _(Required if no Secret)_ | JWKS URL for asymmetric JWT verification. |
| `OIDC_ISSUER` | _(Optional)_ | Expected token issuer claim. |
| `OIDC_AUDIENCE` | `authenticated` | Expected token audience claim. |
| `LOGTO_ENDPOINT` | _(Optional)_ | Logto Management API endpoint URL. |
| `LOGTO_APP_ID` | _(Optional)_ | Logto Management API M2M App ID. |
| `LOGTO_APP_SECRET` | _(Optional)_ | Logto Management API M2M App Secret. |
| `AUTH_USER_ID` | _(Optional)_ | Default user ID for the `bun run auth:token` helper. |
| `AUTH_EMAIL` | _(Optional)_ | Default user email for the `bun run auth:token` helper. |

### Robin (Face Recognition API)

| Variable | Default / Required | Description |
| -------- | ------------------ | ----------- |
| `ROBIN_BASE_URL` | **Required** | Base URL for the internal Robin face recognition service. |
| `ROBIN_READY_TIMEOUT_MS` | `3000` | Health probe timeout in milliseconds. |
| `ROBIN_IDENTIFY_TIMEOUT_MS` | `30000` | Face identification timeout in milliseconds. |
| `ROBIN_ENROLL_TIMEOUT_MS` | `60000` | Face enrollment timeout in milliseconds. |
| `ROBIN_ENROLL_STATUS_TIMEOUT_MS` | `5000` | Face enrollment status query timeout in milliseconds. |

### Redis Rate Limiting

| Variable | Default / Required | Description |
| -------- | ------------------ | ----------- |
| `REDIS_URL` | _(Optional)_ | Redis connection URL (required in production; falls back to in-memory store in non-production). |
| `REDIS_KEY_PREFIX` | `astra:ratelimit` | Key prefix for rate limiting counters. |

### Downstream Timeouts

| Variable | Default | Downstream Target |
| -------- | ------- | ----------------- |
| `DB_QUERY_TIMEOUT_MS` | `5000` | PostgreSQL query execution |
| `STORAGE_UPLOAD_TIMEOUT_MS` | `15000` | S3 object storage upload operations |
| `ROBIN_READY_TIMEOUT_MS` | `3000` | Robin `/ready` health probe |
| `ROBIN_IDENTIFY_TIMEOUT_MS` | `30000` | Robin `/v1/face/identify` endpoint |
| `ROBIN_ENROLL_TIMEOUT_MS` | `60000` | Robin `/v1/face/enroll` endpoint |
| `ROBIN_ENROLL_STATUS_TIMEOUT_MS` | `5000` | Robin `/v1/face/enroll/status` endpoint |

## Testing & Quality Gates

Run the standard validation gates:

```bash
bun run typecheck
bun run lint
bun run test -- --pool=forks --maxWorkers=1
bun run test:integration -- --pool=forks --maxWorkers=1
```
