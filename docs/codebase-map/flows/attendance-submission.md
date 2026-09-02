# Attendance Submission

1. A contract-versioned authenticated request reaches `/v1/mobile/attendance` through app middleware.
2. `precheck` calls `runGateChecks` for permitted action, schedule/location context, and blocking reason.
3. `submit` validates the requested action against the same server-side gates.
4. Astra delegates technical face work through Robin and persistence through `DomainStore`.
5. The route returns the standard success/error envelope.

Gate failure, inconsistent action type, dependency failure, or provider-write failure must not appear as a successful attendance write.

**Evidence:** `src/modules/attendance/service.ts`, `src/modules/attendance/routes.ts`, `src/app.ts`, `tests/integration/mobile-contract.test.ts`.
