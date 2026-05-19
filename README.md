# Project Astra

Project Astra is the Backend-for-Frontend service for the Skanida mobile app. It owns the mobile-facing application logic for dashboard data, attendance gates, face enrollment, permits, profile updates, health checks, and canonical server time.

The service sits between the mobile app and the internal systems:

```text
Skanida Mobile App -> Project Astra (/v1/mobile/*) -> Supabase
                                                   -> Robin Face API
```

## Runtime Stack

- Node.js 22 LTS
- TypeScript
- Hono
- Zod
- jose
- Supabase JS client
- Pino
- Vitest
- ESLint
- Docker
- Bun

Use Bun only for local commands. This repository uses `bun.lock` and declares Bun in `package.json`.

## Application Boundary

Project Astra exposes a stable mobile API under `/v1/mobile`. The mobile app should not need to know Supabase table names, Robin endpoint details, storage bucket names, or attendance decision internals.

The BFF owns:

- bearer-token verification and request user context
- deployment-local tenant context
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

Robin stays internal and handles face recognition only. Supabase stays the system of record for auth, data, and storage.

## Project Structure

```text
src/
  app.ts                         Hono app bootstrap, CORS, logging, routes
  index.ts                       Node server entrypoint
  clients/
    robin/                       Robin HTTP client and schemas
    supabase/                    Supabase admin/auth/storage access
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
    v1-mobile.ts                 /v1/mobile route composition
tests/
  unit/                          unit tests
  integration/                   integration test harness
plan/
  plan.md                        implementation contract
  task-list.md                   completion task list
  post-implementation.md         implementation summary
```

## Response Envelope

Successful responses use:

```json
{
  "success": true,
  "data": {},
  "message": "Optional message",
  "request_id": "req_..."
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
  "request_id": "req_..."
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

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/live` | No | Process liveness probe |
| `GET` | `/ready` | No | Supabase and Robin readiness probe |
| `GET` | `/v1/mobile/health` | No | Mobile-safe service status |
| `GET` | `/v1/mobile/dashboard` | Yes | Dashboard aggregation and primary action gate |
| `POST` | `/v1/mobile/attendance/precheck` | Yes | Validate attendance eligibility before camera |
| `POST` | `/v1/mobile/attendance/submit` | Yes | Identify face and save attendance |
| `GET` | `/v1/mobile/face/enrollment/status` | Yes | Read face enrollment status |
| `POST` | `/v1/mobile/face/enrollment` | Yes | Upload enrollment images |
| `GET` | `/v1/mobile/permits` | Yes | List permit requests |
| `POST` | `/v1/mobile/permits` | Yes | Create permit request |
| `GET` | `/v1/mobile/profile` | Yes | Read profile |
| `PATCH` | `/v1/mobile/profile/avatar` | Yes | Upload or clear avatar |
| `PATCH` | `/v1/mobile/profile/password` | Yes | Change password |
| `GET` | `/v1/mobile/time` | Yes | Return canonical BFF time |

### Dashboard

`GET /v1/mobile/dashboard`

Returns one normalized payload for the mobile dashboard:

- `profile`: user identity, class, role, and avatar data
- `attendance`: today's attendance state
- `schedule`: active schedule window, or `null`
- `face`: Robin readiness and enrollment status
- `permit`: active permit state
- `primary_action`: the next allowed check-in/check-out action or a blocking reason
- `server_time`: BFF time and business timezone

### Attendance Precheck

`POST /v1/mobile/attendance/precheck`

Request:

```json
{
  "latitude": -7.123,
  "longitude": 112.123
}
```

The BFF evaluates schedule, permit, enrollment, Robin readiness, and location-related gates. It returns `allowed`, `action_type`, `reason_code`, `reason_message`, `schedule_window`, and a `checks` object containing per-gate pass/fail status.

### Attendance Submit

`POST /v1/mobile/attendance/submit`

Request:

```json
{
  "action_type": "check_in",
  "image_base64": "...",
  "latitude": -7.123,
  "longitude": 112.123
}
```

The BFF calls Robin identify, normalizes the recognition result, and saves the attendance record through Supabase.

### Face Enrollment

`GET /v1/mobile/face/enrollment/status`

Returns normalized enrollment status. A Robin not-found result becomes `not_enrolled`, not an internal error.

`POST /v1/mobile/face/enrollment`

Accepts multipart form-data with exactly 10 JPEG image files in the `files` field. Each image is limited to 2 MB. The route forwards the enrollment package to Robin and returns the normalized result.

### Permits

`GET /v1/mobile/permits`

Returns:

```json
{
  "items": []
}
```

Permit items include status timestamps, including `rejected_at` when available.

`POST /v1/mobile/permits`

Accepts multipart form-data:

- `category`: `sakit` or `pergi`
- `description`: 10 to 500 characters
- `date`: `YYYY-MM-DD`
- `attachment`: optional file, max 10 MB

### Profile

`GET /v1/mobile/profile`

Returns the authenticated user's normalized profile.

`PATCH /v1/mobile/profile/avatar`

