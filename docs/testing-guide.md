# Testing Guide

## Purpose

Use this guide to verify the Astra BFF locally and to prepare OIDC JWT authentication for Postman and integration checks against staging or production.

## Local Checks

Run the standard gates with Bun:

```bash
bun run typecheck
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

## Postman Setup

Set the request header:

```text
Authorization: Bearer <access_token>
```

Store the token in a Postman environment variable, for example `jwt_token`, and reference it as `{{jwt_token}}`. Refresh it when it expires; the helper script can be rerun any time.

## Architecture & Test Seams

- **Primary test seam**: The versioned `/v1/mobile/*` HTTP API with injectable `AppProviders` (`DomainStore`, `ObjectStorage`, `IdentityProvider`).
- **Domain persistence**: Backed by PostgreSQL through `PostgresDomainStore` in production, or `MemoryDomainStore` in isolated contract tests.
- **Object storage**: S3-compatible storage through `S3ObjectStorage` in production, or `MemoryObjectStorage` in isolated contract tests.
- **Identity provider**: OIDC/Logto through `OidcIdentityProvider` in production, or `MemoryIdentityProvider` in isolated contract tests.
- **Health monitoring**: `/live` (liveness) and `/ready` (dependency checks for database, objectStorage, mlService, redis) without leaking provider internals to mobile clients.
