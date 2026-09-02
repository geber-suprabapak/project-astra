# Decision Index

| Decision | Status | Source | Affects |
| --- | --- | --- | --- |
| Astra is the domain/API gateway | Documented | `README.md` | All clients |
| Logto RBAC is the API authority | Documented | `docs/adr/0001-logto-rbac-is-the-api-authority.md` | Authorization and token scopes |
| Notification delivery uses a persisted outbox worker | Observed | `src/workers/notification-worker.ts`, `tests/integration/notifications.test.ts` | Notification lifecycle |
| Provider interfaces isolate dependencies | Observed | `src/providers/types.ts`, `src/app.ts` | Persistence, storage, identity, Robin |
| `/v1` contract version is enforced | Observed | `src/app.ts` | HTTP clients |

Historical rationale beyond these sources is not recorded.
