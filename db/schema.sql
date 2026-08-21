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
-- Table: profiles
-- Description: Student, Staff, and Administrator profiles
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
    role TEXT NOT NULL DEFAULT 'student',
    gender TEXT,
    lifecycle_status TEXT NOT NULL DEFAULT 'approved',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT profiles_role_check CHECK (role IN ('platform_admin', 'school_admin', 'teacher', 'student', 'staff')),
    CONSTRAINT profiles_lifecycle_check CHECK (lifecycle_status IN ('pending', 'approved', 'rejected', 'disabled'))
);

CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_nis ON profiles(nis);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- ----------------------------------------------------------------------------
-- Table: class_enrollments
-- Description: Time-bounded association of a Student to a class in an academic period
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS class_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
    class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
    academic_period_id UUID REFERENCES academic_periods(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT class_enrollments_status_check CHECK (status IN ('active', 'transferred', 'promoted', 'graduated', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_class_enrollments_user_period ON class_enrollments(user_id, academic_period_id);

-- ----------------------------------------------------------------------------
-- Table: roster_reports
-- Description: Staged student roster validation reports and review states
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roster_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_roster_reports_school ON roster_reports(school_id);
CREATE INDEX IF NOT EXISTS idx_roster_reports_status ON roster_reports(status);

-- ----------------------------------------------------------------------------
-- Table: locations
-- Description: Geofence locations for physical attendance validation
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    radius_meters DOUBLE PRECISION NOT NULL DEFAULT 100.0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Table: schedules
-- Description: Daily attendance time windows and grace periods in Asia/Jakarta
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
    CONSTRAINT files_purpose_check CHECK (purpose IN ('avatar', 'permit_attachment', 'face_enrollment')),
    CONSTRAINT files_lifecycle_check CHECK (lifecycle IN ('pending_upload', 'available', 'rejected', 'deleted'))
);

CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id);
CREATE INDEX IF NOT EXISTS idx_files_lifecycle ON files(lifecycle);

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
