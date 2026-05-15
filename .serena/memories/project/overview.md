# Skanida Mobile BFF

- **Purpose**: Backend-for-Frontend service for the Skanida mobile app, orchestrating attendance, enrollment, permits, profile, dashboard, and time sync between mobile and Supabase/Robin.
- **Stack**: Node 22 LTS, TypeScript, Hono, @hono/node-server, Zod, jose, @supabase/supabase-js, pino, vitest, eslint, prettier, tsx
- **Package manager**: pnpm (lockfile present), npm scripts in package.json
- **Structure**: src/ with config/, middleware/, clients/ (robin/, supabase/), modules/ (attendance, dashboard, enrollment, permits, profile, time, health), lib/ (errors/, http/, logging/), routes/, types/