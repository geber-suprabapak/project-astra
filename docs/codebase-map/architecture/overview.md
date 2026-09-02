# Astra Architecture

`createApp` configures request IDs, injected providers, CORS, contract enforcement, security headers, logging, root health, and `/v1/{admin,auth,mobile}` route mounts. Feature modules implement API behavior; providers adapt PostgreSQL, S3-compatible storage, Logto/OIDC, and Robin.

Bearer identity is verified through `IdentityProvider`; persistence through `DomainStore`; files through object-storage adapters. Robin handles technical face operations while Astra remains domain authority.

**Evidence:** `src/app.ts`, `src/routes/v1-mobile.ts`, `src/providers/types.ts`, `README.md`.
