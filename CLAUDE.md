# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Project Astra is the Skanida Platform Backend and Mobile BFF — a Hono service that coordinates domain workflows between clients (Mobile and Chronos) and platform components (PostgreSQL, S3, OIDC/Logto, Robin). It owns auth, tenant context, response envelope, error taxonomy, and orchestration for `/v1/mobile/*`.

## Toolchain

**Bun only.** The repo declares `packageManager: bun@1.3.13` and commits `bun.lock`. Do not reintroduce `npm` or `pnpm` commands or lockfiles.

```bash
bun install
bun run dev               # watch mode, src/index.ts
bun run build             # tsc -> dist/
bun run start             # bun dist/index.js
bun run typecheck         # tsc --noEmit
bun run lint              # oxlint
bun run format            # format files with oxfmt
bun run format:check      # check formatting with oxfmt
bun run test              # vitest run tests/unit
bun run test:integration  # vitest run tests/integration
bun run auth:token        # interactive helper, signs an OIDC access token for curl tests
```

On Windows, vitest needs forks + a single worker:

```bash
bun run test -- --pool=forks --maxWorkers=1
bun run test:integration -- --pool=forks --maxWorkers=1
```

Run a single test file: `bun run test -- tests/unit/dashboard-service.test.ts`. Filter by name: `bun run test -- -t "primary action"`.

The local pre-merge gate is `typecheck`, `lint`, `test`, `test:integration` — all four. CI runs the same jobs (`.github/workflows/ci.yml`).

## Architecture

### Request flow

`src/index.ts` (node-server entrypoint) → `src/app.ts` (Hono bootstrap, provider DI) → `src/routes/v1-mobile.ts` (mounts each module router under `/v1/mobile`) → `src/modules/<feature>/routes.ts`.

`src/app.ts` is the place global middleware lives: `requestId` → provider attachment → `cors` → request-logging → routes → `errorHandler` (via `app.onError`). Public probes (`/live`, `/ready`) are mounted at the root from `modules/health`. `/v1/mobile/health` is the mobile-safe health route mounted as the _first_ sub-route under `/v1/mobile` so it stays public; everything else under `/v1/mobile` requires auth (applied per-module, not globally — this is intentional, do not move it to `routes/v1-mobile.ts`).

### Provider Seams

`src/providers/` houses provider interfaces and implementations:

- `DomainStore` (`PostgresDomainStore`, `MemoryDomainStore`): PostgreSQL domain queries and mutations
- `ObjectStorage` (`S3ObjectStorage`, `MemoryObjectStorage`): S3-compatible file storage (avatars, permits)
- `IdentityProvider` (`OidcIdentityProvider`, `MemoryIdentityProvider`): OIDC/Logto JWT validation and password updates
- `AppProviders`: aggregation interface injected into `createApp({ providers })` for testing

### Module pattern

Every feature under `src/modules/<feature>/` uses the same shape:

- `routes.ts` — Hono sub-router; applies `auth` and the matching `rateLimits.<preset>` as `use('*', …)` at the top, then defines handlers
- `service.ts` — business logic, consumes `AppProviders`
- `schema.ts` — Zod request/response schemas and shared shape constants

Handlers should be thin: parse + validate input, call the service, return via `successResponse(c, data, message?)` from `src/lib/http/responses.ts`. Never hand-roll the envelope.

### Errors

All thrown errors should be `AppError` (see `src/lib/errors/app-error.ts`) constructed via the static factories (`AppError.authRequired()`, `AppError.attendanceBlocked()`, …). The 13 stable codes live in `src/lib/errors/codes.ts` and are part of the mobile contract — adding a new code requires a contract update. `errorHandler` middleware turns `AppError` into the standard error envelope; any other thrown error becomes `INTERNAL_ERROR` (500).

### Auth + tenant context

`src/middleware/auth.ts` verifies the OIDC JWT using `IdentityProvider`. It accepts either a shared secret (`OIDC_JWT_SECRET`) or a JWKS URL (`OIDC_JWKS_URL`). On success the middleware sets `userId`, `rawToken`, and `tenantKey` on the Hono context (`AppEnv` in `src/types/context.ts`). Downstream handlers and services rely on these — read them via `c.get(...)`, do not re-decode the token.

`tenantKey` is process-local (one deployment = one school) and comes from env, not the JWT.

### Rate limiting

`src/middleware/rate-limit.ts` exports a `RateLimitStore` interface, `MemoryRateLimitStore` default, and Redis backend when `REDIS_URL` is set.

### Config

`src/config/env.ts` parses `process.env` through Zod at import time and `process.exit(1)`s on failure. All env access in the rest of the codebase goes through the typed `env` object exported from this file — never read `process.env` directly elsewhere. Adding a new env var means: add it to the Zod schema, add it to the exported `env` object, add it to `.env.example`, and document it in `README.md`.

## Conventions

- TypeScript ESM. 2-space indent. Lowercase filenames and route folders.
- Imports between local files use the `.js` extension.
- Oxlint runs anti-slop rules. Prefer parsing external values at their boundary, owner contracts over open dictionaries, and explicit `SAFETY:` invariants for unavoidable type assertions.
- Keep request/response Zod schemas in each module's `schema.ts`. Don't scatter them.
- The `.serena/` directory is committed working state for the Serena tooling — treat it like normal source, not scratch. AGENTS.md spells this out.
- Conventional Commits: `feat(bff): …`, `fix(auth): …`, `chore(serena): …`.

## Docker

`Dockerfile` is a two-stage Bun alpine build (`bun run build` → `bun dist/index.js`). The container exposes 3000 and healthchecks via `/ready`.
