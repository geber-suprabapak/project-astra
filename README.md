# Project Astra

Project Astra is the primary backend, API gateway (BFF), and notification engine for the Skanida Platform. It serves client-facing APIs for the **Skanida Mobile App** (dashboard, attendance gates, face enrollment, permits/leave requests, profile, canonical time, file uploads, Adiwiyata camera reports) and privileged APIs for **Chronos Web Admin** (school bootstrap, roster ingestion, student lifecycle, academic periods, schedules, geofenced locations, manual attendance, leave decisions, outbox notifications, backup tracking, Adiwiyata site management).

The service coordinates internal platform components and external integrations:

```text
[Skanida Mobile App]       [Chronos Web Admin]
         │                          │
         ▼                          ▼
   /v1/mobile/*                /v1/admin/*
   /v1/adiwiyata/*             /v1/auth/*
         │                          │
         └───────────┬──────────────┘
                     ▼
       ┌───────────────────────────┐
       │   Project Astra (BFF)     │
       │   - Hono API Service      │
       │   - Contract Gating (v1)  │
       │   - RBAC & Audit Trails   │
       └─────────────┬─────────────┘
                     │
     ┌───────────────┼───────────────┬─────────────────┐
     ▼               ▼               ▼                 ▼
[PostgreSQL]    [Garage S3]     [Logto OIDC]     [Robin Face API]
DomainStore     ObjectStore     Identity & M2M   Internal ML
(CNPG Pooler)   (Presigned URL) (JWKS / Scopes)  (Private Mesh)
     ▲
     │ outbox poll
┌────┴──────────────────────────┐
│   Astra Notification Worker   │ ──────▶ [Expo Push Service]
│   (bun worker:notifications)  │         (Mobile Notifications)
└───────────────────────────────┘
```

## Runtime Stack

- **Runtime**: Node.js 22 LTS / Bun 1.3 (`bun@1.3.13`, `engines.node >= 22`)
- **Language**: TypeScript 5.8
- **HTTP Framework**: Hono 4.12
- **Validation**: Zod 4.6
- **Identity & Cryptography**: `jose` 5.10 (OIDC JWT / JWKS)
- **Database Driver**: Postgres.js (`postgres` 3.4)
- **Cache & Rate Limiting**: Redis (`redis` 5.12)
- **Image Processing**: Sharp 0.35 (EXIF handling, JPEG/PNG recompression)
- **Logging**: Pino 9.6 (structured JSON logs)
- **Testing**: Vitest 3.2
- **Linter & Formatter**: Oxlint 1.81 and Oxfmt 0.63
- **Containerization**: Multi-stage Dockerfile running as non-root user `bun`
- **Orchestration**: Kubernetes (Deployment, Service, ConfigMap, Secret, Job) via GitOps / ArgoCD

## Application Boundary & Security

Project Astra exposes stable public endpoints under `/v1/mobile`, `/v1/adiwiyata`, `/v1/auth`, and privileged endpoints under `/v1/admin`. Downstream infrastructure details (database schemas, Robin ML endpoints, S3 bucket storage keys, and raw credentials) remain encapsulated within Astra.

### Core Architecture Responsibilities

