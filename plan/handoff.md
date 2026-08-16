# Implementation Handoff — Skanida Mobile BFF

## State of Implementation

The BFF service is **partially implemented**. Phase 0 (bootstrap) and most of Phase 1 (foundation) are in place. Phases 2–4 have route scaffolding and some service logic, but critical response shapes, middleware features, and tests are incomplete.

**What works:**

- Hono app bootstrap with CORS, request ID, structured logging, error envelope, rate limiting
- Auth middleware with jose JWT verification (bearer token extraction, user ID on context)
- Robin client with readiness, identify, enrollment status, enrollment upload
- Supabase admin client with profile, absence, schedule, permit queries and attendance RPC
- Supabase storage client for avatar and permit uploads/signed URLs
- All route registrations under `/v1/mobile`
- Dockerfile and docker-compose for local development
- CI baseline (typecheck, lint, unit tests)

**What needs work:**

- Dashboard response shape is fundamentally different from the plan
- Attendance precheck missing `checks` object and enrollment gate
- Permits GET response missing `items` wrapper and `rejected_at` field
- Health mobile endpoint field name mismatch
- Tenant validation missing from auth middleware
- Three env vars missing from config (Supabase query timeout, storage timeout, Robin enroll status timeout)
- Rate limit for enrollment upload uses per-minute window, not per-10-minute window
- Integration test directory is empty
- CI does not run integration tests
- Dashboard module missing `schema.ts`

---

## Architecture Quick Reference

```
src/
  app.ts                    # Hono app setup, middleware chain
  index.ts                  # serve() entry point
  config/
    env.ts                  # Zod-validated env config
    tenant.ts               # TenantContext from env
  middleware/
    auth.ts                 # JWT verification (jose)
    request-id.ts           # X-Request-ID
    error-handler.ts        # Error envelope
    rate-limit.ts           # Per-user sliding window
    timeout.ts              # AbortController timeout factory
  clients/
    robin/
      client.ts             # Robin HTTP client (identify, enroll, readiness)
      schemas.ts            # Zod schemas for Robin responses
    supabase/
      auth.ts               # Password verify + admin update
      admin.ts              # Service-role queries (profiles, absences, schedules, permits)
      storage.ts            # Avatar + permit storage operations
  modules/
    attendance/              # Precheck + submit
      routes.ts, service.ts, schema.ts, mapper.ts
    dashboard/               # Dashboard aggregation
      routes.ts, service.ts  (MISSING schema.ts)
    enrollment/              # Status + upload
      routes.ts, service.ts, schema.ts
    permits/                 # List + create
      routes.ts, service.ts, schema.ts
    profile/                # Read, avatar, password
      routes.ts, service.ts, schema.ts
    time/                    # Server time
      routes.ts, service.ts
    health/                  # Liveness, readiness, mobile health
      routes.ts, service.ts
  lib/
    errors/
      codes.ts              # 13 error constants
      app-error.ts           # AppError class with factory methods
    http/
      envelope.ts            # Zod envelope schemas
      responses.ts           # successResponse / errorResponse helpers
    logging/
      logger.ts              # Pino logger with redaction
  routes/
    v1-mobile.ts             # Route registration
  types/
    context.ts               # Hono context variables
```

---

## Key Dependencies

| Package               | Version | Purpose                     |
| --------------------- | ------- | --------------------------- |
| hono                  | ^4.12   | Web framework               |
| @hono/node-server     | ^1.13   | Node.js adapter             |
| zod                   | ^3.25   | Request/response validation |
| jose                  | ^5.10   | JWT verification            |
| @supabase/supabase-js | ^2.104  | Supabase client             |
| pino                  | ^9.14   | Structured logging          |
| vitest                | ^3.2    | Test runner                 |

---

## Commands

```bash
bun install           # Install dependencies
bun run dev           # Start dev server with Bun watch mode
bun run build         # TypeScript compile
bun run start         # Start production server
bun run typecheck     # Type check only
bun run lint          # ESLint + Prettier check
bun run test          # Unit tests
bun run test:integration  # Integration tests
```

---

## Critical Decisions Made

1. **Package management**: `bun` is the canonical package manager and lockfile format for local development, Docker, and CI.
2. **JWT verification**: Both `SUPABASE_JWT_SECRET` (symmetric) and `SUPABASE_JWKS_URL` (asymmetric) are supported, with a refinement enforcing exactly one. Plan only lists `SUPABASE_JWKS_URL` as optional.
3. **Error envelope**: `successResponse()` and `errorResponse()` are implemented and used across all routes.
4. **Rate limiting**: In-memory sliding window. No Redis adapter for v1.
5. **Tenant resolution**: Deployment-local via env vars. No middleware enforcement of tenant-from-token.

---

## How to Pick Up Work

1. Start with the **dashboard** response shape — it has the most deviations and is the most complex module.
2. Fix **attendance precheck** to add the `checks` object and enrollment gate.
3. Fix **permits GET** to add `items` wrapper and `rejected_at` field.
4. Fix **health mobile** to use `status` instead of `operational`.
5. Add **tenant validation** to auth middleware.
6. Add missing **env vars** and **timeout presets**.
7. Write **unit tests** for auth, tenant, validation, normalization, and business rules.
8. Write **integration tests** for Robin client, Supabase client, and endpoints.
9. Add **integration test step** to CI.
