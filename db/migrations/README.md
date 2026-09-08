# Astra production migrations

These files are operator-run, versioned SQL. They are separate from the
seed-bearing `db/schema.sql`; no migration runner or automatic production DDL
is introduced.

Run from this repository with a maintenance-window connection:

```sh
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f db/migrations/0001_ticket-01-04-roster-boundary.sql
```

Migration `0001` only prepares the Ticket 01/04 schema. It intentionally does
not create `students` or `student_bindings` rows. The 1,302 legacy student
profiles and 1,912 active enrollments remain on the legacy `user_id` path;
canonical conversion is deferred until the data owner approves the roster
source, student-ID derivation, gender/NIS handling, and binding policy. New
canonical roster writes may use `student_id` without requiring `user_id`.
After an approved backfill, validate the deferred constraints in the same
maintenance plan:

```sql
ALTER TABLE class_enrollments
  VALIDATE CONSTRAINT class_enrollments_student_id_fkey;
ALTER TABLE class_enrollments
  VALIDATE CONSTRAINT class_enrollments_owner_check;
ALTER TABLE class_enrollments
  VALIDATE CONSTRAINT class_enrollments_absence_number_check;
ALTER TABLE roster_reports
  VALIDATE CONSTRAINT roster_reports_academic_period_id_fkey;
ALTER TABLE leave_requests
  VALIDATE CONSTRAINT leave_requests_duration_days_check;
```

The migration preflight rejects missing legacy columns, incompatible existing
canonical objects, and invalid active legacy enrollments before its first DDL
statement. It does not normalize or invent legacy data.
