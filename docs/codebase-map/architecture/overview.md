# Astra Architecture

`createApp` configures request IDs, injected providers, CORS, contract enforcement, security headers, logging, root health, and `/v1/{admin,auth,mobile,adiwiyata,cms}` route mounts. Feature modules implement API behavior; providers adapt PostgreSQL, S3-compatible storage, Logto/OIDC, and Robin.

Bearer identity is verified through `IdentityProvider`; persistence through `DomainStore`; files through object-storage adapters. Robin handles technical face operations while Astra remains domain authority.

**Evidence:** `src/app.ts`, `src/routes/v1-mobile.ts`, `src/providers/types.ts`, `README.md`.

CMS identity access uses a separate `cms.profiles` authority bound explicitly to
Logto subjects. The CMS session endpoint requires `cms:access` and a current,
enabled CMS profile; it does not require or grant mobile/attendance roles. Profile
authority changes advance the session cutoff so previously issued tokens fail.
The schema is source-only until the operator-run migration is approved/applied.

**CMS evidence:** `src/modules/cms/service.ts`, `db/migrations/0003_cms_identity.sql`,
`tests/integration/cms-session.test.ts`, `tests/sql/cms-identity.sql`.