- **Contract Version Gating**: All `/v1/*` requests require the `X-Astra-Contract-Version: v1` header in non-test environments (HTTP `426 CONTRACT_VERSION_UNSUPPORTED` returned on absence or mismatch).
- **Security Headers**: Injected on every response (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`).
- **Identity & RBAC**: Bearer-token verification with Logto OIDC issuer and JWKS; role and scope authorization (`mobile:access`, `admin:read`, `files:read:any`, `files:delete:any`). Transitional legacy Supabase JWT verification bridge supported during migration windows.
- **Attendance Engine**: Student eligibility precheck (geofence, schedule, active permits), live face verification via Robin ML, atomic PostgreSQL attendance records, manual attendance adjustments with immutable audit logging.
- **Leave Requests / Permits**: Multi-day leave submissions, Chronos admin review workflows (approve with duration days, reject with reason, force-finish with effective end date, reopen), overlap prevention, and decision history.
- **Student Lifecycle & Roster**: Platform bootstrap, CSV roster staging and acceptance, student signup with roster NIS matching, administrator review (approve/reject/disable), one-time reset code generation, email correction, and face enrollment reset.
- **Adiwiyata Camera Reports**: Daily student environmental photo uploads with JPEG/PNG validation, 5 MB file size limit, Sharp metadata re-encoding, class/site eligibility check, and admin report verification.
- **File Management & Signed URLs**: Direct client upload intents, file confirmation, Redis-cached signed URLs with automated cache invalidation upon mutation.
- **Notification Outbox Worker**: Transactional notification staging in PostgreSQL `notification_outbox`, claim-based background worker polling, exponential backoff retries, and Expo Push Notification delivery.

---

## Deployment & Kubernetes Staging Architecture

Astra runs on **Kubernetes** (staging and production environments managed through the `infra` repository via ArgoCD GitOps):

### Kubernetes Components (`skanida-core` Namespace)

1. **Astra Migration Job (`astra-migrate`)**:
   - Runs `bun scripts/migrate.ts` with Sync-Wave `-1`.
   - Executes database schema migrations before new pods receive traffic.
2. **Astra API Deployment (`astra`)**:
   - 3 replicas with `RollingUpdate` strategy (`maxSurge: 1`, `maxUnavailable: 0`).
   - Priority class: `platform-critical`.
   - Topology spread constraints across nodes (`kubernetes.io/hostname`).
   - PodDisruptionBudget: `minAvailable: 1`.
   - Probes: `startupProbe` (`/live`), `livenessProbe` (`/live`), `readinessProbe` (`/ready`).
   - Runs as non-root `bun` user.
3. **Astra Notification Worker Deployment (`astra-notifications`)**:
   - 1 replica running `bun src/workers/notifications.ts`.
   - Claim-based worker processing outbox push notifications without exposing HTTP ports.
4. **Astra Service (`astra`)**:
   - Internal ClusterIP service exposing port `3000` (targetPort `3000`).
5. **Config & Secrets (`astra-config`, `astra-secrets`)**:
   - Configuration injected via ConfigMap and Secret references.
   - Database connected via CloudNativePG (CNPG) pooler: `skanida-pg-pooler.skanida-core.svc.cluster.local:5432/skanida`.
   - Storage connected to in-cluster Garage S3: `http://garage.skanida-core.svc.cluster.local:3900` with public asset ingress `https://storage.lunaradev.my.id`.
   - Authentication connected to Logto OIDC: public issuer `https://auth.lunaradev.my.id/oidc` with in-cluster JWKS `http://logto.skanida-core.svc.cluster.local:3001/oidc/jwks`.
   - Face recognition routed to internal Robin ML mesh: `http://robin.skanida-core.svc.cluster.local:8000`.

### Standalone Manifests in Repo (`k8s/`)

This repository includes standalone manifests in `k8s/` for isolated deployment or local testing:
- `k8s/deployment.yaml`: Baseline 3-replica Astra Deployment.
- `k8s/service.yaml`: ClusterIP service exposing port `80` -> `3000`.
- `k8s/configmap.yaml`: Baseline environment configuration.
- `k8s/secret.example.yaml`: Secret template for connection strings and API keys.

---

## Project Structure

```text
db/
  schema.sql                     Greenfield PostgreSQL schema definition
  migrations/                    Incremental migration scripts & documentation
k8s/
  deployment.yaml                Standalone Kubernetes Deployment manifest
  service.yaml                   Standalone Kubernetes Service manifest
  configmap.yaml                 Standalone Kubernetes ConfigMap manifest
  secret.example.yaml            Kubernetes Secret template
src/
  app.ts                         Hono application factory, global middleware, route mounts
  index.ts                       Server entrypoint
  authz/                         RBAC scopes, permission policies, and role definitions
  clients/                       Redis and Robin HTTP clients
  config/                        Environment validation schema (Zod)
  lib/
    errors/                      AppError class and stable error codes
    http/                        Standard response envelopes and timeout helpers
    logging/                     Structured Pino logger
  middleware/                    Auth, privileged auth, request ID, timeout, rate limiting, error handler
  modules/
    adiwiyata/                   Student camera report submission and admin site verification
    admin/                       Chronos administration: bootstrap, roster, staff, academic, attendances
    attendance/                  Attendance precheck, submit, history, and calendar
    auth/                        Student public registration, password reset, and auth routes
    dashboard/                   Mobile dashboard aggregation and primary action gating
    enrollment/                  Face enrollment status, photo upload, and removal
    files/                       Upload intent, confirmation, file retrieval, and signed URLs
    health/                      Liveness probe, readiness probe, and mobile health
    notifications/               Mobile notification token registration and outbox admin
    permits/                     Leave requests and permit submissions for students
    profile/                     Student profile, avatar updates, and enrollment history
    time/                        Canonical server time
  providers/
    types.ts                     DomainStore, ObjectStorage, IdentityProvider interfaces
    postgres/                    PostgresDomainStore implementation & query logic
    storage/                     S3ObjectStorage implementation (AWS SigV4 / Garage / MinIO)
    identity/                    OidcIdentityProvider implementation (Logto / OIDC)
    memory/                      In-memory provider test doubles
  types/                         App context and environment definitions
  workers/
    notifications.ts             Worker startup and graceful shutdown entrypoint
    notification-worker.ts       Claim-based notification queue runner with retries
scripts/
  migrate.ts                     PostgreSQL migration runner
  get-jwt-token.ts               CLI helper for issuing development JWT tokens
  staging-smoke.ts               Automated end-to-end smoke test for staging
tests/
  unit/                          Vitest unit test suites
  integration/                   Vitest integration and contract test suites
```

---

## Response Envelope

### Success Response

```json
{
  "success": true,
  "data": {},
  "message": "Optional message",
  "meta": {
    "request_id": "req_...",
    "timestamp": "2026-11-03T09:00:00.000Z"
  }
}
```

### Error Response

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
    "timestamp": "2026-11-03T09:00:00.000Z"
  }
}
```

### Stable Error Codes

| Error Code | Description |
|---|---|
| `AUTH_REQUIRED` | Missing or unparseable Bearer authentication token |
| `AUTH_INVALID` | Expired, invalid signature, or rejected authentication token |
| `FORBIDDEN` | Insufficient permissions, role unauthorized, or unapproved profile |
| `VALIDATION_ERROR` | Request payload, parameters, or query string failed schema validation |
| `CONTRACT_VERSION_UNSUPPORTED` | Request missing or mismatched `X-Astra-Contract-Version: v1` header |
| `TENANT_MISMATCH` | Action does not match deployment tenant boundary |
| `ATTENDANCE_BLOCKED` | Attendance precheck failed (outside geofence, off-schedule, or pending leave) |
| `ENROLLMENT_REQUIRED` | Student does not have an active face enrollment profile |
| `LEAVE_REQUEST_PENDING` | Active pending leave request blocks new submission |
| `LEAVE_PERIOD_OVERLAP` | Requested leave dates conflict with an existing excused period |
| `LEAVE_APPROVAL_CONFLICT` | Leave request cannot be approved due to status conflict |
| `ADIWIYATA_NOT_ELIGIBLE` | Student is not eligible or registered for Adiwiyata reports |
| `ADIWIYATA_CONFIGURATION_ERROR` | Adiwiyata site or system configuration missing |
| `STORAGE_UPLOAD_FAILED` | S3 object storage upload failed |
| `RESOURCE_NOT_FOUND` | Requested entity does not exist |
| `CONFLICT` | Resource conflict (e.g., duplicate record, state transition invalid) |
| `DEPENDENCY_UNAVAILABLE` | Downstream service (DB, S3, Robin, Redis, Logto) unreachable |
| `UPSTREAM_TIMEOUT` | Downstream service exceeded request deadline |
| `INTERNAL_ERROR` | Unexpected server failure |

---

## API Surface

### 1. System & Health Probes

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/live` | No | Process liveness probe (never touches downstreams) |
| `GET` | `/ready` | No | Portable readiness probe (verifies DB, S3, OIDC, Robin, Redis within deadline) |
| `GET` | `/v1/mobile/health` | No | Mobile-safe service status (`healthy` or `unhealthy` without leaking internal details) |

