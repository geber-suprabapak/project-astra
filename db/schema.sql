-- ============================================================================
-- Skanida Platform — Project Astra Greenfield PostgreSQL Schema
-- ============================================================================
-- Owns: School configuration, academic periods, classes, Student/Staff profiles,
-- Class Enrollment, schedules, Location/Geofence, Attendance, Attendance Attempts,
-- Leave Requests, Files metadata, Notification Outbox, and Audit Logs.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- Table: schools
-- Description: School organization configuration
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    signup_open BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Table: academic_periods
-- Description: Academic periods (e.g. 2026/2027 Ganjil)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS academic_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Table: classes
-- Description: Class rooms / study groups (e.g. XII RPL 1)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS classes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
    academic_period_id UUID REFERENCES academic_periods(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    grade INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Table: students
-- Description: Canonical roster students, independent of authentication
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nis TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    gender TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT students_gender_check CHECK (gender IN ('L', 'P'))
);

-- ----------------------------------------------------------------------------
-- Table: profiles
-- Description: Identity-bound Student, Staff, and Administrator profiles
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL UNIQUE,
    full_name TEXT,
    email TEXT,
    nis TEXT UNIQUE,
    class_name TEXT,
    absence_number TEXT,
    avatar_url TEXT,
    notification_token TEXT,
    role TEXT NOT NULL DEFAULT 'student',
    gender TEXT,
    lifecycle_status TEXT NOT NULL DEFAULT 'approved',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT profiles_role_check CHECK (role IN ('platform_admin', 'school_admin', 'teacher', 'student', 'staff')),
    CONSTRAINT profiles_lifecycle_check CHECK (lifecycle_status IN ('pending', 'approved', 'rejected', 'disabled'))
);

CREATE TABLE IF NOT EXISTS legacy_identity_mappings (
  legacy_user_id uuid PRIMARY KEY,
  target_user_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
 
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notification_token TEXT;

CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_nis ON profiles(nis);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- ----------------------------------------------------------------------------
-- Tables: Adiwiyata Sites and Student eligibility
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- Table: class_enrollments
-- Description: Time-bounded association of a Student to a class in an academic period
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS class_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES profiles(user_id) ON DELETE CASCADE,
    class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
    academic_period_id UUID REFERENCES academic_periods(id) ON DELETE CASCADE,
    absence_number TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT class_enrollments_status_check CHECK (status IN ('active', 'transferred', 'promoted', 'graduated', 'archived')),
    CONSTRAINT class_enrollments_owner_check CHECK (student_id IS NOT NULL OR user_id IS NOT NULL),
    CONSTRAINT class_enrollments_absence_number_check
        CHECK (absence_number IS NULL OR absence_number ~ '^[1-9][0-9]*$')
);

-- Additive compatibility for databases created before canonical Students.
-- These columns must exist before the indexes below are created.
ALTER TABLE class_enrollments ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES students(id) ON DELETE CASCADE;
ALTER TABLE class_enrollments ADD COLUMN IF NOT EXISTS absence_number TEXT;
ALTER TABLE class_enrollments ALTER COLUMN user_id DROP NOT NULL;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'class_enrollments'::regclass
          AND conname = 'class_enrollments_absence_number_check'
    ) THEN
        -- NOT VALID preserves historical anomalies while enforcing canonical
        -- positive values on every new or updated enrollment.
        ALTER TABLE class_enrollments
            ADD CONSTRAINT class_enrollments_absence_number_check
            CHECK (absence_number IS NULL OR absence_number ~ '^[1-9][0-9]*$')
            NOT VALID;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_class_enrollments_user_period ON class_enrollments(user_id, academic_period_id);
