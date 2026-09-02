# Notification Delivery

1. Domain behavior or an authorized administration route persists notification work through `DomainStore`.
2. The background worker claims a bounded batch of eligible pending records.
3. For each record, it resolves the recipient profile and dispatches through the configured push or email transport.
4. A successful transport result marks the record delivered.
5. A failed result returns the record to pending with exponential backoff; reaching the retry limit marks it failed. An authorized administration action can reset a failed record for retry.

Worker shutdown stops new polling and waits for the current batch before closing the store. Delivery status belongs to the outbox lifecycle and does not redefine the originating domain event.

**Evidence:** `src/workers/notifications.ts`, `src/workers/notification-worker.ts`, `src/modules/notifications/service.ts`, `src/modules/notifications/transport.ts`, `tests/integration/notifications.test.ts`.