### 2. Public Authentication (`/v1/auth/*`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/auth/student/signup` | No | Register new student with valid roster NIS (creates pending profile) |
| `POST` | `/v1/auth/student/reset-password` | No | Reset student password using one-time administrator reset code |
| `POST` | `/v1/auth/password` | Yes | Change password for authenticated user and revoke active sessions |

### 3. Skanida Mobile API (`/v1/mobile/*`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/v1/mobile/dashboard` | Yes | Aggregated dashboard data and primary action gate |
| `POST` | `/v1/mobile/attendance/precheck` | Yes | Validate attendance eligibility (geofence, schedule, leave) before camera |
| `POST` | `/v1/mobile/attendance/submit` | Yes | Submit selfie image and coordinates for biometric attendance |
| `GET` | `/v1/mobile/attendance` | Yes | List attendance records by date range |
| `GET` | `/v1/mobile/attendance/history` | Yes | Student attendance history with statistics |
| `GET` | `/v1/mobile/attendance/calendar` | Yes | Attendance calendar view for a given year and month |
| `GET` | `/v1/mobile/face/enrollment/status`| Yes | Read face enrollment status from Robin ML |
| `POST` | `/v1/mobile/face/enrollment` | Yes | Upload biometric enrollment photo set |
| `DELETE`| `/v1/mobile/face/enrollment` | Yes | Delete active biometric enrollment |
| `GET` | `/v1/mobile/permits` | Yes | List student permit and leave requests (alias `/v1/mobile/leave-requests`) |
| `POST` | `/v1/mobile/permits` | Yes | Create student permit/leave request (alias `/v1/mobile/leave-requests`) |
| `GET` | `/v1/mobile/permits/:id` | Yes | Retrieve permit request details |
| `DELETE`| `/v1/mobile/permits/:id` | Yes | Cancel pending permit request |
| `GET` | `/v1/mobile/profile` | Yes | Read current user profile and academic status |
| `GET` | `/v1/mobile/profile/enrollments` | Yes | Read student class enrollment history |
| `PATCH` | `/v1/mobile/profile/avatar` | Yes | Upload new avatar or clear current avatar |
| `PATCH` | `/v1/mobile/profile/password` | Yes | Update password for current mobile user |
| `POST` | `/v1/mobile/files/upload-intent` | Yes | Request presigned upload intent for file attachment |
| `POST` | `/v1/mobile/files/:id/confirm` | Yes | Confirm completed object storage upload |
| `GET` | `/v1/mobile/files/:id` | Yes | Retrieve signed download URL for stored file |
| `DELETE`| `/v1/mobile/files/:id` | Yes | Delete stored file metadata and object storage asset |
| `GET` | `/v1/mobile/notifications/token` | Yes | Read registered push notification device token |
| `PATCH` | `/v1/mobile/notifications/token` | Yes | Update push notification device token |
| `GET` | `/v1/mobile/time` | Yes | Get canonical backend business time and timezone |

