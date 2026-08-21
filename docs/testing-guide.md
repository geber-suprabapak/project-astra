# Testing Guide

## Purpose

Use this guide to verify the Astra BFF locally and to prepare OIDC JWT authentication for Postman and integration checks against staging or production.

## Local Checks

Run the standard gates with Bun:

```bash
bun run typecheck
bun run lint
bun run test -- --pool=forks --maxWorkers=1
bun run test:integration -- --pool=forks --maxWorkers=1
```

Start the app while testing API calls:

```bash
bun run dev
```

## Get an OIDC JWT Token

Use the helper script to sign an OIDC JWT access token for testing:

```bash
bun run auth:token
```

Optional JSON output:

```bash
bun run auth:token -- --json
```

Generate a token for a specific user and role:

```bash
bun run auth:token -- --user-id student-123 --role student --email student@sekolah.sch.id
```

For privileged-session checks, generate a fully protected administrator token:

```bash
bun run auth:token -- \
  --user-id platform-admin-1 \
  --role platform_admin \
  --mfa true \
  --must-change-password false \
  --json
```

The Astra admin boundary requires the token `roles` claim to match the approved
profile role, `scope` to include `admin:read`, `mfa_verified` to be true, and
`must_change_password` to be false.

## Postman Setup

Set the request header:

```text
Authorization: Bearer <access_token>
```

Store the token in a Postman environment variable, for example `jwt_token`, and reference it as `{{jwt_token}}`. Refresh it when it expires; the helper script can be rerun any time.

## Architecture & Test Seams

- **Primary test seam**: The versioned `/v1/mobile/*` and `/v1/admin/*` HTTP APIs with injectable `AppProviders` (`DomainStore`, `ObjectStorage`, `IdentityProvider`).
- **Bootstrap & Roster flow**: `/v1/admin/bootstrap/*` endpoints for single School configuration, initial `school_admin` profile setup, staged roster validation, report acceptance, and Student signup gating.
- **Domain persistence**: Backed by PostgreSQL through `PostgresDomainStore` in production, or `MemoryDomainStore` in isolated contract tests.
- **Object storage**: S3-compatible storage through `S3ObjectStorage` in production, or `MemoryObjectStorage` in isolated contract tests.
- **Identity provider**: OIDC/Logto through `OidcIdentityProvider` in production, or `MemoryIdentityProvider` in isolated contract tests.
- **Health monitoring**: `/live` (liveness) and `/ready` (dependency checks for database, objectStorage, mlService, redis) without leaking provider internals to mobile clients.