CREATE INDEX IF NOT EXISTS idx_class_enrollments_student_period ON class_enrollments(student_id, academic_period_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_class_enrollment ON class_enrollments(user_id, academic_period_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_student_class_enrollment ON class_enrollments(student_id, academic_period_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_class_absence_number ON class_enrollments(class_id, academic_period_id, absence_number)
    WHERE status = 'active' AND absence_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_class_enrollments_class ON class_enrollments(class_id);
CREATE INDEX IF NOT EXISTS idx_class_enrollments_status ON class_enrollments(status);

-- ----------------------------------------------------------------------------
-- Table: student_bindings
-- Description: Optional audited binding between a Student and an identity
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_bindings (
    student_id UUID PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL UNIQUE REFERENCES profiles(user_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Table: roster_reports
-- Description: Staged student roster validation reports and review states
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roster_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
    academic_period_id UUID REFERENCES academic_periods(id) ON DELETE RESTRICT,
    total_rows INTEGER NOT NULL DEFAULT 0,
    valid_rows INTEGER NOT NULL DEFAULT 0,
    rejected_rows INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'staged',
    review_state TEXT NOT NULL DEFAULT 'pending',
    rows JSONB NOT NULL DEFAULT '[]'::jsonb,
    rejected_items JSONB NOT NULL DEFAULT '[]'::jsonb,
    accepted_at TIMESTAMPTZ,
    accepted_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT roster_reports_status_check CHECK (status IN ('staged', 'accepted', 'rejected')),
    CONSTRAINT roster_reports_review_state_check CHECK (review_state IN ('pending', 'accepted', 'rejected'))
);

ALTER TABLE roster_reports ADD COLUMN IF NOT EXISTS academic_period_id UUID REFERENCES academic_periods(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_roster_reports_school ON roster_reports(school_id);
CREATE INDEX IF NOT EXISTS idx_roster_reports_status ON roster_reports(status);

-- ----------------------------------------------------------------------------
-- Table: locations
-- Description: Geofence locations for physical attendance validation
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    radius_meters DOUBLE PRECISION NOT NULL DEFAULT 100.0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_locations_school ON locations(school_id);
CREATE INDEX IF NOT EXISTS idx_locations_active ON locations(is_active);

-- ----------------------------------------------------------------------------
-- Table: schedules
-- Description: Daily attendance time windows and grace periods in Asia/Jakarta
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
    class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
    academic_period_id UUID REFERENCES academic_periods(id) ON DELETE CASCADE,
    location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    day_of_week TEXT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    start_checkout TIME NOT NULL,
    end_checkout TIME NOT NULL,
    grace_period_minutes INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT schedules_day_of_week_check CHECK (day_of_week IN ('senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu'))
);

CREATE INDEX IF NOT EXISTS idx_schedules_day_active ON schedules(day_of_week, is_active);
CREATE INDEX IF NOT EXISTS idx_schedules_class_day ON schedules(class_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_schedules_period_day ON schedules(academic_period_id, day_of_week);

-- ----------------------------------------------------------------------------
-- Table: calendar_exceptions
-- Description: School calendar exceptions and holidays
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calendar_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
    academic_period_id UUID REFERENCES academic_periods(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    reason TEXT NOT NULL,
    is_holiday BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_exceptions_date ON calendar_exceptions(date);
CREATE INDEX IF NOT EXISTS idx_calendar_exceptions_period ON calendar_exceptions(academic_period_id);

-- ----------------------------------------------------------------------------
-- Table: attendances
-- Description: Student attendance records for check-in and check-out
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    status TEXT NOT NULL,
    action_type TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT attendances_status_check CHECK (status IN ('Hadir', 'Terlambat', 'Pulang', 'Alpha')),
    CONSTRAINT attendances_action_type_check CHECK (action_type IS NULL OR action_type IN ('check_in', 'check_out'))
);

CREATE INDEX IF NOT EXISTS idx_attendances_user_date ON attendances(user_id, date);
CREATE INDEX IF NOT EXISTS idx_attendances_created_at ON attendances(created_at);

-- ----------------------------------------------------------------------------
-- Table: attendance_attempts
-- Description: Face verification and manual attendance attempt audit trail
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
    action_type TEXT NOT NULL,
    status TEXT NOT NULL,
    reason TEXT,
    quality_score DOUBLE PRECISION,
    confidence DOUBLE PRECISION,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    process_time_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT attendance_attempts_action_type_check CHECK (action_type IN ('check_in', 'check_out')),
    CONSTRAINT attendance_attempts_status_check CHECK (status IN ('success', 'failed', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_attendance_attempts_user ON attendance_attempts(user_id);

-- ----------------------------------------------------------------------------
-- Table: leave_requests
-- Description: Student permission and leave requests with attachments
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    description TEXT,
    status BOOLEAN NOT NULL DEFAULT true,
    attachment_url TEXT,
    date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approval_status TEXT NOT NULL DEFAULT 'pending',
    rejection_reason TEXT,
    rejected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT leave_requests_category_check CHECK (category IN ('sakit', 'pergi', 'dispensasi', 'lainnya')),
    CONSTRAINT leave_requests_approval_status_check CHECK (approval_status IN ('pending', 'approved', 'rejected'))
);

ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS original_end_date DATE;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS effective_end_date DATE;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS duration_days INTEGER;
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_duration_days_check;
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_duration_days_check
    CHECK (duration_days IS NULL OR duration_days BETWEEN 1 AND 30);

CREATE INDEX IF NOT EXISTS idx_leave_requests_user_date ON leave_requests(user_id, date);
CREATE INDEX IF NOT EXISTS idx_leave_requests_approval ON leave_requests(approval_status);

-- ----------------------------------------------------------------------------
-- Table: files
-- Description: Astra-owned file metadata and lifecycle tracking
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
    purpose TEXT NOT NULL,
    object_path TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes BIGINT,
    lifecycle TEXT NOT NULL DEFAULT 'available',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT files_purpose_check CHECK (purpose IN ('avatar', 'permit_attachment', 'face_enrollment', 'adiwiyata_report')),
    CONSTRAINT files_lifecycle_check CHECK (lifecycle IN ('pending_upload', 'available', 'rejected', 'deleted'))
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

CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id);
CREATE INDEX IF NOT EXISTS idx_files_lifecycle ON files(lifecycle);

-- ----------------------------------------------------------------------------
-- Table: face_enrollments
-- Description: Student face enrollment lifecycle and sample counts
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS face_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'enrolled',
    sample_count INTEGER NOT NULL DEFAULT 10,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT face_enrollments_status_check CHECK (status IN ('not_enrolled', 'pending', 'enrolled', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_face_enrollments_user ON face_enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_face_enrollments_status ON face_enrollments(status);


-- ----------------------------------------------------------------------------
-- Table: notification_outbox
-- Description: Transactional outbox for asynchronous notification delivery
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT notification_outbox_channel_check CHECK (channel IN ('push', 'email')),
    CONSTRAINT notification_outbox_status_check CHECK (status IN ('pending', 'processing', 'delivered', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_status_next ON notification_outbox(status, next_retry_at);

-- ----------------------------------------------------------------------------
-- Table: audit_logs
-- Description: Platform domain action audit logs
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
-- ----------------------------------------------------------------------------
-- Table: password_reset_codes
-- Description: Offline one-time password reset codes for student account recovery
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_reset_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT false,
    used_at TIMESTAMPTZ,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_codes_user ON password_reset_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_codes_code ON password_reset_codes(code);

-- ----------------------------------------------------------------------------
-- Table: roles
-- Description: Global RBAC roles defined by platform administrator
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_roles_name ON roles(name);
CREATE INDEX IF NOT EXISTS idx_roles_is_active ON roles(is_active);

-- ----------------------------------------------------------------------------
-- Table: permissions
-- Description: Global API permissions defined by platform administrator
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_permissions_name ON permissions(name);

-- ----------------------------------------------------------------------------
-- Table: role_permissions
-- Description: Mapping of permissions to roles
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_role_permission UNIQUE (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_id);

-- ----------------------------------------------------------------------------
-- Table: user_roles
-- Description: Multi-role assignments for users
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_role UNIQUE (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);

-- ----------------------------------------------------------------------------
-- Table: revoked_sessions
-- Description: Revoked user sessions following critical RBAC or profile changes
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS revoked_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_revoked_sessions_user ON revoked_sessions(user_id);

-- ----------------------------------------------------------------------------
-- Default Seed Data
-- ----------------------------------------------------------------------------

-- Default Campus Geofence Location
INSERT INTO locations (id, name, latitude, longitude, radius_meters, is_active)
VALUES ('a0000000-0000-0000-0000-000000000001', 'School Campus', -6.200000, 106.816666, 500.0, true)
ON CONFLICT (id) DO NOTHING;

-- Default Schedules (Monday to Friday, Saturday)
INSERT INTO schedules (id, day_of_week, start_time, end_time, start_checkout, end_checkout, grace_period_minutes, is_active)
VALUES
  ('b0000000-0000-0000-0000-000000000001', 'senin', '06:00:00', '07:15:00', '15:00:00', '18:00:00', 15, true),
  ('b0000000-0000-0000-0000-000000000002', 'selasa', '06:00:00', '07:15:00', '15:00:00', '18:00:00', 15, true),
  ('b0000000-0000-0000-0000-000000000003', 'rabu', '06:00:00', '07:15:00', '15:00:00', '18:00:00', 15, true),
  ('b0000000-0000-0000-0000-000000000004', 'kamis', '06:00:00', '07:15:00', '15:00:00', '18:00:00', 15, true),
  ('b0000000-0000-0000-0000-000000000005', 'jumat', '06:00:00', '07:15:00', '11:30:00', '14:00:00', 15, true),
  ('b0000000-0000-0000-0000-000000000006', 'sabtu', '06:00:00', '07:15:00', '12:00:00', '15:00:00', 15, true)
ON CONFLICT (id) DO NOTHING;

-- Default Roles
INSERT INTO roles (id, name, description, is_active)
VALUES
  ('c0000000-0000-0000-0000-000000000001', 'platform_admin', 'Platform Administrator with full access', true),
  ('c0000000-0000-0000-0000-000000000002', 'school_admin', 'School Administrator for school-level operations', true),
  ('c0000000-0000-0000-0000-000000000003', 'teacher', 'Teacher with attendance and leave management access', true),
  ('c0000000-0000-0000-0000-000000000004', 'staff', 'General staff with operational read access', true),
  ('c0000000-0000-0000-0000-000000000005', 'student', 'Student with attendance check-in and leave submission access', true)
ON CONFLICT (id) DO NOTHING;

-- Default Permissions
INSERT INTO permissions (id, name, description)
VALUES
  ('d0000000-0000-0000-0000-000000000001', 'admin:read', 'Read administrative state and session'),
  ('d0000000-0000-0000-0000-000000000002', 'admin:write', 'Write administrative configuration'),
  ('d0000000-0000-0000-0000-000000000003', 'roles:manage', 'Create and modify roles and permissions'),
  ('d0000000-0000-0000-0000-000000000004', 'staff:manage', 'Create and manage staff members and assign roles'),
  ('d0000000-0000-0000-0000-000000000005', 'student:manage', 'Manage student profiles and approvals'),
  ('d0000000-0000-0000-0000-000000000006', 'roster:manage', 'Stage and review student roster imports'),
  ('d0000000-0000-0000-0000-000000000007', 'attendance:read', 'View attendance records'),
  ('d0000000-0000-0000-0000-000000000008', 'attendance:write', 'Submit attendance check-in/out'),
  ('d0000000-0000-0000-0000-000000000009', 'attendance:manual', 'Record manual attendance exceptions'),
  ('d0000000-0000-0000-0000-000000000010', 'leave:read', 'View leave requests'),
  ('d0000000-0000-0000-0000-000000000011', 'leave:submit', 'Submit leave requests'),
  ('d0000000-0000-0000-0000-000000000012', 'leave:approve', 'Approve or reject leave requests'),
  ('d0000000-0000-0000-0000-000000000013', 'profile:read', 'View profile information'),
  ('d0000000-0000-0000-0000-000000000014', 'profile:write', 'Update profile information')
ON CONFLICT (id) DO NOTHING;

-- Default Role-Permissions
INSERT INTO role_permissions (id, role_id, permission_id)
VALUES
  ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002'),
  ('e0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003'),
  ('e0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000004'),
  ('e0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000005'),
  ('e0000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000006'),
  ('e0000000-0000-0000-0000-000000000007', 'c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-000000000008', 'c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000004'),
  ('e0000000-0000-0000-0000-000000000009', 'c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000005'),
  ('e0000000-0000-0000-0000-000000000010', 'c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000006'),
  ('e0000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000007'),
  ('e0000000-0000-0000-0000-000000000012', 'c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000009'),
  ('e0000000-0000-0000-0000-000000000013', 'c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000010'),
  ('e0000000-0000-0000-0000-000000000014', 'c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000012'),
  ('e0000000-0000-0000-0000-000000000015', 'c0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000007'),
  ('e0000000-0000-0000-0000-000000000016', 'c0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000009'),
  ('e0000000-0000-0000-0000-000000000017', 'c0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000010'),
  ('e0000000-0000-0000-0000-000000000018', 'c0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000012'),
  ('e0000000-0000-0000-0000-000000000019', 'c0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000007'),
  ('e0000000-0000-0000-0000-000000000020', 'c0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000010'),
  ('e0000000-0000-0000-0000-000000000021', 'c0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000007'),
  ('e0000000-0000-0000-0000-000000000022', 'c0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000008'),
  ('e0000000-0000-0000-0000-000000000023', 'c0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000010'),
  ('e0000000-0000-0000-0000-000000000024', 'c0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000011')
ON CONFLICT (id) DO NOTHING;

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

-- CMS content domain
-- Additive source-only CMS tables. No seed, import, account or existing domain mutation.
-- Apply only after reviewing the actual target and recovery plan.
-- Rollback retains the tables/data; restore the previous compatible application image.

CREATE TABLE IF NOT EXISTS cms.guru_staff (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL, role TEXT, image TEXT, nip TEXT,
    email TEXT, phone TEXT,
    category TEXT DEFAULT 'Guru',
    jurusan TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  "page" TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.jurusan (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL, short_name TEXT NOT NULL, description TEXT,
    image TEXT, icon TEXT DEFAULT 'GraduationCap',
    highlights JSONB DEFAULT '[]',
    careers JSONB DEFAULT '[]',
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cms.agenda (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, description TEXT, date TEXT NOT NULL,
    time TEXT, location TEXT, category TEXT DEFAULT 'Umum',
    image TEXT,
    is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
  "page" TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.akreditasi (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, issuer TEXT, year TEXT, grade TEXT,
    description TEXT, document_url TEXT, image TEXT,
    is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.alumni_inspiratif (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL, graduation_year TEXT NOT NULL,
    achievement TEXT NOT NULL, photo TEXT, company TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.bank_soal (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, description TEXT, file_url TEXT,
    subject TEXT,
    jurusan TEXT,
    mapel TEXT,
    tipe TEXT DEFAULT 'Umum',
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.beasiswa (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL, provider TEXT, description TEXT, requirements TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.berita (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
    excerpt TEXT, content TEXT, image TEXT,
    category TEXT DEFAULT 'Umum',
    author TEXT DEFAULT 'Redaksi SMKN 2 Magelang',
    is_published BOOLEAN DEFAULT false,
    published_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
  "page" TEXT
);

CREATE TABLE IF NOT EXISTS cms.bkk_lowongan (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, company TEXT NOT NULL, location TEXT,
    type TEXT, deadline TEXT, description TEXT,
    is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.download_dokumen (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL, type TEXT DEFAULT 'PDF', size TEXT,
    file_url TEXT NOT NULL, category TEXT DEFAULT 'Umum',
    description TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.ekstrakurikuler (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL, category TEXT DEFAULT 'Umum',
    description TEXT, image TEXT, pembina TEXT, schedule TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.fasilitas_praktik (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    jurusan TEXT NOT NULL, name TEXT NOT NULL, description TEXT,
    image TEXT, capacity TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  "jurusan_id" UUID REFERENCES cms.jurusan(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.galeri (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, image TEXT NOT NULL,
    category TEXT DEFAULT 'Gambar', date TEXT, description TEXT,
    jurusan TEXT,        
    media_type TEXT DEFAULT 'gambar',
    is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
  "page" TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.guru_produktif (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    jurusan TEXT NOT NULL, name TEXT NOT NULL, title TEXT,
    photo TEXT, subjects TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  "jurusan_id" UUID REFERENCES cms.jurusan(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.guru_tamu (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL, company TEXT NOT NULL, topic TEXT, date TEXT,
    is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.hero_slides (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, subtitle TEXT, image TEXT NOT NULL,
    cta_label TEXT, cta_href TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
  "page" TEXT
);

CREATE TABLE IF NOT EXISTS cms.jadwal_pelajaran (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "title" TEXT,
  "jurusan" TEXT,
  "kelas" TEXT,
  "day" TEXT,
  "time_start" TEXT,
  "time_end" TEXT,
  "subject" TEXT,
  "teacher" TEXT,
  "room" TEXT,
  "sort_order" INTEGER,
  "is_published" BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.jadwal_ujian (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, date TEXT NOT NULL, time TEXT,
    duration TEXT, room TEXT, category TEXT DEFAULT 'Umum',
    type TEXT DEFAULT 'Sumatif',
    date_start TEXT,
    date_end TEXT,
    kelas TEXT,
    file_url TEXT,
    description TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.jurusan_berita (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    jurusan TEXT NOT NULL, title TEXT NOT NULL, description TEXT,
    image TEXT, tag TEXT DEFAULT 'Kegiatan', date TEXT NOT NULL,
    is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
  "jurusan_id" UUID REFERENCES cms.jurusan(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.jurusan_produk (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    jurusan TEXT NOT NULL, title TEXT NOT NULL, description TEXT,
    image TEXT, tech TEXT, made_by TEXT,
    is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
  "jurusan_id" UUID REFERENCES cms.jurusan(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.kalender_akademik (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    month TEXT NOT NULL, year_label TEXT NOT NULL,
    events JSONB DEFAULT '[]',
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.keunggulan (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, description TEXT, icon TEXT, image TEXT,
    stat TEXT, href TEXT, category TEXT DEFAULT 'card'
              CHECK (category = ANY (ARRAY['card', 'highlight'])),
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  "page" TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.keunggulan_sekolah (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    badge TEXT,
    icon TEXT DEFAULT 'Star',
    color TEXT DEFAULT 'blue',
    href TEXT,
    highlights JSONB DEFAULT '[]',
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.kkm (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    jurusan TEXT NOT NULL, mapel TEXT NOT NULL, kkm TEXT NOT NULL,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  "subject" TEXT,
  "grade_level" TEXT,
  "kkm_value" NUMERIC,
  "year" TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.kriteria_kelulusan (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "title" TEXT,
  "description" TEXT,
  "points" JSONB,
  "year_academic" TEXT,
  "sort_order" INTEGER,
  "is_published" BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.kurikulum (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, description TEXT,
    category TEXT DEFAULT 'Umum',
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.layanan (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL, label TEXT, description TEXT, href TEXT NOT NULL,
    image TEXT, image_position TEXT DEFAULT '50% 50%',
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.lsp (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  image TEXT,
  document_url TEXT,
  sort_order INTEGER DEFAULT 0,
  is_published BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.materi_pembelajaran (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, description TEXT, file_url TEXT,
    subject TEXT,
    jurusan TEXT,
    kelas TEXT,
    mapel TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.mitra_dudi (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL, logo TEXT, category TEXT DEFAULT 'Umum',
    description TEXT, website TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.mitra_industri_jurusan (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    jurusan TEXT NOT NULL, name TEXT NOT NULL, logo TEXT,
    category TEXT DEFAULT 'Umum',
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  "jurusan_id" UUID REFERENCES cms.jurusan(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.mou_kerjasama (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    partner TEXT NOT NULL, scope TEXT, year TEXT NOT NULL,
    document_url TEXT, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.organisasi (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL, description TEXT,
    category TEXT DEFAULT 'organisasi',
    image TEXT, ketua TEXT, pembina TEXT,
    "order" INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  "page" TEXT,
  "sort_order" INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.poin_pelanggaran (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, description TEXT, poin INTEGER DEFAULT 0,
    violation TEXT,
    points INTEGER DEFAULT 5,
    category TEXT DEFAULT 'Ringan',
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.prestasi (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    level TEXT DEFAULT 'Sekolah',
    year TEXT NOT NULL, category TEXT DEFAULT 'Akademik',
    description TEXT, image TEXT,
    is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
  "page" TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.prestasi_jurusan (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    jurusan TEXT NOT NULL, title TEXT NOT NULL,
    level TEXT DEFAULT 'Sekolah', year TEXT NOT NULL,
    category TEXT DEFAULT 'Akademik', description TEXT, image TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  "jurusan_id" UUID REFERENCES cms.jurusan(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.sarpras (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, description TEXT, image TEXT, capacity TEXT,
    category TEXT DEFAULT 'Umum',
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  "page" TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.school_info (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    school_name TEXT DEFAULT 'SMKN 2 Magelang',
    school_tagline TEXT DEFAULT 'SMK Pusat Keunggulan',
    npsn TEXT, nss TEXT,
    principal_name TEXT DEFAULT 'Kepala Sekolah',
    principal_title TEXT DEFAULT 'Kepala SMKN 2 Magelang',
    principal_photo TEXT, principal_greeting TEXT,
    principal_greeting_title TEXT DEFAULT 'Membangun Generasi Unggul & Berkarakter',
    address TEXT DEFAULT 'Jl. Jend. A. Yani No. 135A, Magelang, Jawa Tengah 56111',
    phone TEXT DEFAULT '(0293) 362-137',
    email TEXT DEFAULT 'info@smkn2magelang.sch.id',
    whatsapp TEXT,
    operating_hours TEXT DEFAULT 'Senin – Sabtu, 07:00 – 15:00 WIB',
    maps_embed_url TEXT, maps_link TEXT DEFAULT 'https://maps.google.com',
    instagram_url TEXT, youtube_url TEXT, facebook_url TEXT, tiktok_url TEXT,
    stat_founded TEXT DEFAULT '1965', stat_students TEXT DEFAULT '1.200+',
    stat_teachers TEXT DEFAULT '85', stat_programs TEXT DEFAULT '4',
    stat_graduation_rate TEXT DEFAULT '100%', stat_dudi_partners TEXT DEFAULT '50+',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.school_stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    label TEXT NOT NULL, value TEXT NOT NULL, suffix TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  "order" INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.sejarah (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    year TEXT NOT NULL, title TEXT NOT NULL, description TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.sertifikasi_jurusan (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    jurusan TEXT NOT NULL, name TEXT NOT NULL, issuer TEXT, description TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  "jurusan_id" UUID REFERENCES cms.jurusan(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.spmb_biaya (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    item TEXT NOT NULL, amount TEXT NOT NULL, description TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.spmb_faq (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    question TEXT NOT NULL, answer TEXT NOT NULL,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.spmb_jadwal (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, date TEXT NOT NULL, description TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.spmb_pengumuman (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, content TEXT, file_url TEXT, date TEXT,
    is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.spmb_persyaratan (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    text TEXT NOT NULL, sort_order INTEGER DEFAULT 1,
    is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.spmb_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT DEFAULT 'Penerimaan Peserta Didik Baru',
    description TEXT,
    tahun_ajaran TEXT DEFAULT '',
    tanggal_buka TEXT,
    tanggal_tutup TEXT,
    kuota TEXT,
    form_url TEXT, upload_url TEXT,
    form_description TEXT,
    berkas_description TEXT,
    contact_name TEXT, contact_phone TEXT, contact_email TEXT,
    contact_whatsapp TEXT,
    contact_address TEXT,
    pengumuman_link TEXT,
    pengumuman_description TEXT,
    pengumuman_date TEXT,
    registration_open BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.spmb_timeline (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    step INTEGER NOT NULL, title TEXT NOT NULL, date TEXT NOT NULL,
    description TEXT, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.struktur_organisasi (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL, role TEXT NOT NULL, abbr TEXT, image TEXT,
    category TEXT DEFAULT 'wakil_kepala',
    "order" INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  "guru_staff_id" UUID REFERENCES cms.guru_staff(id) ON DELETE SET NULL,
  "sort_order" INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.tata_tertib (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL, description TEXT,
    category TEXT DEFAULT 'Umum',
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.teaching_factory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    jurusan TEXT NOT NULL, name TEXT NOT NULL, description TEXT,
    image TEXT, products TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  "jurusan_id" UUID REFERENCES cms.jurusan(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.testimoni_dudi (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL, company TEXT NOT NULL, position TEXT,
    quote TEXT NOT NULL, sort_order INTEGER DEFAULT 1,
    is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.tracer_alumni (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    year TEXT NOT NULL, employed_percent TEXT NOT NULL,
    college_percent TEXT NOT NULL, entrepreneur_percent TEXT NOT NULL,
    is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.tujuan_sekolah (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 1, is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.ukk (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "title" TEXT,
  "jurusan" TEXT,
  "year" TEXT,
  "scheme" TEXT,
  "description" TEXT,
  "schedule" TEXT,
  "requirements" TEXT,
  "file_url" TEXT,
  "sort_order" INTEGER,
  "is_published" BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.visi_misi (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    visi TEXT, misi JSONB DEFAULT '[]', tujuan JSONB DEFAULT '[]',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.waka_akademik (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "title" TEXT,
  "category" TEXT,
  "description" TEXT,
  "file_url" TEXT,
  "is_published" BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.waka_hubin (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "title" TEXT,
  "category" TEXT,
  "description" TEXT,
  "image" TEXT,
  "is_published" BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.waka_kesiswaan (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "title" TEXT,
  "category" TEXT,
  "description" TEXT,
  "image" TEXT,
  "is_published" BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms.modul_ajar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, category text NOT NULL,
  jurusan text NOT NULL, subject text NOT NULL, kelas text, description text, file_url text,
  sort_order integer NOT NULL DEFAULT 0, is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cms.pkl_alur_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), step integer NOT NULL CHECK (step > 0),
  title text NOT NULL, description text, sort_order integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON cms.modul_ajar, cms.pkl_alur_steps FROM PUBLIC;

CREATE TABLE IF NOT EXISTS cms.content_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES cms.profiles(id),
  actor_name text,
  actor_role text NOT NULL,
  resource text NOT NULL,
  record_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON cms.guru_staff FROM PUBLIC;
REVOKE ALL ON cms.jurusan FROM PUBLIC;
REVOKE ALL ON cms.agenda FROM PUBLIC;
REVOKE ALL ON cms.akreditasi FROM PUBLIC;
REVOKE ALL ON cms.alumni_inspiratif FROM PUBLIC;
REVOKE ALL ON cms.bank_soal FROM PUBLIC;
REVOKE ALL ON cms.beasiswa FROM PUBLIC;
REVOKE ALL ON cms.berita FROM PUBLIC;
REVOKE ALL ON cms.bkk_lowongan FROM PUBLIC;
REVOKE ALL ON cms.download_dokumen FROM PUBLIC;
REVOKE ALL ON cms.ekstrakurikuler FROM PUBLIC;
REVOKE ALL ON cms.fasilitas_praktik FROM PUBLIC;
REVOKE ALL ON cms.galeri FROM PUBLIC;
REVOKE ALL ON cms.guru_produktif FROM PUBLIC;
REVOKE ALL ON cms.guru_tamu FROM PUBLIC;
REVOKE ALL ON cms.hero_slides FROM PUBLIC;
REVOKE ALL ON cms.jadwal_pelajaran FROM PUBLIC;
REVOKE ALL ON cms.jadwal_ujian FROM PUBLIC;
REVOKE ALL ON cms.jurusan_berita FROM PUBLIC;
REVOKE ALL ON cms.jurusan_produk FROM PUBLIC;
REVOKE ALL ON cms.kalender_akademik FROM PUBLIC;
REVOKE ALL ON cms.keunggulan FROM PUBLIC;
REVOKE ALL ON cms.keunggulan_sekolah FROM PUBLIC;
REVOKE ALL ON cms.kkm FROM PUBLIC;
REVOKE ALL ON cms.kriteria_kelulusan FROM PUBLIC;
REVOKE ALL ON cms.kurikulum FROM PUBLIC;
REVOKE ALL ON cms.layanan FROM PUBLIC;
REVOKE ALL ON cms.lsp FROM PUBLIC;
REVOKE ALL ON cms.materi_pembelajaran FROM PUBLIC;
REVOKE ALL ON cms.mitra_dudi FROM PUBLIC;
REVOKE ALL ON cms.mitra_industri_jurusan FROM PUBLIC;
REVOKE ALL ON cms.mou_kerjasama FROM PUBLIC;
REVOKE ALL ON cms.organisasi FROM PUBLIC;
REVOKE ALL ON cms.poin_pelanggaran FROM PUBLIC;
REVOKE ALL ON cms.prestasi FROM PUBLIC;
REVOKE ALL ON cms.prestasi_jurusan FROM PUBLIC;
REVOKE ALL ON cms.sarpras FROM PUBLIC;
REVOKE ALL ON cms.school_info FROM PUBLIC;
REVOKE ALL ON cms.school_stats FROM PUBLIC;
REVOKE ALL ON cms.sejarah FROM PUBLIC;
REVOKE ALL ON cms.sertifikasi_jurusan FROM PUBLIC;
REVOKE ALL ON cms.spmb_biaya FROM PUBLIC;
REVOKE ALL ON cms.spmb_faq FROM PUBLIC;
REVOKE ALL ON cms.spmb_jadwal FROM PUBLIC;
REVOKE ALL ON cms.spmb_pengumuman FROM PUBLIC;
REVOKE ALL ON cms.spmb_persyaratan FROM PUBLIC;
REVOKE ALL ON cms.spmb_settings FROM PUBLIC;
REVOKE ALL ON cms.spmb_timeline FROM PUBLIC;
REVOKE ALL ON cms.struktur_organisasi FROM PUBLIC;
REVOKE ALL ON cms.tata_tertib FROM PUBLIC;
REVOKE ALL ON cms.teaching_factory FROM PUBLIC;
REVOKE ALL ON cms.testimoni_dudi FROM PUBLIC;
REVOKE ALL ON cms.tracer_alumni FROM PUBLIC;
REVOKE ALL ON cms.tujuan_sekolah FROM PUBLIC;
REVOKE ALL ON cms.ukk FROM PUBLIC;
REVOKE ALL ON cms.visi_misi FROM PUBLIC;
REVOKE ALL ON cms.waka_akademik FROM PUBLIC;
REVOKE ALL ON cms.waka_hubin FROM PUBLIC;
REVOKE ALL ON cms.waka_kesiswaan FROM PUBLIC;
REVOKE ALL ON cms.content_audit FROM PUBLIC;


-- Existing admin form variants share these CMS resources.
ALTER TABLE cms.beasiswa ADD COLUMN IF NOT EXISTS amount text;
ALTER TABLE cms.beasiswa ADD COLUMN IF NOT EXISTS deadline text;
ALTER TABLE cms.beasiswa ADD COLUMN IF NOT EXISTS link text;
ALTER TABLE cms.bkk_lowongan ADD COLUMN IF NOT EXISTS requirements text;
ALTER TABLE cms.bkk_lowongan ADD COLUMN IF NOT EXISTS salary text;
ALTER TABLE cms.bkk_lowongan ADD COLUMN IF NOT EXISTS link text;
ALTER TABLE cms.bkk_lowongan ADD COLUMN IF NOT EXISTS image text;
ALTER TABLE cms.download_dokumen ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE cms.download_dokumen ADD COLUMN IF NOT EXISTS file_type text;
ALTER TABLE cms.download_dokumen ADD COLUMN IF NOT EXISTS file_name text;
ALTER TABLE cms.guru_tamu ADD COLUMN IF NOT EXISTS position text;
ALTER TABLE cms.guru_tamu ADD COLUMN IF NOT EXISTS field text;
ALTER TABLE cms.guru_tamu ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE cms.guru_tamu ADD COLUMN IF NOT EXISTS image text;
ALTER TABLE cms.guru_tamu ADD COLUMN IF NOT EXISTS event_date text;
ALTER TABLE cms.guru_tamu ADD COLUMN IF NOT EXISTS sort_order integer;
ALTER TABLE cms.mou_kerjasama ADD COLUMN IF NOT EXISTS partner_name text;
ALTER TABLE cms.mou_kerjasama ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE cms.mou_kerjasama ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE cms.mou_kerjasama ADD COLUMN IF NOT EXISTS mou_number text;
ALTER TABLE cms.mou_kerjasama ADD COLUMN IF NOT EXISTS signed_date text;
ALTER TABLE cms.mou_kerjasama ADD COLUMN IF NOT EXISTS expired_date text;
ALTER TABLE cms.mou_kerjasama ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE cms.mou_kerjasama ADD COLUMN IF NOT EXISTS image text;
ALTER TABLE cms.mou_kerjasama ADD COLUMN IF NOT EXISTS mou_date text;
ALTER TABLE cms.mou_kerjasama ADD COLUMN IF NOT EXISTS valid_until text;
ALTER TABLE cms.mou_kerjasama ADD COLUMN IF NOT EXISTS sort_order integer;
ALTER TABLE cms.spmb_biaya ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE cms.tata_tertib ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE cms.testimoni_dudi ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE cms.testimoni_dudi ADD COLUMN IF NOT EXISTS image text;
ALTER TABLE cms.testimoni_dudi ADD COLUMN IF NOT EXISTS rating integer;
ALTER TABLE cms.tracer_alumni ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE cms.tracer_alumni ADD COLUMN IF NOT EXISTS jurusan text;
ALTER TABLE cms.tracer_alumni ADD COLUMN IF NOT EXISTS company_or_campus text;
ALTER TABLE cms.tracer_alumni ADD COLUMN IF NOT EXISTS position text;
ALTER TABLE cms.tracer_alumni ADD COLUMN IF NOT EXISTS salary_range text;
ALTER TABLE cms.tracer_alumni ADD COLUMN IF NOT EXISTS graduation_year integer;
ALTER TABLE cms.tracer_alumni ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE cms.tracer_alumni ALTER COLUMN year DROP NOT NULL;
ALTER TABLE cms.tracer_alumni ALTER COLUMN employed_percent DROP NOT NULL;
ALTER TABLE cms.tracer_alumni ALTER COLUMN college_percent DROP NOT NULL;
ALTER TABLE cms.tracer_alumni ALTER COLUMN entrepreneur_percent DROP NOT NULL;
ALTER TABLE cms.mou_kerjasama ALTER COLUMN partner DROP NOT NULL;
ALTER TABLE cms.mou_kerjasama ALTER COLUMN year DROP NOT NULL;
ALTER TABLE cms.download_dokumen ALTER COLUMN name DROP NOT NULL;
ALTER TABLE cms.testimoni_dudi ALTER COLUMN quote DROP NOT NULL;
ALTER TABLE cms.testimoni_dudi ALTER COLUMN company DROP NOT NULL;
ALTER TABLE cms.poin_pelanggaran ALTER COLUMN title DROP NOT NULL;

CREATE TABLE IF NOT EXISTS cms.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, type text NOT NULL DEFAULT 'PDF', size text, file_url text NOT NULL,
  category text NOT NULL DEFAULT 'Umum', sort_order integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE cms.documents FROM PUBLIC;


-- Native PKL domain
-- Source-only native PKL schema. No production data or identity operations.
-- Review target, backup and recovery before applying; rollback preserves durable data.
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