### 4. Adiwiyata Mobile API (`/v1/adiwiyata/*`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/v1/adiwiyata/dashboard` | Yes | Read student Adiwiyata status, assigned sites, and daily quota |
| `POST` | `/v1/adiwiyata/reports` | Yes | Upload camera report photo (multipart JPEG/PNG up to 5 MB) |

### 5. Chronos Administration API (`/v1/admin/*`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/v1/admin/session` | Yes | Validate active privileged session and return permissions |
| `GET` | `/v1/admin/bootstrap/status` | Yes | Read bootstrap readiness and school status |
| `POST` | `/v1/admin/bootstrap/school` | Yes | Initialize school tenant (`platform_admin` only) |
| `POST` | `/v1/admin/bootstrap/school-admin`| Yes | Create initial `school_admin` profile (`platform_admin` only) |
| `POST` | `/v1/admin/bootstrap/roster` | Yes | Stage and validate student roster CSV batch |
| `GET` | `/v1/admin/bootstrap/roster/:id` | Yes | Read staged roster validation report and row errors |
| `POST` | `/v1/admin/bootstrap/roster/:id/accept`| Yes | Commit valid roster batch to canonical student store |
| `POST` | `/v1/admin/bootstrap/signup/open` | Yes | Open student registration after roster acceptance |
| `GET` | `/v1/admin/students` | Yes | List student profiles with lifecycle filtering |
| `GET` | `/v1/admin/students/:userId` | Yes | Read student profile details |
| `POST` | `/v1/admin/students/:userId/approve`| Yes | Approve pending student profile and activate Logto identity |
| `POST` | `/v1/admin/students/:userId/reject` | Yes | Reject student profile and revoke sessions |
| `POST` | `/v1/admin/students/:userId/disable`| Yes | Disable active student profile and revoke sessions |
| `POST` | `/v1/admin/students/:userId/reset-code`| Yes| Generate one-time recovery code for student password reset |
| `PATCH` | `/v1/admin/students/:userId/email` | Yes | Correct unverified student email address |
| `DELETE`| `/v1/admin/students/:userId/face-enrollment`| Yes| Reset student biometric enrollment in Robin ML |
| `GET` | `/v1/admin/roles` | Yes | List RBAC roles |
| `POST` | `/v1/admin/roles` | Yes | Create custom RBAC role |
| `GET` | `/v1/admin/roles/:id` | Yes | Get RBAC role details |
| `PATCH` | `/v1/admin/roles/:id` | Yes | Update RBAC role permissions |
| `GET` | `/v1/admin/permissions` | Yes | List available platform permission scopes |
| `POST` | `/v1/admin/permissions` | Yes | Register new platform permission scope |
| `GET` | `/v1/admin/staff` | Yes | List school staff accounts |
| `POST` | `/v1/admin/staff` | Yes | Create school staff account |
| `GET` | `/v1/admin/staff/:userId` | Yes | Get staff account details |
| `PATCH` | `/v1/admin/staff/:userId` | Yes | Update staff profile or role assignment |
| `POST` | `/v1/admin/staff/:userId/reset-password`| Yes| Send staff password reset request |
| `GET` | `/v1/admin/staff/:userId/effective-permissions`| Yes| Query resolved permissions for staff user |
| `GET` | `/v1/admin/academic-periods` | Yes | List academic periods |
| `POST` | `/v1/admin/academic-periods` | Yes | Create academic period |
| `PUT` | `/v1/admin/academic-periods/:id`| Yes | Update academic period dates or name |
| `POST` | `/v1/admin/academic-periods/:id/set-active`| Yes| Set academic period as active |
| `GET` | `/v1/admin/classes` | Yes | List classes |
| `POST` | `/v1/admin/classes` | Yes | Create class entity |
| `PUT` | `/v1/admin/classes/:id` | Yes | Update class entity |
| `GET` | `/v1/admin/enrollments` | Yes | List class enrollments |
| `POST` | `/v1/admin/enrollments` | Yes | Enroll student in class |
| `POST` | `/v1/admin/enrollments/transfer`| Yes | Transfer student between classes |
| `POST` | `/v1/admin/enrollments/promote` | Yes | Promote student to next class |
| `POST` | `/v1/admin/enrollments/exit` | Yes | Record student graduation or exit |
| `GET` | `/v1/admin/schedules` | Yes | List attendance schedules |
| `POST` | `/v1/admin/schedules` | Yes | Create attendance schedule |
| `GET` | `/v1/admin/schedules/:id` | Yes | Get attendance schedule details |
| `PUT` | `/v1/admin/schedules/:id` | Yes | Update attendance schedule |
| `DELETE`| `/v1/admin/schedules/:id` | Yes | Delete attendance schedule |
| `GET` | `/v1/admin/locations` | Yes | List geofenced school locations |
| `POST` | `/v1/admin/locations` | Yes | Create geofenced school location |
| `GET` | `/v1/admin/locations/:id` | Yes | Get location details |
| `PUT` | `/v1/admin/locations/:id` | Yes | Update location coordinates or radius |
| `DELETE`| `/v1/admin/locations/:id` | Yes | Delete location entity |
| `GET` | `/v1/admin/calendar-exceptions` | Yes | List calendar holidays and exceptions |
| `POST` | `/v1/admin/calendar-exceptions` | Yes | Create calendar exception |
| `GET` | `/v1/admin/calendar-exceptions/:id`| Yes| Get calendar exception details |
| `PUT` | `/v1/admin/calendar-exceptions/:id`| Yes| Update calendar exception |
| `DELETE`| `/v1/admin/calendar-exceptions/:id`| Yes| Delete calendar exception |
| `POST` | `/v1/admin/attendance/manual` | Yes | Record manual attendance with audit trail |
| `GET` | `/v1/admin/attendance` | Yes | Query attendance list with pagination |
| `GET` | `/v1/admin/attendance/:id` | Yes | Get single attendance record |
| `DELETE`| `/v1/admin/attendance/:id` | Yes | Delete single attendance record |
| `DELETE`| `/v1/admin/attendance/bulk` | Yes | Bulk delete attendance records |
| `GET` | `/v1/admin/attendance/export` | Yes | Export bounded collection of attendance records (up to 50,000 rows) |
| `GET` | `/v1/admin/attendance/attempts` | Yes | Query raw biometric attendance verification attempts |
| `GET` | `/v1/admin/attendance/attempts/:id`| Yes| Get single attendance attempt record |
| `GET` | `/v1/admin/leave-requests` | Yes | List student leave requests (alias `/v1/admin/permits`) |
| `POST` | `/v1/admin/leave-requests` | Yes | Create administrator leave request on behalf of student |
| `GET` | `/v1/admin/leave-requests/:id` | Yes | Get leave request details |
| `GET` | `/v1/admin/leave-requests/:id/history`| Yes| Query decision audit history for leave request |
| `PATCH` | `/v1/admin/leave-requests/:id` | Yes | Update leave request approval status |
| `POST` | `/v1/admin/leave-requests/:id/approve`| Yes| Approve leave request with authorized duration days |
| `POST` | `/v1/admin/leave-requests/:id/force-finish`| Yes| Force-finish ongoing leave with effective end date |
| `POST` | `/v1/admin/leave-requests/:id/reject`| Yes | Reject leave request with required explanation |
| `POST` | `/v1/admin/leave-requests/:id/reopen`| Yes | Reopen previously decided leave request |
| `DELETE`| `/v1/admin/leave-requests/:id` | Yes | Delete leave request record |
| `GET` | `/v1/admin/notifications` | Yes | List notification outbox entries |
| `GET` | `/v1/admin/notifications/:id` | Yes | Get notification outbox entry details |
| `POST` | `/v1/admin/notifications` | Yes | Enqueue notification into outbox |
| `POST` | `/v1/admin/notifications/:id/retry`| Yes| Schedule immediate retry for failed notification |
| `DELETE`| `/v1/admin/notifications/:id` | Yes | Delete notification outbox entry |
| `GET` | `/v1/admin/adiwiyata/reports` | Yes | List student Adiwiyata reports with class/date filtering |
| `POST` | `/v1/admin/adiwiyata/reports/:id/verify`| Yes| Mark student Adiwiyata photo report as verified |
| `POST` | `/v1/admin/adiwiyata/reports/:id/unverify`| Yes| Revert verified status of Adiwiyata report |
| `GET` | `/v1/admin/adiwiyata/eligibility`| Yes| Search student Adiwiyata eligibility |
| `POST` | `/v1/admin/adiwiyata/eligibility`| Yes| Grant Adiwiyata access to student |
| `DELETE`| `/v1/admin/adiwiyata/eligibility/:id`| Yes| Revoke Adiwiyata access from student |
| `GET` | `/v1/admin/adiwiyata/sites` | Yes | List configured Adiwiyata garden/pond sites |
| `POST` | `/v1/admin/adiwiyata/sites` | Yes | Create Adiwiyata site |
| `PATCH` | `/v1/admin/adiwiyata/sites/:id`| Yes | Update Adiwiyata site details or sort order |
| `DELETE`| `/v1/admin/adiwiyata/sites/:id`| Yes | Deactivate Adiwiyata site |
| `POST` | `/v1/admin/backups` | Yes | Record database backup metadata |
| `GET` | `/v1/admin/backups/status` | Yes | Query monthly backup status and completeness |

