# Leave Reopen

1. An authenticated administrative request reaches the leave-request `PATCH` pending transition or a dedicated `/leave-requests/:id/reopen` or `/permits/:id/reopen` route.
2. Route and service authorization require a platform administrator, school administrator, or teacher; a missing request returns not found.
3. `reopenLeaveRequest` sets `approval_status` to `pending`, `status` to false, and clears the rejection reason and timestamp through `DomainStore`.
4. Astra appends a `reopen_leave_request` audit record and enqueues a push notification for the affected student.
5. The updated leave request, including attachment mapping, is returned in the standard response envelope.

Authentication, role, or missing-record failures stop before the state transition. Later provider failures surface as errors rather than successful reopen responses; the code does not establish a cross-call transaction across the update, audit, and outbox operations.

**Evidence:** `src/modules/admin/routes.ts`, `src/modules/admin/service.ts`, `tests/integration/leave-requests.test.ts`, `tests/integration/challenger-adversarial-reopen.test.ts`.
