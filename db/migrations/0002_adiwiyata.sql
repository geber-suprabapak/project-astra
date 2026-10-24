-- Astra migration 0002: Adiwiyata reports and dedicated report-file purpose.
-- Operator-run only after a fresh, verified PostgreSQL backup and a reviewed
-- maintenance window. This file is not invoked by the application.
--
-- Lock plan: fail rather than wait indefinitely for the `files` check-constraint
-- replacement; SET lock_timeout bounds the table-lock wait to five seconds.
-- CREATE TABLE/INDEX work is bounded by the statement timeout below.
-- Report and verify/unverify share pg_advisory_xact_lock(hashtextextended(key, 0))
-- with key `adiwiyata-report:{classId}:{siteId}:{YYYY-MM-DD}`.
--
-- Rollback: do not drop report rows or file metadata. If deployment is rolled
-- back, keep these tables and the expanded purpose check; restore the prior
-- application image while retaining the additive schema for a forward repair.

\set ON_ERROR_STOP on

SET lock_timeout = '5s';
SET statement_timeout = '10min';
SET search_path TO public, pg_catalog;

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.files') IS NULL
       OR to_regclass('public.profiles') IS NULL
       OR to_regclass('public.schools') IS NULL
       OR to_regclass('public.classes') IS NULL THEN
        RAISE EXCEPTION 'Astra migration 0002 requires files, profiles, schools, and classes';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.files
        WHERE purpose NOT IN ('avatar', 'permit_attachment', 'face_enrollment', 'adiwiyata_report')
    ) THEN
        RAISE EXCEPTION 'Astra migration 0002 refuses unknown existing files.purpose values';
    END IF;

    IF to_regclass('public.adiwiyata_reports') IS NOT NULL AND EXISTS (
        SELECT required.column_name
        FROM (VALUES
            ('id'), ('site_id'), ('class_id'), ('reported_by'), ('file_id'),
            ('report_date'), ('created_at'), ('verified_at'), ('verified_by')
        ) AS required(column_name)
        WHERE NOT EXISTS (
            SELECT 1
            FROM information_schema.columns c
            WHERE c.table_schema = 'public'
              AND c.table_name = 'adiwiyata_reports'
              AND c.column_name = required.column_name
        )
    ) THEN
        RAISE EXCEPTION 'Existing public.adiwiyata_reports is incomplete';
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS adiwiyata_sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id),
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('tanaman', 'lele')),
    class_id UUID REFERENCES classes(id),
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_adiwiyata_sites_school ON adiwiyata_sites(school_id);
CREATE INDEX IF NOT EXISTS idx_adiwiyata_sites_class ON adiwiyata_sites(class_id);

CREATE TABLE IF NOT EXISTS adiwiyata_eligibility (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL UNIQUE REFERENCES profiles(user_id),
    added_by TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE files DROP CONSTRAINT IF EXISTS files_purpose_check;
ALTER TABLE files ADD CONSTRAINT files_purpose_check
    CHECK (purpose IN ('avatar', 'permit_attachment', 'face_enrollment', 'adiwiyata_report'));

CREATE TABLE IF NOT EXISTS adiwiyata_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID NOT NULL REFERENCES adiwiyata_sites(id),
    class_id UUID NOT NULL REFERENCES classes(id),
    reported_by TEXT NOT NULL REFERENCES profiles(user_id),
    file_id UUID NOT NULL,
    report_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at TIMESTAMPTZ,
    verified_by TEXT REFERENCES profiles(user_id),
    CONSTRAINT adiwiyata_reports_file_id_key UNIQUE (file_id),
    CONSTRAINT adiwiyata_reports_user_site_date_key UNIQUE (site_id, reported_by, report_date),
    CONSTRAINT adiwiyata_reports_file_fkey FOREIGN KEY (file_id) REFERENCES files(id)
);

CREATE INDEX IF NOT EXISTS idx_adiwiyata_reports_class_site_date
    ON adiwiyata_reports(class_id, site_id, report_date);
CREATE INDEX IF NOT EXISTS idx_adiwiyata_reports_reported_by
    ON adiwiyata_reports(reported_by);

COMMIT;
