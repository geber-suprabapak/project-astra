# Unimplemented Changes — Skanida Mobile BFF

_Last updated: 2026-08-20 (Ticket 02 Greenfield Platform Transition)_

This document tracks architecture updates and deviations. Items marked with ~~strikethrough~~ have been resolved.

---

## Resolved (Ticket 02 — Establish Astra Greenfield API Boundary)

~~1. Replace Supabase dependency with greenfield PostgreSQL, S3, and OIDC/Logto seams~~ — Completed. Supabase SDK removed; added `AppProviders`, `DomainStore` (`PostgresDomainStore`), `ObjectStorage` (`S3ObjectStorage`), and `IdentityProvider` (`OidcIdentityProvider`).

~~2. Make `createApp` injectable for testing~~ — Completed. `createApp({ providers, getReadiness })` allows injecting provider test doubles directly for full HTTP contract testing.

~~3. Implement highest-level contract integration tests~~ — Completed in `tests/integration/health.test.ts` and `tests/integration/mobile-contract.test.ts`.

~~4. Portable runtime readiness check~~ — Completed. `/ready` reports database, objectStorage, mlService, and redis health without leaking provider internals to mobile clients.

---

## Historical Notes

- Legacy Supabase clients (`src/clients/supabase/`) and configuration removed in favor of portable provider abstractions.
- Password change returns `data: null` with `success: true` envelope.
