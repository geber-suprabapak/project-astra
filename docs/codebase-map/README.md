# Codebase Map

Project Astra is the Skanida domain backend and API gateway. It exposes mobile and administrative HTTP routes while hiding persistence, object storage, identity verification, and Robin integration behind providers.

| Area | Read |
| --- | --- |
| App composition and boundaries | [Architecture overview](architecture/overview.md) |
| Feature/provider ownership | [Modules](modules.md) |
| Precheck to attendance write | [Attendance submission](flows/attendance-submission.md) |
| Administrative leave reopen | [Leave reopen](flows/leave-reopen.md) |
| Notification outbox delivery | [Notification delivery](flows/notification-delivery.md) |
| Rules to preserve | [Invariants](invariants.md) |
