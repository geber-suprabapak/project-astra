-- Operator-run only. Does not import or enable any production accounts.
-- Additive rollback: leave cms.profiles intact and restore the previous image.
-- Do not drop this schema after identities/data have been imported.
\set ON_ERROR_STOP on
SET lock_timeout = '5s';
SET statement_timeout = '10min';
BEGIN;

-- CMS access remains separate from attendance/mobile profiles and permissions.
CREATE SCHEMA IF NOT EXISTS cms;

CREATE TABLE IF NOT EXISTS cms.profiles (
  id uuid PRIMARY KEY,
  logto_subject text NOT NULL UNIQUE CHECK (length(btrim(logto_subject)) > 0),
  full_name text,
  email text,
  role text NOT NULL CHECK (role IN (
    'super_admin', 'admin', 'admin_jurusan', 'admin_hubin', 'siswa', 'guru', 'industri',
    'pembimbing_sekolah', 'pembimbing_industri', 'supervisor', 'monitoring_sipkl',
    'admin_monitoring', 'jurnalistik', 'bkk', 'wks_1', 'wks_2', 'wks_3', 'wks_4',
    'waka_akademik', 'waka_kesiswaan', 'waka_sarpras', 'waka_hubin', 'waka_humas',
    'waka_hubin_humas', 'waka_kurikulum'
  )),
  jurusan_id uuid,
  jurusan_slug text CHECK (jurusan_slug IS NULL OR length(btrim(jurusan_slug)) > 0),
  authz_version integer NOT NULL DEFAULT 1 CHECK (authz_version > 0),
  access_enabled boolean NOT NULL DEFAULT false,
  session_valid_after timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION cms.protect_profile_authority()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'CMS profile identity is immutable';
  END IF;
  NEW.authz_version := OLD.authz_version;
  IF NEW.logto_subject IS DISTINCT FROM OLD.logto_subject
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.jurusan_id IS DISTINCT FROM OLD.jurusan_id
     OR NEW.jurusan_slug IS DISTINCT FROM OLD.jurusan_slug
     OR NEW.access_enabled IS DISTINCT FROM OLD.access_enabled THEN
    NEW.authz_version := OLD.authz_version + 1;
    NEW.session_valid_after := greatest(OLD.session_valid_after, clock_timestamp());
  ELSE
    NEW.session_valid_after := greatest(OLD.session_valid_after, NEW.session_valid_after);
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_authority ON cms.profiles;
CREATE TRIGGER protect_profile_authority BEFORE UPDATE ON cms.profiles
FOR EACH ROW EXECUTE FUNCTION cms.protect_profile_authority();

REVOKE ALL ON SCHEMA cms FROM PUBLIC;
REVOKE ALL ON cms.profiles FROM PUBLIC;
-- No seeded accounts, automatic bindings or enabled access. Import separately after review.

COMMIT;