---

## Health Semantics

- `/live`: Process is running and accepting HTTP connections; no downstream checks. Never touches PostgreSQL, Robin, Redis, or S3 object storage.
- `/ready`: Aggregates side-effect-free read checks for PostgreSQL (`database`), S3 (`objectStorage`), OIDC/Logto (`identity`), Robin ML (`mlService`), and Redis (`redis`). Returns `503 Service Unavailable` if any required dependency fails or if aggregate check time exceeds `READINESS_DEADLINE_MS` (default `5000ms`).
- `/v1/mobile/health`: Mobile-safe health status (`status: "healthy"` or `status: "unhealthy"`). Always returns HTTP `200` with the standard success envelope; mobile clients treat `data.status` as authoritative without exposing internal infrastructure details.

---

## Environment Variables

All configuration is parsed and validated at boot via `src/config/env.ts`.

### Core & Tenant

| Variable | Default / Required | Description |
|---|---|---|
| `NODE_ENV` | `development` | Runtime environment (`development`, `production`, `test`). |
| `PORT` | `3000` | HTTP server port. |
| `LOG_LEVEL` | `info` | Pino log level (`fatal`, `error`, `warn`, `info`, `debug`, `trace`). |
| `SERVICE_NAME` | `skanida-bff` | Service identifier for structured logs. |
| `TENANT_KEY` | **Required** | Deployment tenant slug identifier. |
| `TENANT_NAME` | **Required** | Display name of the school tenant. |
| `BUSINESS_TIMEZONE` | `Asia/Jakarta` | Timezone for canonical time and schedule calculations. |
| `CORS_ALLOWED_ORIGINS` | `""` | Comma-separated allowed origins (required in production; wildcards disallowed). |