Supports multipart upload with `file`, or JSON clear mode:

```json
{
  "clear": true
}
```

`PATCH /v1/mobile/profile/password`

Request:

```json
{
  "current_password": "old-password",
  "new_password": "new-password"
}
```

The BFF verifies the current password before updating it.

### Time

`GET /v1/mobile/time`

Returns the canonical BFF time:

```json
{
  "now": "2026-05-15T06:30:00.000Z",
  "timezone": "Asia/Jakarta",
  "source": "bff"
}
```

## Rate Limits

| Route | Limit |
| --- | --- |
| `GET /v1/mobile/dashboard` | 60 requests per minute |
| `POST /v1/mobile/attendance/precheck` | 12 requests per minute |
| `POST /v1/mobile/attendance/submit` | 6 requests per minute |
| `GET /v1/mobile/face/enrollment/status` | 30 requests per minute |
| `POST /v1/mobile/face/enrollment` | 2 requests per 10 minutes |
| `GET /v1/mobile/permits` | 30 requests per minute |
| `POST /v1/mobile/permits` | 5 requests per hour |
| `PATCH /v1/mobile/profile/avatar` | 10 requests per hour |
| `PATCH /v1/mobile/profile/password` | 5 requests per hour |
| `GET /v1/mobile/time` | 30 requests per minute |

Rate limiting uses Redis when `REDIS_URL` is configured. Non-production environments without Redis fall back to the in-process store.

## Environment

Copy `.env.example` to `.env` and fill school-specific values:

```text
NODE_ENV=development
PORT=3000
LOG_LEVEL=info
SERVICE_NAME=skanida-bff
TENANT_KEY=school-slug
TENANT_NAME=Nama Sekolah
BUSINESS_TIMEZONE=Asia/Jakarta
CORS_ALLOWED_ORIGINS=http://localhost:8081,exp://localhost:8081
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_JWT_SECRET=your-jwt-secret
# Optional. Set only if your Supabase JWT includes an "iss" claim.
# SUPABASE_JWT_ISSUER=https://your-project.supabase.co/auth/v1
SUPABASE_JWT_AUDIENCE=authenticated
SUPABASE_STORAGE_BUCKET_AVATARS=avatars
SUPABASE_STORAGE_BUCKET_PERMITS=perizinan
ROBIN_BASE_URL=http://robin:8000
ROBIN_READY_TIMEOUT_MS=3000
ROBIN_IDENTIFY_TIMEOUT_MS=30000
ROBIN_ENROLL_TIMEOUT_MS=60000
ROBIN_ENROLL_STATUS_TIMEOUT_MS=5000
SUPABASE_QUERY_TIMEOUT_MS=5000
SUPABASE_STORAGE_UPLOAD_TIMEOUT_MS=15000
REDIS_URL=redis://default:password@redis.example.internal:6379
REDIS_KEY_PREFIX=astra:ratelimit
```

JWT verification can use either `SUPABASE_JWT_SECRET` or `SUPABASE_JWKS_URL`. Provide one valid method for the deployment. `SUPABASE_JWT_ISSUER` is optional because some self-hosted Supabase/GoTrue tokens do not include an `iss` claim. In production, `REDIS_URL` is required and startup will fail fast when Redis is unreachable.

## Local Development

Install dependencies:

```bash
bun install
```

Run the development server:

```bash
bun run dev
```

Open:

```text
http://localhost:3000/live
http://localhost:3000/ready
http://localhost:3000/v1/mobile/health
```

## Scripts

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start the development server with watch mode |
| `bun run build` | Compile TypeScript to `dist/` |
| `bun run start` | Start the compiled production server |
| `bun run typecheck` | Run TypeScript without emit |
| `bun run lint` | Run ESLint over `src` and `tests` |
| `bun run test` | Run unit tests |
| `bun run test:integration` | Run integration tests |
| `bun run auth:token` | Get a Supabase access token for manual or scripted smoke checks |
| `bun run smoke:staging` | Run the staging smoke contract against `STAGING_BASE_URL` with `ACCESS_TOKEN` |

On constrained Windows environments, run Vitest with a single fork:

```bash
bun run test -- --pool=forks --maxWorkers=1
bun run test:integration -- --pool=forks --maxWorkers=1
```

## Docker

Run the prebuilt GHCR image with Docker Compose:

```bash
docker compose pull
docker compose up -d
```

The default image is `ghcr.io/geber-suprabapak/project-astra:latest`. Override it with `ASTRA_IMAGE` when deploying a pinned tag or SHA image.

The container listens on port `3000` and exposes a Docker healthcheck through `/ready`.

## Health Semantics

- `/live`: process is running; no downstream checks.
- `/ready`: checks Supabase, Robin, and Redis-backed rate limiting; returns `503` when a required dependency is unavailable.
- `/v1/mobile/health`: mobile-safe health response with `status: "healthy"` or `status: "unhealthy"`.

## Kubernetes Baseline

Baseline manifests live in [`k8s/`](./k8s):

