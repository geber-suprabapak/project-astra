# Objective
Migrate Syrax and Meraxes fully from Supabase to the existing Astra API and Logto, preserve all current public CMS/admin/PKL features, prepare Kubernetes deployment, and prune only proven obsolete artifacts. A later production cutover must migrate accounts, authorization, relational data, files and URLs.

# Requirements
- Latest user instruction: prepare codebases only now. Do not run deployment, production data/account migration or traffic switching in this phase. Migration SQL is delivered as source and tested only in disposable local databases.
- User confirmed full Astra + Logto migration on 2026-11-04; no temporary Supabase login target.
- PostgreSQL Astra owns CMS/PKL; browsers consume application APIs, never database credentials or service-role tokens.
- Preserve publication rules, jurusan scopes, access_enabled/authz_version revocation, student/supervisor/industry ownership, journal approval locks, certificates, account provisioning, import/export, email/WA and uploads.
- Stable legacy-to-Logto identity bindings; never infer identity or grant roles from email/name/user-editable metadata.
- Preserve legacy UUID relationships and uploaded object references; do not reset accounts, replace durable stores or execute historical seed/reset scripts.
- Production migration is a separate final operation with preflight, approved identity mapping, verified recovery and explicit target/blast-radius approval.

# Acceptance Criteria
- No Supabase SDK/env/query/auth/storage dependency remains in either app runtime.
- Astra CMS/PKL API contracts, input validation, authorization and regression tests cover every migrated resource/workflow.
- Logto sign-in/out, refresh, revocation and role/jurusan/ownership checks work for all currently supported roles.
- Offline migration tooling supports dry-run, resumability, row/FK/object/identity verification and explicit failure reporting; synthetic rehearsal passes.
- Both production builds, relevant security/domain tests and container smoke checks pass.
- Kubernetes manifests render and expose separate startup/liveness/readiness checks, non-root containers and bounded resources; representative synthetic end-to-end paths pass before readiness is claimed.
- Cleanup removes only unreferenced/generated/obsolete material with recorded rationale; security/domain tests are retained.

# Constraints
Source/config work only until production preflight and approval. No production secrets read/printed, no live DB/Logto/storage mutation, no cluster apply, no destructive pruning. Preserve pre-existing project-astra README.md edits. No push/merge/deploy implied. Existing root .agent refers to a different completed hardening effort and is left intact.

# Relevant Areas
syrax/src, meraxes/src, project-astra/src/{modules,providers,middleware}, existing contracts and SQL migrations, app Dockerfiles/CI/deployment config. Existing Astra identity roles are a smaller set than CMS/PKL roles; CMS permissions must not be collapsed into school_admin/platform_admin.

# Implementation Notes
Build backward-compatible Astra endpoints first, migrate consumers by domain, rehearse synthetic import, then remove obsolete Supabase paths after parity checks. Do not implement a generic SQL/PostgREST tunnel masquerading as a domain API. Keep deployment manifests separate from active infra overlays until the release is verified.
