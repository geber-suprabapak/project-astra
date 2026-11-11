-- Source-only native PKL schema. No production data or identity operations.
-- Review target, backup and recovery before applying; rollback preserves durable data.
\set ON_ERROR_STOP on
SET lock_timeout = '5s';
SET statement_timeout = '10min';
BEGIN;
CREATE SCHEMA IF NOT EXISTS pkl;
REVOKE ALL ON SCHEMA pkl FROM PUBLIC;

CREATE TABLE IF NOT EXISTS pkl.roster (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "nis" text NOT NULL,
  "nisn" text,
  "name" text NOT NULL,
  "jurusan" text NOT NULL,
  "class" text,
  "phone" text,
  "address" text,
  "gender" text,
  "birth_date" date,
  "birth_place" text,
  "is_active" boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
REVOKE ALL ON TABLE pkl.roster FROM PUBLIC;

CREATE TABLE IF NOT EXISTS pkl.academic_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "start_date" date,
  "end_date" date,
  "is_active" boolean NOT NULL,
  "is_published" boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
REVOKE ALL ON TABLE pkl.academic_years FROM PUBLIC;

CREATE TABLE IF NOT EXISTS pkl.industries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "address" text,
  "city" text,
  "province" text,
  "phone" text,
  "email" jsonb,
  "website" text,
  "contact_person" text,
  "contact_phone" text,
  "contact_email" jsonb,
  "industry_type" text NOT NULL DEFAULT 'Umum',
  "quota" numeric NOT NULL DEFAULT 0,
  "description" text,
  "logo" text,
  "is_published" boolean NOT NULL,
  "profile_id" uuid REFERENCES cms.profiles(id) ON DELETE RESTRICT,
  "bidang_usaha" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "partnership_since" date,
  "partnership_history" jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
REVOKE ALL ON TABLE pkl.industries FROM PUBLIC;
CREATE INDEX IF NOT EXISTS industries_profile_id_idx ON pkl.industries("profile_id");

CREATE TABLE IF NOT EXISTS pkl.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "nis" text NOT NULL,
  "nisn" text,
  "name" text NOT NULL,
  "class" text,
  "jurusan" text NOT NULL,
  "phone" text,
  "parent_name" text,
  "parent_phone" text,
  "email" jsonb,
  "is_published" boolean NOT NULL,
  "profile_id" uuid REFERENCES cms.profiles(id) ON DELETE RESTRICT,
  "siswa_id" uuid REFERENCES pkl.roster(id) ON DELETE RESTRICT,
  "address" text,
  "gender" text,
  "birth_date" date,
  "birth_place" text,
  "profile_completed" boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
REVOKE ALL ON TABLE pkl.students FROM PUBLIC;
CREATE INDEX IF NOT EXISTS students_profile_id_idx ON pkl.students("profile_id");
CREATE INDEX IF NOT EXISTS students_siswa_id_idx ON pkl.students("siswa_id");

CREATE TABLE IF NOT EXISTS pkl.supervisors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "nip" text,
  "phone" text,
  "email" jsonb,
  "jurusan" text,
  "max_students" numeric NOT NULL DEFAULT 10,
  "is_published" boolean NOT NULL,
  "profile_id" uuid REFERENCES cms.profiles(id) ON DELETE RESTRICT,
  "guru_staff_id" uuid REFERENCES cms.guru_staff(id) ON DELETE RESTRICT,
  "is_active" boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
REVOKE ALL ON TABLE pkl.supervisors FROM PUBLIC;
CREATE INDEX IF NOT EXISTS supervisors_profile_id_idx ON pkl.supervisors("profile_id");
CREATE INDEX IF NOT EXISTS supervisors_guru_staff_id_idx ON pkl.supervisors("guru_staff_id");

CREATE TABLE IF NOT EXISTS pkl.internships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "academic_year_id" uuid NOT NULL REFERENCES pkl.academic_years(id) ON DELETE RESTRICT,
  "student_id" uuid NOT NULL REFERENCES pkl.students(id) ON DELETE RESTRICT,
  "industry_id" uuid NOT NULL REFERENCES pkl.industries(id) ON DELETE RESTRICT,
  "supervisor_id" uuid REFERENCES pkl.supervisors(id) ON DELETE RESTRICT,
  "start_date" date,
  "end_date" date,
  "status" text NOT NULL DEFAULT 'pending',
  "notes" text,
  "supervisor_guru_id" uuid REFERENCES pkl.supervisors(id) ON DELETE RESTRICT,
  "instructor_dudi" text,
  "final_score" numeric,
  "grade" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
REVOKE ALL ON TABLE pkl.internships FROM PUBLIC;
CREATE INDEX IF NOT EXISTS internships_academic_year_id_idx ON pkl.internships("academic_year_id");
CREATE INDEX IF NOT EXISTS internships_student_id_idx ON pkl.internships("student_id");
CREATE INDEX IF NOT EXISTS internships_industry_id_idx ON pkl.internships("industry_id");
CREATE INDEX IF NOT EXISTS internships_supervisor_id_idx ON pkl.internships("supervisor_id");
CREATE INDEX IF NOT EXISTS internships_supervisor_guru_id_idx ON pkl.internships("supervisor_guru_id");

CREATE TABLE IF NOT EXISTS pkl.assessment_indicators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "description" text,
  "max_score" numeric NOT NULL DEFAULT 100,
  "category" text NOT NULL DEFAULT 'combined',
  "weight" numeric NOT NULL DEFAULT 1,
  "sort_order" numeric NOT NULL,
  "is_published" boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
REVOKE ALL ON TABLE pkl.assessment_indicators FROM PUBLIC;

CREATE TABLE IF NOT EXISTS pkl.assessment_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "internship_id" uuid NOT NULL REFERENCES pkl.internships(id) ON DELETE RESTRICT,
  "indicator_id" uuid NOT NULL REFERENCES pkl.assessment_indicators(id) ON DELETE RESTRICT,
  "supervisor_score" numeric,
  "industry_score" numeric,
  "final_score" numeric,
  "notes" text,
  "score_school" numeric,
  "score_industry" numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
REVOKE ALL ON TABLE pkl.assessment_scores FROM PUBLIC;
CREATE INDEX IF NOT EXISTS assessment_scores_internship_id_idx ON pkl.assessment_scores("internship_id");
CREATE INDEX IF NOT EXISTS assessment_scores_indicator_id_idx ON pkl.assessment_scores("indicator_id");

CREATE TABLE IF NOT EXISTS pkl.daily_journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "internship_id" uuid NOT NULL REFERENCES pkl.internships(id) ON DELETE RESTRICT,
  "date" date NOT NULL,
  "description" text,
  "activities" text,
  "status" text NOT NULL DEFAULT 'draft',
  "supervisor_notes" text,
  "activity" text,
  "documentation_url" text,
  "photo_url" text,
  "status_attendance" text NOT NULL DEFAULT 'hadir',
  "verification_status" text NOT NULL DEFAULT 'pending',
  "created_by" uuid REFERENCES cms.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
REVOKE ALL ON TABLE pkl.daily_journals FROM PUBLIC;
CREATE INDEX IF NOT EXISTS daily_journals_internship_id_idx ON pkl.daily_journals("internship_id");

CREATE TABLE IF NOT EXISTS pkl.certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "internship_id" uuid NOT NULL REFERENCES pkl.internships(id) ON DELETE RESTRICT,
  "certificate_number" text NOT NULL,
  "issue_date" date NOT NULL,
  "signed_by" text,
  "signed_title" text,
  "notes" text,
  "issued_date" date,
  "status" text NOT NULL DEFAULT 'draft',
  "final_score" numeric,
  "grade" text,
  "scan_pdf_url" text,
  "validation_code" text UNIQUE,
  "email_sent_at" timestamptz,
  "email_message_id" text,
  "scan_uploaded_at" timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
REVOKE ALL ON TABLE pkl.certificates FROM PUBLIC;
CREATE INDEX IF NOT EXISTS certificates_internship_id_idx ON pkl.certificates("internship_id");

CREATE TABLE IF NOT EXISTS pkl.registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "student_id" uuid NOT NULL REFERENCES pkl.students(id) ON DELETE RESTRICT,
  "academic_year_id" uuid NOT NULL REFERENCES pkl.academic_years(id) ON DELETE RESTRICT,
  "industry_id" uuid REFERENCES pkl.industries(id) ON DELETE RESTRICT,
  "is_self_proposed" boolean NOT NULL DEFAULT false,
  "proposed_industry_name" text,
  "proposed_industry_address" text,
  "proposed_industry_contact" text,
  "proposed_industry_phone" text,
  "proposed_industry_email" text,
  "proposed_acceptance_letter" text,
  "motivation" text,
  "preferred_supervisor_name" text,
  "start_date_preferred" date,
  "status" text NOT NULL DEFAULT 'BELUM_DAFTAR',
  "accepted_industry_id" uuid REFERENCES pkl.industries(id) ON DELETE RESTRICT,
  "accepted_at" timestamptz,
  "accepted_by" uuid REFERENCES cms.profiles(id) ON DELETE RESTRICT,
  "reviewed_by" uuid REFERENCES cms.profiles(id) ON DELETE RESTRICT,
  "reviewed_at" timestamptz,
  "review_notes" text,
  "rejection_reason" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
REVOKE ALL ON TABLE pkl.registrations FROM PUBLIC;
CREATE INDEX IF NOT EXISTS registrations_student_id_idx ON pkl.registrations("student_id");
CREATE INDEX IF NOT EXISTS registrations_academic_year_id_idx ON pkl.registrations("academic_year_id");
CREATE INDEX IF NOT EXISTS registrations_industry_id_idx ON pkl.registrations("industry_id");

CREATE TABLE IF NOT EXISTS pkl.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "student_id" uuid NOT NULL REFERENCES pkl.students(id) ON DELETE RESTRICT,
  "academic_year_id" uuid NOT NULL REFERENCES pkl.academic_years(id) ON DELETE RESTRICT,
  "industry_id" uuid REFERENCES pkl.industries(id) ON DELETE RESTRICT,
  "preferred_industry_name" text,
  "preferred_supervisor_name" text,
  "motivation" text,
  "start_date_preferred" date,
  "status" text NOT NULL DEFAULT 'pending',
  "reviewed_by" uuid REFERENCES cms.profiles(id) ON DELETE RESTRICT,
  "reviewed_at" timestamptz,
  "review_notes" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
REVOKE ALL ON TABLE pkl.applications FROM PUBLIC;
CREATE INDEX IF NOT EXISTS applications_student_id_idx ON pkl.applications("student_id");
CREATE INDEX IF NOT EXISTS applications_academic_year_id_idx ON pkl.applications("academic_year_id");
CREATE INDEX IF NOT EXISTS applications_industry_id_idx ON pkl.applications("industry_id");

CREATE TABLE IF NOT EXISTS pkl.attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "internship_id" uuid NOT NULL REFERENCES pkl.internships(id) ON DELETE RESTRICT,
  "student_id" uuid NOT NULL REFERENCES pkl.students(id) ON DELETE RESTRICT,
  "date" date NOT NULL,
  "check_in_lat" numeric,
  "check_in_lng" numeric,
  "check_out_lat" numeric,
  "check_out_lng" numeric,
  "status" text NOT NULL DEFAULT 'HADIR',
  "notes" text,
  "photo_url" text,
  "created_by" uuid REFERENCES cms.profiles(id) ON DELETE RESTRICT,
  "check_in_at" timestamptz,
  "check_out_at" timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
REVOKE ALL ON TABLE pkl.attendance FROM PUBLIC;
CREATE INDEX IF NOT EXISTS attendance_internship_id_idx ON pkl.attendance("internship_id");
CREATE INDEX IF NOT EXISTS attendance_student_id_idx ON pkl.attendance("student_id");

CREATE TABLE IF NOT EXISTS pkl.monitoring (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "internship_id" uuid NOT NULL REFERENCES pkl.internships(id) ON DELETE RESTRICT,
  "supervisor_id" uuid NOT NULL REFERENCES pkl.supervisors(id) ON DELETE RESTRICT,
  "scheduled_date" date NOT NULL,
  "visit_date" date,
  "notes" text,
  "visit_notes" text,
  "evaluation" text,
  "photo_urls" text[] NOT NULL DEFAULT '{}'::text[],
  "status" text NOT NULL DEFAULT 'scheduled',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
REVOKE ALL ON TABLE pkl.monitoring FROM PUBLIC;
CREATE INDEX IF NOT EXISTS monitoring_internship_id_idx ON pkl.monitoring("internship_id");
CREATE INDEX IF NOT EXISTS monitoring_supervisor_id_idx ON pkl.monitoring("supervisor_id");

CREATE TABLE IF NOT EXISTS pkl.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "student_id" uuid NOT NULL REFERENCES pkl.students(id) ON DELETE RESTRICT,
  "internship_id" uuid REFERENCES pkl.internships(id) ON DELETE RESTRICT,
  "registration_id" uuid REFERENCES pkl.registrations(id) ON DELETE RESTRICT,
  "doc_type" text NOT NULL,
  "title" text NOT NULL,
  "file_url" text NOT NULL,
  "file_size" integer,
  "mime_type" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
REVOKE ALL ON TABLE pkl.documents FROM PUBLIC;
CREATE INDEX IF NOT EXISTS documents_student_id_idx ON pkl.documents("student_id");
CREATE INDEX IF NOT EXISTS documents_internship_id_idx ON pkl.documents("internship_id");
CREATE INDEX IF NOT EXISTS documents_registration_id_idx ON pkl.documents("registration_id");

CREATE TABLE IF NOT EXISTS pkl.journal_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "journal_id" uuid NOT NULL REFERENCES pkl.daily_journals(id) ON DELETE RESTRICT,
  "comment" text NOT NULL,
  "commenter_id" uuid NOT NULL REFERENCES cms.profiles(id) ON DELETE RESTRICT,
  "commenter_role" text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
REVOKE ALL ON TABLE pkl.journal_comments FROM PUBLIC;
CREATE INDEX IF NOT EXISTS journal_comments_journal_id_idx ON pkl.journal_comments("journal_id");

CREATE TABLE IF NOT EXISTS pkl.status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "registration_id" uuid NOT NULL REFERENCES pkl.registrations(id) ON DELETE RESTRICT,
  "from_status" text,
  "to_status" text NOT NULL,
  "changed_by" uuid NOT NULL REFERENCES cms.profiles(id) ON DELETE RESTRICT,
  "changed_by_role" text NOT NULL,
  "notes" text,
  "changed_at" timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
REVOKE ALL ON TABLE pkl.status_history FROM PUBLIC;
CREATE INDEX IF NOT EXISTS status_history_registration_id_idx ON pkl.status_history("registration_id");

CREATE TABLE IF NOT EXISTS pkl.industry_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "industry_id" uuid NOT NULL REFERENCES pkl.industries(id) ON DELETE RESTRICT,
  "profile_id" uuid NOT NULL REFERENCES cms.profiles(id) ON DELETE RESTRICT,
  "access_enabled" boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
REVOKE ALL ON TABLE pkl.industry_accounts FROM PUBLIC;
CREATE INDEX IF NOT EXISTS industry_accounts_industry_id_idx ON pkl.industry_accounts("industry_id");
CREATE INDEX IF NOT EXISTS industry_accounts_profile_id_idx ON pkl.industry_accounts("profile_id");

CREATE TABLE IF NOT EXISTS pkl.certificate_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT false,
  "image_url" text NOT NULL,
  "template_data" jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
REVOKE ALL ON TABLE pkl.certificate_templates FROM PUBLIC;
CREATE UNIQUE INDEX IF NOT EXISTS students_identity_idx ON pkl.students(nis) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS roster_identity_idx ON pkl.roster(nis) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS students_identity_idx_profile ON pkl.students(profile_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS supervisors_identity_idx_profile ON pkl.supervisors(profile_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS internships_identity_idx ON pkl.internships(student_id, academic_year_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS assessment_scores_identity_idx ON pkl.assessment_scores(internship_id, indicator_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS attendance_identity_idx ON pkl.attendance(student_id, date) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS industry_accounts_identity_idx ON pkl.industry_accounts(industry_id, profile_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS certificates_identity_idx ON pkl.certificates(certificate_number) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS certificate_templates_active_idx ON pkl.certificate_templates(is_active) WHERE is_active = true AND deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS pkl.audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES cms.profiles(id) ON DELETE RESTRICT,
  actor_role text NOT NULL, resource text NOT NULL, record_id uuid NOT NULL, action text NOT NULL,
  before_data jsonb, after_data jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE pkl.audit FROM PUBLIC;

ALTER TABLE pkl.documents ADD COLUMN IF NOT EXISTS uploaded_by uuid REFERENCES cms.profiles(id) ON DELETE RESTRICT;
ALTER TABLE pkl.supervisors ADD COLUMN IF NOT EXISTS employee_id text;
ALTER TABLE pkl.supervisors ADD COLUMN IF NOT EXISTS specialization text;
ALTER TABLE pkl.students ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE pkl.daily_journals ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE pkl.assessment_indicators ADD COLUMN IF NOT EXISTS jurusan text;
ALTER TABLE pkl.assessment_scores ADD COLUMN IF NOT EXISTS score numeric;
ALTER TABLE pkl.assessment_scores ADD COLUMN IF NOT EXISTS assessor_type text;
ALTER TABLE pkl.industries ADD COLUMN IF NOT EXISTS supervisor_id uuid REFERENCES pkl.supervisors(id) ON DELETE RESTRICT;

COMMIT;
