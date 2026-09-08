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

psql_check_hostile_path() {
  docker exec -i -e PGOPTIONS='-c search_path=shadow,public' \
    "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres "$@"
}

create_legacy_fixture() {
  local database=$1

  # Keep the fixture deliberately smaller than db/schema.sql so this check also
  # exercises an upgrade from the pre-Ticket 01/04 shape after the bootstrap has
  # moved on. The production migration itself contains no seed-bearing statements.
  psql_check -d "$database" <<'SQL' >/dev/null
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
}

create_legacy_fixture postgres
psql_check -d postgres < "$repo_dir/db/migrations/0001_ticket-01-04-roster-boundary.sql" >/dev/null
psql_check -d postgres -c "CREATE SCHEMA shadow" >/dev/null
psql_check_hostile_path -d postgres < "$repo_dir/db/migrations/0001_ticket-01-04-roster-boundary.sql" >/dev/null

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
create_legacy_fixture astra_invalid_fixture
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

# A failed CREATE INDEX CONCURRENTLY leaves an invalid same-named index. The
# migration must report that state explicitly instead of IF NOT EXISTS silently
# accepting it and continuing with an unusable uniqueness guarantee.
psql_check -d postgres -c "CREATE DATABASE astra_invalid_index_fixture" >/dev/null
create_legacy_fixture astra_invalid_index_fixture
psql_check -d astra_invalid_index_fixture <<'SQL' >/dev/null
ALTER TABLE public.class_enrollments ADD COLUMN student_id UUID;
INSERT INTO public.profiles (user_id) VALUES ('index-a'), ('index-b');
INSERT INTO public.academic_periods (id) VALUES ('00000000-0000-0000-0000-000000000001');
INSERT INTO public.classes (id, academic_period_id)
VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001');
INSERT INTO public.class_enrollments
  (user_id, class_id, academic_period_id, student_id, status)
VALUES
  ('index-a', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'active'),
  ('index-b', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'active');
SQL

if psql_check -d astra_invalid_index_fixture -c \
  "CREATE UNIQUE INDEX CONCURRENTLY uq_active_student_class_enrollment ON public.class_enrollments(student_id, academic_period_id) WHERE status = 'active'" \
  >/dev/null 2>&1; then
  echo 'expected invalid concurrent-index build failure' >&2
  exit 1
fi

if psql_check -d astra_invalid_index_fixture < "$repo_dir/db/migrations/0001_ticket-01-04-roster-boundary.sql" >/dev/null 2>&1; then
  echo 'expected invalid-index preflight failure' >&2
  exit 1
fi

psql_check -d astra_invalid_index_fixture -tAc \
  "SELECT CASE WHEN EXISTS (
     SELECT 1
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_catalog.pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public' AND c.relname = 'uq_active_student_class_enrollment'
       AND NOT i.indisvalid
   ) AND to_regclass('public.students') IS NULL
   THEN 'invalid-index preflight passed' ELSE 'invalid-index preflight mutated' END" \
  | grep -qx 'invalid-index preflight passed'

# A pre-existing canonical table may be missing one FK. Add the missing FK as
# NOT VALID so historical orphan rows remain untouched while new writes are
# protected; a wrongly named or mapped FK must still be rejected on rerun.
psql_check -d postgres -c "CREATE DATABASE astra_partial_fk_fixture" >/dev/null
create_legacy_fixture astra_partial_fk_fixture
psql_check -d astra_partial_fk_fixture <<'SQL' >/dev/null
CREATE TABLE public.students (
  id UUID PRIMARY KEY,
  nis TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  gender TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT students_gender_check CHECK (gender IN ('L', 'P'))
);
INSERT INTO public.students (id, nis, full_name, gender)
VALUES ('00000000-0000-0000-0000-000000000010', 'partial-1', 'Partial Student', 'L');
CREATE TABLE public.student_bindings (
  student_id UUID PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT student_bindings_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE
);
INSERT INTO public.student_bindings (student_id, user_id)
VALUES ('00000000-0000-0000-0000-000000000010', 'partial-orphan');
SQL
psql_check -d astra_partial_fk_fixture < "$repo_dir/db/migrations/0001_ticket-01-04-roster-boundary.sql" >/dev/null

psql_check -d astra_partial_fk_fixture -tAc \
  "SELECT CASE WHEN
     (SELECT count(*) FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.student_bindings'::regclass
        AND conname IN ('student_bindings_student_id_fkey', 'student_bindings_user_id_fkey')
        AND contype = 'f') = 2
     AND EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint
       WHERE conrelid = 'public.student_bindings'::regclass
         AND conname = 'student_bindings_student_id_fkey'
         AND confrelid = 'public.students'::regclass
         AND confdeltype = 'c'
         AND convalidated
     )
     AND EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint
       WHERE conrelid = 'public.student_bindings'::regclass
         AND conname = 'student_bindings_user_id_fkey'
         AND confrelid = 'public.profiles'::regclass
         AND confdeltype = 'c'
         AND NOT convalidated
     )
   THEN 'partial foreign keys passed' ELSE 'partial foreign keys failed' END" \
  | grep -qx 'partial foreign keys passed'

psql_check -d astra_partial_fk_fixture -c \
  "ALTER TABLE public.student_bindings
     ADD CONSTRAINT student_bindings_wrong_name_fkey
     FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE
     NOT VALID" >/dev/null
if psql_check -d astra_partial_fk_fixture < "$repo_dir/db/migrations/0001_ticket-01-04-roster-boundary.sql" >/dev/null 2>&1; then
  echo 'expected wrongly named student_bindings FK preflight failure' >&2
  exit 1
fi

echo 'production migration check passed (PostgreSQL 17 disposable container)'
