# Skanida Mobile BFF — Implementation Status

## Completed (2026-05-15)
All items from plan.md have been implemented or explicitly resolved:

### Core Infrastructure
- Hono app bootstrap with CORS, request ID, error envelope, rate limiting
- Auth middleware with jose JWT verification + tenant context
- All env vars from plan §9.5 (including 3 new timeout vars)
- Dockerfile, docker-compose, CI baseline (typecheck, lint, unit tests, integration test job)

### API Endpoints (all 12 from plan §7)
- GET /v1/mobile/dashboard — full plan-compliant response shape
- POST /v1/mobile/attendance/precheck — with checks object + enrollment gate
- POST /v1/mobile/attendance/submit
- GET /v1/mobile/face/enrollment/status
- POST /v1/mobile/face/enrollment (10 JPEG files, 2MB max)
- GET /v1/mobile/permits (with items wrapper + rejected_at)
- POST /v1/mobile/permits (multipart)
- GET /v1/mobile/profile
- PATCH /v1/mobile/profile/avatar (multipart + JSON clear)
- PATCH /v1/mobile/profile/password
- GET /v1/mobile/time
- GET /v1/mobile/health (status: healthy/unhealthy)
- GET /live, GET /ready

### Error Taxonomy
All 13 error codes from plan §6.3 + AppError.tenantMismatch() factory

### Tests
- 64 unit tests covering: error codes, error factories, rate limit store, auth middleware, attendance mapper, dashboard service, primary action gating, request validation, schema constants, env config, time service
- Integration test infrastructure in place