# Implementation Handoff — Astra Greenfield API Boundary

## State of Implementation

Astra (Skanida Mobile BFF) is implemented against greenfield platform components with zero Supabase runtime dependency.

**Architecture highlights:**
- Hono app bootstrap with CORS, request ID, structured logging, error envelope, rate limiting, and dependency injection
- Auth middleware with standard OIDC JWT verification via `IdentityProvider`
- Robin client for facial biometrics (readiness, identify, enrollment status, enrollment upload)
- `DomainStore` (`PostgresDomainStore` & `MemoryDomainStore`) for greenfield domain persistence (profiles, attendances, schedules, leave requests, locations)
- Greenfield PostgreSQL schema defined in `db/schema.sql` and applied via `scripts/migrate.ts`
- `ObjectStorage` (`S3ObjectStorage` & `MemoryObjectStorage`) for avatar and permit storage operations
- `IdentityProvider` (`OidcIdentityProvider` & `MemoryIdentityProvider`) for token verification, password checks, and user metadata
- Versioned `/v1/mobile` boundary with highest-level HTTP contract coverage in `tests/integration/`
- Portable health probes (`/live`, `/ready`, `/v1/mobile/health`) reporting database, object storage, ML service, and Redis status without leaking provider internals

---

## Architecture Reference

```
src/
  app.ts                    # Hono app setup, provider DI, middleware chain
  index.ts                  # serve() entry point
  config/
    env.ts                  # Zod-validated env config (Postgres, S3, OIDC, Robin, Redis)
    tenant.ts               # TenantContext from env
  middleware/
    auth.ts                 # OIDC JWT verification (jose) using IdentityProvider
    request-id.ts           # X-Request-ID
    error-handler.ts        # Error envelope
    rate-limit.ts           # Per-user sliding window (memory / redis)
    timeout.ts              # AbortController timeout factory
  clients/
    redis.ts                # Redis client
    robin/
      client.ts             # Robin HTTP client (identify, enroll, readiness)
      schemas.ts            # Zod schemas for Robin responses
  providers/
    types.ts                # DomainStore, ObjectStorage, IdentityProvider, AppProviders interfaces
    postgres/
      domain-store.ts       # Postgres.js DomainStore implementation
    storage/
      s3-storage.ts         # S3-compatible ObjectStorage implementation (SigV4)
    identity/
      oidc-identity.ts      # OIDC/Logto IdentityProvider implementation
    memory/
      index.ts              # In-memory test doubles for contract tests
    index.ts                # Default provider factories and exports
  modules/
    attendance/             # Precheck + submit
    dashboard/              # Dashboard aggregation
    enrollment/             # Status + upload
    permits/                # List + create
    profile/                # Read, avatar, password
    time/                   # Server time
    health/                 # Liveness, readiness, mobile health
  lib/
    errors/
      codes.ts              # Error constants
      app-error.ts          # AppError class
    http/
      envelope.ts           # Zod envelope schemas
      responses.ts          # successResponse / errorResponse helpers
      timeouts.ts           # Timeout preset constants
    logging/
      logger.ts             # Pino logger with redaction
  routes/
    v1-mobile.ts            # Route registration with provider injection
  types/
    context.ts              # Hono context variables
```

---

## Key Dependencies

| Package               | Version | Purpose                                |
| --------------------- | ------- | -------------------------------------- |
| hono                  | ^4.12   | Web framework                          |
| @hono/node-server     | ^1.19   | Node.js adapter                        |
| zod                   | ^3.25   | Request/response validation            |
| jose                  | ^5.10   | JWT verification & signing             |
| postgres              | ^3.4    | PostgreSQL client (Postgres.js)        |
| redis                 | ^5.12   | Redis client                           |
| pino                  | ^9.14   | Structured logging                     |
| vitest                | ^3.2    | Test runner                            |
