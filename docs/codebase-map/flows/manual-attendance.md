# Manual Attendance

## Trigger and outcome

Only a canonical `school_admin` records Attendance after a related Attendance Attempt could not complete the intended action. The operation preserves the actor, human reason, and Attempt reference in an audit row.

## Preconditions

- The caller has the canonical `school_admin` role; platform administrators and all other domain roles are denied.
- The target Student profile exists and is approved.
- A related Attempt has status `failed` or `error`, belongs to the same Student, matches the action, and falls on the same WIB date as the requested Attendance.
- An active Leave Period does not block the requested Attendance date.

## Main sequence

1. The admin route validates the request, including the required reason and Attempt ID.
2. The service checks authorization, Student/Attempt relationships, eligible status, and the Asia/Jakarta date match.
3. `DomainStore.createManualAttendance` applies the Leave Period guard and inserts Attendance plus its audit row in one database transaction.
4. After the transaction commits, the service enqueues a notification and returns the Attendance record.

## Branches and failures

- Invalid, successful, unrelated, or different-WIB-date Attempts, non-approved Students, and Leave Period conflicts fail before an Attendance record is committed.
- A PostgreSQL audit insert failure aborts the transaction, so Attendance does not commit.
- Notification enqueue runs after the commit; an enqueue failure does not undo the Attendance or audit row.

## Participating modules

- `src/modules/admin/routes.ts`
- `src/modules/admin/service.ts`
- `src/providers/types.ts`
- `src/providers/postgres/domain-store.ts`
- `src/providers/memory/index.ts`

## Evidence

- `tests/unit/modules/attendance-exceptions-service.test.ts`
- `tests/unit/providers/postgres-domain-store.test.ts`
- `tests/integration/attendance-exceptions.test.ts`

The unit provider test uses a synthetic SQL transaction seam; real PostgreSQL rollback verification is separate and requires a disposable `TEST_POSTGRES_URL`.