### PostgreSQL Database

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/astra` | PostgreSQL connection string (direct or via CNPG pooler). |
| `DATABASE_MAX_CONNECTIONS` | `10` | Maximum connection pool size. |
| `DATABASE_IDLE_TIMEOUT_SECONDS` | `30` | Idle connection timeout in seconds. |
| `DATABASE_CONNECT_TIMEOUT_SECONDS`| `5` | Connection establishment timeout in seconds. |
| `DB_QUERY_TIMEOUT_MS` | `5000` | Database query timeout in milliseconds. |

### S3-Compatible Object Storage (Garage / MinIO)

| Variable | Default | Description |
|---|---|---|
| `S3_ENDPOINT` | `http://localhost:9000` | S3-compatible API endpoint. |
| `S3_REGION` | `us-east-1` | S3 region (e.g. `garage`). |
| `S3_ACCESS_KEY_ID` | `minioadmin` | S3 access key ID. |
| `S3_SECRET_ACCESS_KEY` | `minioadmin` | S3 secret access key. |
| `S3_BUCKET_AVATARS` | `avatars` | Bucket name for profile avatars. |
| `S3_BUCKET_PERMITS` | `perizinan` | Bucket name for permit attachment files. |
| `S3_BUCKET_ADIWIYATA` | `adiwiyata` | Bucket name for Adiwiyata camera report photos. |
| `S3_FORCE_PATH_STYLE` | `true` | Use path-style bucket addressing. |
| `S3_PUBLIC_URL` | _(Optional)_ | External base URL for presigned public asset access (e.g., storage ingress). |
| `STORAGE_UPLOAD_TIMEOUT_MS` | `15000` | Storage upload timeout in milliseconds. |

