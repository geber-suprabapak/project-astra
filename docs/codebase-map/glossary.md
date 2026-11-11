# Glossary

## Attendance precheck

**Meaning:** Server-side eligibility result before an image is submitted.
**Evidence:** `src/modules/attendance/service.ts`.

## CMS profile

**Meaning:** A person's protected content-management/PKL access, with an explicit identity binding, role, department scope, enablement and session validity. This access is separate from attendance/mobile access.
**Owned by:** CMS.
**Evidence:** `src/modules/cms/schema.ts`, `src/modules/cms/service.ts`.

## DomainStore

**Meaning:** Astra provider interface for domain persistence.
**Not:** A client-visible database contract.
**Evidence:** `src/providers/types.ts`.

## File

**Meaning:** Astra-owned metadata and lifecycle for an object-storage object.
**Evidence:** `CONTEXT.md`, `src/modules/files/`.

## IdentityProvider

**Meaning:** Astra provider interface for verified Logto/OIDC identity context.
**Evidence:** `src/providers/types.ts`, `src/providers/identity/`.

## Leave Request

**Aliases:** permit, perizinan.
**Meaning:** Student request to skip attendance on a date.
**Evidence:** `CONTEXT.md`, `src/modules/permits/`.

## Notification outbox

**Meaning:** Persisted notification work claimed by Astra's background worker and moved through pending, delivered, retry, or failed states.
**Evidence:** `src/workers/notification-worker.ts`, `src/providers/types.ts`.

## Robin

**Meaning:** Internal technical face-recognition dependency, not attendance authority.
**Evidence:** `README.md`, `src/clients/robin/`.
