# Execution plan — full migration, not complete

Date: 2026-11-04. Scope and acceptance: the workspace `.scratch/syrax-meraxes-astra-k8s/spec.md`.
Exact source-reference inventory: the workspace `.scratch/syrax-meraxes-astra-k8s/runtime-inventory.json`.

## Current evidence

- Feature branch `feat/astra-api-k8s` exists in syrax, meraxes and project-astra.
- Syrax baseline: 55 passed, 37 skipped. Meraxes baseline: 460 passed.
- Sources contain 72 distinct literal `.from()` names in Syrax, 70 in Meraxes; these include buckets and are NOT a verified production-table count. Dynamic table references exist in 7/35 source files. Production catalog is not inspected.
- Astra source now includes the CMS session endpoint alongside mobile/admin/adiwiyata; CMS content CRUD and PKL workflows remain pending. Its current IdentityRole enum has platform_admin/school_admin/teacher/student/staff; CMS has many more roles and jurusan scopes. Those are separate permission domains, not interchangeable admin aliases.
- Both app SECURITY.md files require verified role, access_enabled, authz_version, jurusan scopes and persisted portal ownership. These remain migration acceptance requirements.
- Meraxes custom roles are written to local `src/data/custom-roles.json` and also statically bundled. A shared persistent API must replace both paths before Kubernetes readiness.
- Astra now implements `GET /v1/cms/session` with protected CMS identity access; client/session helpers and SDK configuration exist in both apps. Existing runtime Supabase consumers have not been switched yet. No production connection, data export, DB/Logto mutation or cluster apply has occurred.
- Astra README.md was already dirty before this task and is preserved.

## Sequence and acceptance gates

1. **CMS/PKL persistence and contract.** Reconcile source migrations against a redacted schema-only snapshot of each actual source DB; establish whether Syrax/Meraxes share a source. Build a domain/resource coverage matrix including dynamic CrudPage tables, relations and publication rules. Keep legacy UUIDs and explicit identity bindings; avoid collisions with Astra profiles/roster. Publish additive versioned CMS public/admin and PKL endpoints in Astra with request schemas and pagination. No raw SQL or service-role/PostgREST tunnel. Done: API/SQL tests verify publication/field projection, per-role/jurusan and ownership denial, transaction boundaries and existing consumers remain compatible.
2. **Identity and app sessions.** Reuse Astra's Logto identity verification. Add explicit CMS role/jurusan authorization records without broadening mobile/admin roles. Replace both proxies, Server Actions, browser auth, login/logout, refresh and account/password administration. Same-origin server routes own session tokens; secrets never enter browser bundles. Done: disable/revoke/downgrade tests deny existing sessions, forging display metadata cannot grant privileges, cross-user/industry/jurusan accesses fail; every current role has a parity case.
3. **Public CMS reads.** Replace Syrax query helpers, page-level queries, browser home components and public API routes. Move publish/date filters and projections into Astra. Preserve pagination, jurusan aliases and empty/error handling. Done: public pages consume API only and cannot leak drafts or private staff/student fields.
4. **Meraxes CMS and account administration.** Migrate shared CrudPage plus all bespoke pages, relational pickers, uploads, activity logs, bulk/import/export and role/account APIs. Persist custom roles centrally and fetch configuration at runtime. Done: create/edit/delete/upload, scoped roles, audit, validation and concurrency parity pass through Astra.
5. **PKL workflows.** Migrate student registration/placement, attendance, journals/comments/approvals, monitoring, assessments, document access and certificates, supervisor/industry links, account provisioning, email and WA flows. Preserve ownership and approved-journal immutability. Done: synthetic student-to-admin-to-supervisor/industry flow exercises authorization and all transitions, including failure/retry cases.
6. **Files and migration tooling.** Implement dry-run/resumable import of actual CMS/PKL schema data, verified auth identity bindings, reviewed password hash import or an explicit account recovery decision, storage inventories/content checksums/ACLs and URL rewrites. Reconcile row counts/FKs, duplicate identities, orphan owners and private/public object access. Synthetic rehearsal must pass before any production export/import. Never bind identities solely by matching email/name or grant roles from legacy mutable metadata.
7. **Kubernetes release and pruning.** Finish API-based readiness, runtime configuration, images, CI, Secrets authority integration, routing/TLS, stateless custom roles/uploads, writable cache and Server Action/cache behavior. Remove Supabase SDK/env/config/legacy scripts only when replacements pass. Keep meaningful security/domain tests. Done: clean production builds, image startup as non-root, manifest validation and synthetic end-to-end deployment evidence. Draft base render alone is not readiness.
8. **Later production cutover.** Present concrete source/target inventory, verified backup/restore, approved identity/role mapping, data reconciliation results, freeze/delta plan, exact commands, blast radius and rollback including post-cutover writes. Obtain explicit immediate approval under AGENTS.md and ops-safety-guard. Import, verify, switch traffic and verify auth/permissions/data/object/UI paths before retiring any old service. No destructive teardown in this task.

