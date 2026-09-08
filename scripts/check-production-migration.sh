#!/usr/bin/env bash
set -euo pipefail

# Disposable PostgreSQL 17 check for the versioned additive migration.
# No production target, host port, or persistent volume is used.

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
container_name="astra-migration-check-$$"
trap 'docker rm -f "$container_name" >/dev/null 2>&1 || true' EXIT

docker run --detach --name "$container_name" \
  -e POSTGRES_PASSWORD=check-only \
  postgres:17-bookworm >/dev/null

ready=0
for attempt in 1 2 3 4 5; do
  if docker exec "$container_name" pg_isready -U postgres -d postgres >/dev/null 2>&1 \
    && docker exec "$container_name" psql -X -U postgres -d postgres -Atc 'SELECT 1' >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if (( ready == 0 )); then
  echo 'PostgreSQL 17 disposable fixture did not become ready' >&2
  exit 1
fi

psql_check() {
  docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres "$@"
}

# Keep the fixture deliberately smaller than db/schema.sql so this check also
# exercises an upgrade from the pre-Ticket 01/04 shape after the bootstrap has
# moved on. The production migration itself contains no seed-bearing statements.
psql_check -d postgres <<'SQL' >/dev/null
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,
  full_name TEXT,
  nis TEXT UNIQUE,
  gender TEXT,
  role TEXT NOT NULL DEFAULT 'student'
);
CREATE TABLE schools (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE academic_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id)
);
CREATE TABLE classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_period_id UUID REFERENCES academic_periods(id)
);
CREATE TABLE class_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES profiles(user_id),
  class_id UUID REFERENCES classes(id),
  academic_period_id UUID REFERENCES academic_periods(id),
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE roster_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id)
);
CREATE TABLE leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES profiles(user_id)
);
SQL
psql_check -d postgres < "$repo_dir/db/migrations/0001_ticket-01-04-roster-boundary.sql" >/dev/null
psql_check -d postgres < "$repo_dir/db/migrations/0001_ticket-01-04-roster-boundary.sql" >/dev/null

psql_check -d postgres <<'SQL' >/dev/null
DO $$
BEGIN
  IF to_regclass('public.students') IS NULL
     OR to_regclass('public.student_bindings') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'class_enrollments'
         AND column_name = 'student_id'
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'roster_reports'
         AND column_name = 'academic_period_id'
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'leave_requests'
         AND column_name = 'duration_days'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = 'uq_active_student_class_enrollment'
     )
  THEN
    RAISE EXCEPTION 'migration 0001 verification failed';
  END IF;
END
$$;
SQL

# An invalid active enrollment must fail before creating any canonical relation.
psql_check -d postgres -c "CREATE DATABASE astra_invalid_fixture" >/dev/null
psql_check -d astra_invalid_fixture <<'SQL' >/dev/null
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,
  full_name TEXT,
  nis TEXT UNIQUE,
  gender TEXT,
  role TEXT NOT NULL DEFAULT 'student'
);
CREATE TABLE schools (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE academic_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id)
);
CREATE TABLE classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_period_id UUID REFERENCES academic_periods(id)
);
CREATE TABLE class_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES profiles(user_id),
  class_id UUID REFERENCES classes(id),
  academic_period_id UUID REFERENCES academic_periods(id),
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE roster_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id)
);
CREATE TABLE leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES profiles(user_id)
);
SQL
psql_check -d astra_invalid_fixture -c \
  "INSERT INTO profiles (user_id, full_name, nis, role, gender) VALUES ('invalid-student', 'Invalid', '999999', 'student', NULL)" >/dev/null
psql_check -d astra_invalid_fixture -c \
  "INSERT INTO class_enrollments (user_id, status) VALUES ('invalid-student', 'active')" >/dev/null

if psql_check -d astra_invalid_fixture < "$repo_dir/db/migrations/0001_ticket-01-04-roster-boundary.sql" >/dev/null 2>&1; then
  echo 'expected invalid-enrollment preflight failure' >&2
  exit 1
fi

psql_check -d astra_invalid_fixture -tAc \
  "SELECT CASE WHEN to_regclass('public.students') IS NULL THEN 'preflight passed' ELSE 'preflight mutated' END" \
  | grep -qx 'preflight passed'

echo 'production migration check passed (PostgreSQL 17 disposable container)'
