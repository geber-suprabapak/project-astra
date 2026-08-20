# Repository Guidelines

## Project Structure & Module Organization

`src/` contains the BFF runtime. `src/app.ts` wires middleware and routes with injectable provider seams, `src/index.ts` starts the server, `src/routes/v1-mobile.ts` mounts the mobile API, and `src/modules/*` holds feature areas such as `dashboard`, `attendance`, `enrollment`, `permits`, `profile`, `time`, and `health`. Pluggable provider seams live in `src/providers/` (`DomainStore` for PostgreSQL, `ObjectStorage` for S3, `IdentityProvider` for OIDC/Logto), shared clients live in `src/clients/`, config in `src/config/`, middleware in `src/middleware/`, and shared HTTP/error helpers in `src/lib/`. Tests live under `tests/unit/` and `tests/integration/`. Planning docs are kept in `plan/`.

## Build, Test, and Development Commands

Use Bun only.

- `bun install` installs dependencies.
- `bun run dev` starts the server in watch mode.
- `bun run build` compiles TypeScript to `dist/`.
- `bun run start` runs the built app.
- `bun run typecheck` checks types without emitting.
- `bun run lint` runs Oxlint, including the anti-slop plugin.
- `bun run test` runs unit tests.
- `bun run test:integration` runs integration tests.

On Windows, the test suite is already validated with:
`bun run test -- --pool=forks --maxWorkers=1`

## Coding Style & Naming Conventions

This project uses TypeScript, ESM, and 2-space indentation. Keep filenames and route folders lowercase with clear domain names, such as `src/modules/dashboard/service.ts`. Prefer explicit exported types for shared shapes, and keep request/response schemas in `schema.ts` beside each module. Use the existing Oxlint and Oxfmt configuration; do not introduce another linter or formatter.

## Testing Guidelines

Vitest is the test runner. Unit tests live in `tests/unit/` and integration smoke tests in `tests/integration/`. Name tests after the module or behavior they cover, for example `dashboard-service.test.ts` or `auth.test.ts`. Add tests for API shapes, validation, error codes, and middleware behavior when changing shared contracts.

## Commit & Pull Request Guidelines

History uses Conventional Commits, for example `feat(bff): complete Bun implementation` and `chore(serena): update project config`. Keep subjects imperative and scoped when useful. Pull requests should include a short description, the commands you ran, and notes for any config or contract changes. Include screenshots only for UI work; this repo is API/service focused.

## Security & Configuration Tips

Do not commit secrets. Copy `.env.example` and set tenant, database, S3, OIDC, and Robin values per deployment. Keep `bun.lock` committed, and avoid reintroducing `npm` or `pnpm` commands into this repo.

## Serena Workspace Notes

The `.serena/` directory is part of the working state for this repository. Commit `.serena` changes when they are not ignored by git, and leave only explicitly ignored files uncommitted. Do not treat `.serena` as disposable scratch space unless the file is already ignored or clearly tooling-generated.
