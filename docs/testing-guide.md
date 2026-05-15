# Testing Guide

## Purpose
Use this guide to verify the BFF locally and to prepare JWT auth for Postman against staging or production.

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

## Get a JWT Token
Use the helper script to log in with Supabase email/password and print the access token.
By default the script prompts for email and password so they do not end up in shell history.

```bash
bun run auth:token
```

Optional JSON output:

```bash
bun run auth:token -- --json
```

You can also rely on environment variables:

```bash
AUTH_EMAIL=user@example.com AUTH_PASSWORD=secret bun run auth:token
```

The script also accepts explicit Supabase overrides:

```bash
bun run auth:token -- --supabase-url https://your-project.supabase.co --anon-key your-anon-key
```

## Postman Setup
Set the request header:

```text
Authorization: Bearer <access_token>
```

Store the token in a Postman environment variable, for example `jwt_token`, and reference it as `{{jwt_token}}`. Refresh it when it expires; the helper script can be rerun any time.

## Notes
- This repository uses Bun only.
- Keep the `.env` values aligned with the target tenant before testing against production.
- For production validation, test the exact `/v1/mobile/*` routes rather than the internal clients directly.