### OIDC / Logto Authentication

| Variable | Default / Required | Description |
|---|---|---|
| `OIDC_JWT_SECRET` | _(Required if no JWKS)_ | Secret key for symmetric HS256 JWT verification. |
| `OIDC_JWKS_URL` | _(Required if no Secret)_ | In-cluster JWKS URL for asymmetric JWT verification. |
| `OIDC_ISSUER` | **Required in production** | Expected token issuer claim matching external auth domain. |
| `OIDC_AUDIENCE` | `authenticated` | Expected token audience / API resource indicator. |
| `LOGTO_ENDPOINT` | _(Optional)_ | Logto Management API endpoint URL. |
| `LOGTO_APP_ID` | _(Optional)_ | Logto Management API M2M App ID. |
| `LOGTO_APP_SECRET` | _(Optional)_ | Logto Management API M2M App Secret. |
| `AUTH_USER_ID` | _(Optional)_ | Default user ID for the `bun run auth:token` helper. |
| `AUTH_EMAIL` | _(Optional)_ | Default user email for the `bun run auth:token` helper. |

### Legacy Supabase Transition Bridge (Optional)

| Variable | Default / Required | Description |
|---|---|---|
| `LEGACY_SUPABASE_JWT_SECRET` | _(Optional)_ | Secret key for legacy JWT verification. |
| `LEGACY_SUPABASE_JWT_ISSUER` | _(Optional)_ | Expected legacy issuer. |
| `LEGACY_SUPABASE_JWT_AUDIENCE` | `authenticated` | Expected legacy audience. |
| `LEGACY_AUTH_BRIDGE_EXPIRES_AT` | _(Optional)_ | ISO timestamp after which legacy tokens are rejected. |