- `deployment.yaml`: 3-replica deployment with rolling update strategy, resources, and probes
- `service.yaml`: cluster Service for HTTP traffic
- `configmap.yaml`: non-secret runtime config
- `secret.example.yaml`: secret template for Supabase and Redis

Probe contract:

- `startupProbe` -> `/live`
- `livenessProbe` -> `/live`
- `readinessProbe` -> `/ready`

Use the manifest probes as the source of truth for K8s readiness. The image `HEALTHCHECK` is only a container-level fallback.

## Testing Status

Current automated coverage includes:

- error code taxonomy
- AppError factories
- auth middleware
- rate limit store
- env config
- request validation schemas
- attendance mapper
- dashboard service and primary action gating
- schema constants
- time service
- integration test harness

Run the full local gate:

```bash
bun run typecheck
bun run lint
bun run test -- --pool=forks --maxWorkers=1
bun run test:integration -- --pool=forks --maxWorkers=1
```

## Staging Smoke Verification

Manual smoke verification is available through `.github/workflows/staging-smoke.yml`.

Required GitHub secrets:

- `STAGING_BASE_URL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `AUTH_EMAIL`
- `AUTH_PASSWORD`
- `SMOKE_LATITUDE`
- `SMOKE_LONGITUDE`

The workflow:

1. generates a staging access token with `bun run auth:token --json`
2. verifies `/live`, `/ready`, and `/v1/mobile/health`
3. verifies authenticated staging routes: `/v1/mobile/time`, `/v1/mobile/dashboard`, and `/v1/mobile/attendance/precheck`

## Curl Test Guide

Get a JWT with the interactive helper:

```bash
bun run auth:token
```

Store the token in your shell:

```bash
export JWT_TOKEN="<paste access token>"
```

Public endpoints:

```bash
curl "http://localhost:3000/live"
```

```bash
curl "http://localhost:3000/ready"
```

```bash
curl "http://localhost:3000/v1/mobile/health"
```

Auth-protected endpoints:

```bash
curl -H "Authorization: Bearer $JWT_TOKEN" "http://localhost:3000/v1/mobile/dashboard"
```

```bash
curl -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"latitude":-7.123,"longitude":112.123}' \
  "http://localhost:3000/v1/mobile/attendance/precheck"
```

```bash
curl -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action_type":"check_in","image_base64":"<base64>","latitude":-7.123,"longitude":112.123}' \
  "http://localhost:3000/v1/mobile/attendance/submit"
```

```bash
curl -H "Authorization: Bearer $JWT_TOKEN" \
  "http://localhost:3000/v1/mobile/face/enrollment/status"
```

```bash
curl -H "Authorization: Bearer $JWT_TOKEN" \
  -F "files=@./photo-1.jpg" \
  -F "files=@./photo-2.jpg" \
  -F "files=@./photo-3.jpg" \
  -F "files=@./photo-4.jpg" \
  -F "files=@./photo-5.jpg" \
  -F "files=@./photo-6.jpg" \
  -F "files=@./photo-7.jpg" \
  -F "files=@./photo-8.jpg" \
  -F "files=@./photo-9.jpg" \
  -F "files=@./photo-10.jpg" \
  "http://localhost:3000/v1/mobile/face/enrollment"
```

```bash
curl -H "Authorization: Bearer $JWT_TOKEN" \
  "http://localhost:3000/v1/mobile/permits"
```

```bash
curl -H "Authorization: Bearer $JWT_TOKEN" \
  -F "category=sakit" \
  -F "description=Demam dan perlu istirahat" \
  -F "date=2026-05-15" \
  -F "attachment=@./note.jpg" \
  "http://localhost:3000/v1/mobile/permits"
```

```bash
curl -H "Authorization: Bearer $JWT_TOKEN" \
  "http://localhost:3000/v1/mobile/profile"
```

```bash
curl -H "Authorization: Bearer $JWT_TOKEN" \
  -X PATCH \
  -F "file=@./avatar.jpg" \
  "http://localhost:3000/v1/mobile/profile/avatar"
```

```bash
curl -H "Authorization: Bearer $JWT_TOKEN" \
  -X PATCH \
  -H "Content-Type: application/json" \
  -d '{"clear":true}' \
  "http://localhost:3000/v1/mobile/profile/avatar"
```

```bash
curl -H "Authorization: Bearer $JWT_TOKEN" \
  -X PATCH \
  -H "Content-Type: application/json" \
  -d '{"current_password":"old-pass","new_password":"new-pass-123"}' \
  "http://localhost:3000/v1/mobile/profile/password"
```

```bash
curl -H "Authorization: Bearer $JWT_TOKEN" \
  "http://localhost:3000/v1/mobile/time"
```

## Implementation Status

The implementation covers the v1 plan surface:

- all mobile endpoints from `plan/plan.md` section 7 exist
- all stable error codes from section 6.3 exist
- timeout configuration is present
- route-level rate limits are configured
- Docker and CI baseline are present
- unit tests and integration harness are present
- README documents the operational and API contract

Deployment-specific end-to-end validation still depends on real school Supabase, Robin, and Redis credentials.
