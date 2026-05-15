# Skanida Mobile BFF — Post-Implementation Note

## What This Project Does

Skanida Mobile BFF (Backend for Frontend) is a Node.js service that sits between the Skanida mobile app and its backend dependencies (Supabase and Robin). It orchestrates all mobile-facing business logic for a school attendance and face-recognition system used across Indonesian schools.

The BFF replaces the mobile app's direct calls to Supabase tables, RPCs, and Robin endpoints with a single, stable API surface. The mobile app now calls the BFF exclusively for all business flows.

## Purpose

- **Single API contract**: The mobile app talks to one service, not three (Supabase, Robin, storage).
- **Tenant isolation**: Each school gets its own BFF deployment with deployment-local tenant config. No cross-tenant data leakage.
- **Business logic ownership**: All attendance gating, enrollment checks, permit validation, and dashboard aggregation logic lives in the BFF — not in mobile code or Supabase RPCs.
- **Security boundary**: The mobile app's Supabase bearer token is verified in the BFF. The BFF then uses service-role credentials for all data operations. Robin internal details never leak to the mobile response.
- **Stable response shapes**: The mobile response contract is versioned under `/v1/mobile/` and normalized. Internal column names, Robin status codes, and storage paths never appear in responses.

## Architecture

```
Mobile App → BFF (/v1/mobile/*) → Supabase (Auth, DB, Storage)
                                  → Robin (ML pipeline: identify, enroll, readiness)
```

## API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/v1/mobile/dashboard` | Required | Dashboard aggregation with gating |
| `POST` | `/v1/mobile/attendance/precheck` | Required | Attendance gate check before camera |
| `POST` | `/v1/mobile/attendance/submit` | Required | Submit attendance with face recognition |
| `GET` | `/v1/mobile/face/enrollment/status` | Required | Face enrollment status |
| `POST` | `/v1/mobile/face/enrollment` | Required | Upload 10 face photos for enrollment |
| `GET` | `/v1/mobile/permits` | Required | List user permits |
| `POST` | `/v1/mobile/permits` | Required | Create a permit request |
| `GET` | `/v1/mobile/profile` | Required | Read user profile |
| `PATCH` | `/v1/mobile/profile/avatar` | Required | Upload or clear avatar |
| `PATCH` | `/v1/mobile/profile/password` | Required | Change password |
| `GET` | `/v1/mobile/time` | Required | Canonical server time |
| `GET` | `/v1/mobile/health` | None | Mobile-safe health signal |
| `GET` | `/live` | None | Process liveness |
| `GET` | `/ready` | None | Dependency readiness |

## How to Run

### Prerequisites
- Node.js 22+
- Bun

### Local Development
```bash
bun install
cp .env.example .env
# Fill in your Supabase and Robin environment variables
bun run dev
```

### Docker
```bash
docker compose up --build
```

### Available Scripts
| Script | Purpose |
|--------|---------|
| `bun run dev` | Start dev server with hot reload |
| `bun run build` | TypeScript compile |
| `bun run start` | Start production server |
| `bun run typecheck` | Type check |
| `bun run lint` | ESLint + Prettier check |
| `bun run test` | Unit tests |
| `bun run test:integration` | Integration tests |

### Required Environment Variables
See `.env.example` for the full list. Key variables:
- `TENANT_KEY` / `TENANT_NAME` — school identifier
- `BUSINESS_TIMEZONE` — defaults to `Asia/Jakarta`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` — Supabase connection
- `ROBIN_BASE_URL` — Robin service URL (internal)
- Timeout overrides: `ROBIN_READY_TIMEOUT_MS`, `SUPABASE_QUERY_TIMEOUT_MS`, etc.

## Error Handling

All errors use a consistent envelope:
```json
{
  "success": false,
  "error": { "code": "ERROR_CODE", "message": "Description" },
  "meta": { "request_id": "uuid", "timestamp": "..." }
}
```

Standard error codes: `AUTH_REQUIRED`, `AUTH_INVALID`, `FORBIDDEN`, `VALIDATION_ERROR`, `TENANT_MISMATCH`, `ATTENDANCE_BLOCKED`, `ENROLLMENT_REQUIRED`, `DEPENDENCY_UNAVAILABLE`, `UPSTREAM_TIMEOUT`, `STORAGE_UPLOAD_FAILED`, `RESOURCE_NOT_FOUND`, `CONFLICT`, `INTERNAL_ERROR`.

## Rate Limits

Per-authenticated-user rate limiting is applied to all business endpoints. See `src/middleware/rate-limit.ts` for exact limits per route.

## Testing

- **64 unit tests** covering: error codes, error factories, rate limit store, auth middleware, attendance mapper, dashboard service, primary action gating, request validation (attendance, enrollment, permits, password), schema constants, env config, time service.
- **Integration test infrastructure** in place; full integration tests require running Supabase and Robin services.

## What Was Implemented (Full Plan Coverage)

- All 12 API endpoints from plan.md §7
- All 13 error codes from plan.md §6.3
- All timeout presets from plan.md §6.4
- Rate limiting with all plan.md §6.5 presets (including per-10-minute for enrollment)
- Dashboard response shape matches plan.md §7.1 (profile, attendance, schedule, face, permit, primary_action, server_time)
- Attendance precheck response includes `checks` object and enrollment gate per plan.md §7.2
- Attendance submit with re-gating per plan.md §7.3
- Enrollment with 10-file JPEG validation per plan.md §7.5
- Permits with `items` wrapper and `rejected_at` per plan.md §7.6-7.7
- Profile with avatar clear/upload and password change per plan.md §7.8-7.10
- Time endpoint per plan.md §7.11
- Health endpoints (liveness, readiness, mobile) per plan.md §9.4
- Auth middleware with JWT verification and tenant context per plan.md §8.2
- Request ID, CORS, structured logging, Docker, and CI baseline per plan.md §5