## Cleanup applied so far

Removed tracked generated Playwright HTML reports from both repos and Syrax's generated last-run result; ignored future generated reports/results. Reduced Docker build contexts by excluding operational scripts, historical SQL, tests/output/docs and agent state. Retained live Supabase integration suites: skipped does not mean useless; they express workflow parity requirements and need replacement with synthetic Astra coverage before removal.

## Packaging checkpoint

Fixed Syrax `/health` auth bypass. Database readiness now performs a zero-row resource query and rejects 401/403/404/500; liveness stays process-only. Removed dangling manual abort timers using AbortSignal.timeout. Draft Deployments/Services use startup/live/ready probes, one replica, UID/GID 1001, no service-account token, dropped capabilities and resource bounds. Meraxes image is aligned to Node 22 and UID/GID 1001. Draft manifests deliberately use `build-required` images and are not attached to active infrastructure.

## Validation checkpoint

- Updated unit suites: Syrax 62 passed / 37 live-integration tests skipped; Meraxes 466 passed. Both final health suites separately rerun: 9/9 passed each.
- TypeScript checks and targeted health ESLint pass in both apps. `git diff --check` passes.
- Both Kubernetes bases render offline. No API-server validation or deployment.
- Both Docker production builds pass using dummy public config and no env files.
- Syrax image: `sha256:c93b79ab5691332115c90d26cf3e1fc4cc3f89682b94c9e5f8faf00cce6fc86a`.
- Meraxes image: `sha256:93a4477d720ea5c39f2be3233a9f3a6e5aa2cbac23dbec1238b79df72e5ff397`.
- Syrax smoke passed as UID/GID1001 with external network disabled: liveness200, failed-backend readiness503, anonymous portal307 and login200. Meraxes isolated smoke also passed as UID/GID1001: liveness200, failed-backend readiness503, anonymous admin307, login200.
- These are baseline app images, still using Supabase; no Astra/Logto or production-data end-to-end claim.

## Source preparation — CMS identity slice

The latest user instruction limits this phase to source preparation. Production
migration and traffic switching are later work.

Implemented `GET /v1/cms/session` with the existing Astra envelope/version headers,
`cms:access`, explicit `cms.profiles` identity bindings, current protected roles and
department scope, enablement and global/CMS session revocation. Roles remain
separate from mobile/attendance roles. New records default disabled, UUIDs are
immutable, subject bindings are unique, and authority updates advance version and
session cutoff. Nothing imports or enables existing accounts automatically.

The operator-run `db/migrations/0003_cms_identity.sql` is source-only. Its DDL was
applied twice and `tests/sql/cms-identity.sql` assertions passed inside a disposable,
network-disabled PostgreSQL17.6 container using tmpfs; the container was removed.
No existing PostgreSQL/Logto/cluster state was changed.