### Robin (Face Recognition API)

| Variable | Default / Required | Description |
|---|---|---|
| `ROBIN_BASE_URL` | **Required** | Base URL for internal Robin service (`http://robin.skanida-core...`). |
| `ROBIN_SERVICE_TOKEN` | `dev-robin-service-token` | Internal authentication token (must be rotated in production). |
| `ROBIN_READY_TIMEOUT_MS` | `3000` | Health probe timeout in milliseconds. |
| `ROBIN_IDENTIFY_TIMEOUT_MS` | `30000` | Biometric identification timeout in milliseconds. |
| `ROBIN_ENROLL_TIMEOUT_MS` | `60000` | Biometric enrollment timeout in milliseconds. |
| `ROBIN_ENROLL_STATUS_TIMEOUT_MS` | `5000` | Biometric enrollment status timeout in milliseconds. |

### Redis Rate Limiting & Cache

| Variable | Default / Required | Description |
|---|---|---|
| `REDIS_URL` | _(Required in production)_ | Redis connection URL (`redis://...`). |
| `REDIS_KEY_PREFIX` | `astra:ratelimit` | Key prefix for rate limiting counters and signed URL cache. |

### Downstream Timeouts & Deadlines

| Variable | Default | Downstream Target |
|---|---|---|
| `DB_QUERY_TIMEOUT_MS` | `5000` | PostgreSQL query execution |
| `STORAGE_UPLOAD_TIMEOUT_MS` | `15000` | S3 object storage upload operations |
| `READINESS_DEADLINE_MS` | `5000` | Aggregate `/ready` dependency deadline |
| `ROBIN_READY_TIMEOUT_MS` | `3000` | Robin `/ready` health probe |
| `ROBIN_IDENTIFY_TIMEOUT_MS` | `30000` | Robin `/v1/face/identify` endpoint |
| `ROBIN_ENROLL_TIMEOUT_MS` | `60000` | Robin `/v1/face/enroll` endpoint |
| `ROBIN_ENROLL_STATUS_TIMEOUT_MS` | `5000` | Robin `/v1/face/enroll/status` endpoint |

---

## Development & Quality Gates

### Local Commands

```bash
# Typecheck TypeScript sources
bun run typecheck

# Lint codebase with Oxlint
bun run lint

# Check code formatting with Oxfmt
bun run format:check

# Run unit tests
bun run test

# Run integration tests
bun run test:integration

# Run database schema migrations
bun run db:migrate

# Start background notification outbox worker
bun run worker:notifications

# Run staging smoke tests against deployed cluster
bun run smoke:staging
```
