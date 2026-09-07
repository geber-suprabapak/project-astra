# Objective

Implement ticket 06: gate every Attendance write on an approved effective Leave Period and add auditable School Administrator force-finish.

# Requirements

- Approved effective periods block mobile precheck/submit and manual Attendance on every effective WIB date.
- Pending and rejected requests never block Attendance.
- Force-finish may only shorten an approved period; it preserves requested/original end and records effective end, actor, time, and reason.
- The shared Astra error contract remains `ATTENDANCE_BLOCKED` with actionable details.
- Legacy approved one-day requests continue to behave as one-day periods.

# Acceptance Criteria

- Astra HTTP tests cover mobile, manual, boundaries, roles, and audit fields.
- Mobile workflow maps a structured `ATTENDANCE_BLOCKED` submit response to a stable actionable outcome.
- No attendance is deleted or rewritten.

# Constraints

- Ticket 06 only; no recap/export/roster/attachment work.
- No new dependencies, production mutation, migration execution, or contract additions beyond this ticket.

# Relevant Areas

- `src/modules/attendance`, `src/modules/admin`, `src/providers`, `db/schema.sql`, `contracts/astra-v1.json`.
- Mobile `features/attendance-workflow` and existing workflow tests.

# Implementation Notes

Use a provider-owned shared attendance leave gate and enforce it again inside write transactions so approval-vs-attendance serialization cannot race.