Syrax and Meraxes now have `src/lib/astra/{session,client}.ts`, pinned
`@logto/next@4.2.10`, `src/lib/logto/config.ts` and runtime-only environment
templates. Both reuse their own shared RBAC role set. The transport validates
contract version, envelope, authority fields, department scope and numeric version;
it bounds requests, disables redirects/caching and projects safe session fields.
RSC and Server Action token helpers are separate so writable actions persist token
refreshes. These helpers are not wired into legacy login/CRUD yet.

Before actual use, configure a Logto application per app with distinct cookie
secrets/public origins, the exact Astra API audience as LOGTO_RESOURCE, and the
cms:access permission. Astra's database runtime principal needs the reviewed grant
for cms.profiles. Provisioned bindings/role approvals and schema application belong
to the later approved operation, not startup or image build.

Remaining: CMS content/CRUD APIs and consumers, complete PKL workflow/file APIs,
Logto login/callback/logout and legacy auth replacement, centralized custom roles,
final removal of Supabase dependencies/config and target end-to-end packaging.
This slice is not full-codebase completion or deployment readiness.

## Current source verification

- Syrax100 tests pass /37 legacy live-integration cases skipped; Meraxes504 pass.
- Astra532 unit cases pass; full integration362 pass /18 external-DB cases skipped,
  followed by47 targeted CMS/manifest cases passing after global revocation support.
- All source typechecks, Astra build/lint and targeted app-source lint pass.
- Both current Docker builds pass with dummy config only: Syrax
  `sha256:82fd4f86988d0d642f42a291c5db67f654f26b9d5283952108a85aee1c908a78`, Meraxes
  `sha256:edf27b3919d64fb83462c95db21f81d229f089172b1d0ab7a010ad5db1afe74d`.
- This validates the prepared slice. Existing consumers, CMS CRUD and PKL APIs,
  complete Logto auth wiring and final target end-to-end readiness remain open.

Current-image isolated non-root smoke also passed for both apps: live200, failed dependency readiness503, anonymous protected route307 and login200. No source-preparation completion or target API end-to-end claim is made.

## Student password management in the prepared source

Syrax links to the Logto-hosted `/account/password` page through an authenticated
`/api/logto/account-password` route with a fixed same-app return URL. It never
accepts a password or copies credentials into PKL records. Configure a Logto
version with Account Center (v1.37 or newer), enable Account Center and its password
feature before cutover, and test reauthentication and return behavior. Returning
to Syrax is not treated as evidence that a password changed. Reference:
[Logto Account Center](https://docs.logto.io/end-user-flows/account-settings/by-account-center-ui).
No tenant setting was changed during source preparation.

## Native account administration prepared in source

CMS account CRUD authority is owned by Astra `cms.profiles`; management API
credentials remain in Astra. The prepared account endpoints list/create/update
bindings and reset passwords by explicit legacy profile UUID. New identities are
created suspended, with only the preconfigured CMS access role, then bound to a
disabled profile before activation. No email-based claiming or replacement occurs.
A failed provider/DB step leaves the identity or profile suspended/disabled; record
and reconcile such pending provisioning before retrying. No identity is deleted as
a compensating shortcut. Account deactivation preserves PKL relations and audit.

The operator must set `LOGTO_CMS_ACCESS_ROLE_NAME` to a reviewed existing Logto
User role granting only `cms:access` on the Astra audience. Source preparation
does not create that role, assign production permissions or read credentials.
General CMS administrators manage ordinary accounts; only super administrators
can grant/manage super administrator authority. PKL administrators manage only
operational student/teacher/industry accounts. Authority updates bump version and
cutoff; password reset attempts are audited without secrets and revoke sessions
before requesting the provider change. Provider failure is an error, not success.

The new provider path uses Logto's
[create-user API](https://openapi.logto.io/operation/operation-createuser) and
[additive role assignment](https://openapi.logto.io/operation/operation-assignuserroles).
It never uses display metadata as an authorization grant or assigns mobile roles.
Pending work still includes remaining PKL provisioning callers, durable custom
roles and storage lifecycle, plus full target rehearsal and migration tooling.
