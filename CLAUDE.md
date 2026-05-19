# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Project Astra is the Skanida Mobile BFF — a Hono service that sits between the mobile app and Supabase + Robin (face recognition). It owns auth, tenant context, response envelope, error taxonomy, and orchestration for `/v1/mobile/*`.

## Toolchain

**Bun only.** The repo declares `packageManager: bun@1.3.13` and commits `bun.lock`. Do not reintroduce `npm` or `pnpm` commands or lockfiles.

```bash
bun install
bun run dev               # watch mode, src/index.ts
bun run build             # tsc -> dist/
bun run start             # bun dist/index.js
bun run typecheck         # tsc --noEmit
bun run lint              # eslint src tests
bun run test              # vitest run tests/unit
bun run test:integration  # vitest run tests/integration
bun run auth:token        # interactive helper, prints a Supabase JWT for curl tests
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

`src/index.ts` (node-server entrypoint) → `src/app.ts` (Hono bootstrap) → `src/routes/v1-mobile.ts` (mounts each module router under `/v1/mobile`) → `src/modules/<feature>/routes.ts`.

`src/app.ts` is the only place global middleware lives: `requestId` → `cors` → request-logging → routes → `errorHandler` (via `app.onError`). Public probes (`/live`, `/ready`) are mounted at the root from `modules/health`. `/v1/mobile/health` is the mobile-safe health route mounted as the *first* sub-route under `/v1/mobile` so it stays public; everything else under `/v1/mobile` requires auth (applied per-module, not globally — this is intentional, do not move it to `routes/v1-mobile.ts`).

### Module pattern

Every feature under `src/modules/<feature>/` uses the same shape:

- `routes.ts` — Hono sub-router; applies `auth` and the matching `rateLimits.<preset>` as `use('*', …)` at the top, then defines handlers
- `service.ts` — business logic, calls `clients/supabase` and `clients/robin`
- `schema.ts` — Zod request/response schemas and shared shape constants

Handlers should be thin: parse + validate input, call the service, return via `successResponse(c, data, message?)` from `src/lib/http/responses.ts`. Never hand-roll the envelope.

### Errors

All thrown errors should be `AppError` (see `src/lib/errors/app-error.ts`) constructed via the static factories (`AppError.authRequired()`, `AppError.attendanceBlocked()`, …). The 13 stable codes live in `src/lib/errors/codes.ts` and are part of the mobile contract — adding a new code requires a plan/contract update, not just a code change. `errorHandler` middleware turns `AppError` into the standard error envelope; any other thrown error becomes `INTERNAL_ERROR` (500).

### Auth + tenant context

`src/middleware/auth.ts` verifies the Supabase JWT using `jose`. It accepts either a shared secret (`SUPABASE_JWT_SECRET`) or a JWKS URL (`SUPABASE_JWKS_URL`) — env validation in `src/config/env.ts` enforces that exactly one is provided. The `iss` claim is **optional** (some self-hosted GoTrue tokens omit it); only set `SUPABASE_JWT_ISSUER` if your tokens actually carry one. On success the middleware sets `userId`, `rawToken`, and `tenantKey` on the Hono context (`AppEnv` in `src/types/context.ts`). Downstream handlers and services rely on these — read them via `c.get(...)`, do not re-decode the token.

`tenantKey` is process-local (one deployment = one school) and comes from env, not the JWT.

### Rate limiting

`src/middleware/rate-limit.ts` exports a `RateLimitStore` interface and a `MemoryRateLimitStore` default. **In-memory means limits reset on restart and are per-replica** — before scaling beyond a single replica, swap in a shared store (Redis) by passing it to `rateLimit({ store })`. Limits are keyed by `${tenantKey}:${userId}:${routeKey}`, so anonymous routes are not limited (the middleware no-ops when `userId` is missing). Use the named presets in `rateLimits` rather than constructing limits inline; the numbers there are the contract from `plan/plan.md` §6.5.

### Config

`src/config/env.ts` parses `process.env` through Zod at import time and `process.exit(1)`s on failure. All env access in the rest of the codebase goes through the typed `env` object exported from this file — never read `process.env` directly elsewhere. Adding a new env var means: add it to the Zod schema, add it to the exported `env` object, add it to `.env.example`, and document it in `README.md`.

## Conventions

- TypeScript ESM. 2-space indent. Lowercase filenames and route folders.
- Imports between local files use the `.js` extension (NodeNext resolution requires it even when the source is `.ts`).
- ESLint enforces `@typescript-eslint/no-floating-promises` and `consistent-type-imports`. Use `import type { … }` for type-only imports.
- Keep request/response Zod schemas in each module's `schema.ts`. Don't scatter them.
- The `.serena/` directory is committed working state for the Serena tooling — treat it like normal source, not scratch. AGENTS.md spells this out.
- Conventional Commits: `feat(bff): …`, `fix(auth): …`, `chore(serena): …`.

## Docker

`Dockerfile` is a two-stage Bun 1.3.13 alpine build (`bun run build` → `bun dist/index.js`). The container exposes 3000 and healthchecks via `/live`. `docker-compose.yml` pulls `ghcr.io/geber-suprabapak/project-astra:latest` by default; override with `ASTRA_IMAGE` to pin a tag/SHA.
