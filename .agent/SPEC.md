# Objective

Publish the Astra v1 contract additions required by Ticket 07 Monthly Attendance Recap.

# Requirements

- Publish `monthly_attendance_sources` for the existing read routes used by Chronos.
- Publish existing `GET /v1/admin/enrollments` and `GET /v1/admin/calendar-exceptions` routes.
- Keep the contract snapshot compatible with Chronos.

# Acceptance Criteria

- The contract manifest test passes with the newly published routes.

# Constraints

- No runtime Astra code, migrations, or unrelated contract changes.

# Relevant Areas

- `contracts/astra-v1.json` and its manifest test.

# Implementation Notes

Mirror the existing route publication in Chronos and retain the canonical Astra contract as source of truth.
