# Commit Mobile Attendance with its success Attempt

Mobile Attendance writes acquire the existing per-Student transaction lock, recheck that the requested action is still available, then commit the Attendance and its success Attempt in one PostgreSQL transaction. A repeated or raced action returns the existing `ATTENDANCE_BLOCKED` conflict instead of replaying a prior success; v1 has no operation-specific idempotency key, so clients reconcile an ambiguous result through Attendance history. This prevents duplicate action rows and success Attempts without matching Attendance while preserving the current request and response envelope.

## Consequences

This is at-most-once action creation, not idempotent replay: after a timeout, a later request may receive `ATTENDANCE_BLOCKED` even when the first request committed. The Student must inspect history before starting a new action. Manual Attendance uses the same lock and action guard so it cannot race the Mobile write into a duplicate.
