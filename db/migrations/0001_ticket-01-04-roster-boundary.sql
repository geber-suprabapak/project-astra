-- Astra migration 0001: Ticket 01/04 roster boundary.
--
-- Run explicitly with psql -v ON_ERROR_STOP=1. This is intentionally separate
-- from db/schema.sql: it contains no bootstrap seeds and does not backfill
-- Students or bindings. Ticket 01/04 does not define an authoritative source
-- or stable ID derivation for that backfill.

\set ON_ERROR_STOP on

SET lock_timeout = '5s';
SET statement_timeout = '10min';

BEGIN;

-- Fail before the first DDL when the deployed legacy contract or an existing
-- active enrollment is unsafe. Legacy profiles do not participate in this
-- schema-only migration; their canonical roster conversion is deferred.
DO $$
DECLARE
    missing_columns text;
BEGIN
    SELECT string_agg(format('%s.%s', required.table_name, required.column_name), ', ' ORDER BY required.table_name, required.column_name)
      INTO missing_columns
    FROM (
        VALUES
            ('profiles', 'user_id'),
            ('class_enrollments', 'user_id'),
            ('class_enrollments', 'class_id'),
            ('class_enrollments', 'academic_period_id'),
            ('class_enrollments', 'status'),
            ('roster_reports', 'school_id'),
            ('leave_requests', 'user_id')
    ) AS required(table_name, column_name)
    WHERE NOT EXISTS (
        SELECT 1
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = required.table_name
          AND c.column_name = required.column_name
    );

    IF missing_columns IS NOT NULL THEN
        RAISE EXCEPTION 'Astra migration 0001 requires legacy columns: %', missing_columns;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM class_enrollments
        WHERE status = 'active'
          AND (user_id IS NULL OR class_id IS NULL OR academic_period_id IS NULL)
    ) THEN
        RAISE EXCEPTION
            'Astra migration 0001 refuses active enrollments without user, class, or academic period';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM class_enrollments
        WHERE status = 'active'
        GROUP BY user_id, academic_period_id
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Astra migration 0001 refuses duplicate active legacy enrollments';
    END IF;
END
$$;

-- If a partial/manual prior attempt already created either canonical table,
-- reject an incompatible shape instead of letting IF NOT EXISTS hide it.
DO $$
DECLARE
    missing_columns text;
BEGIN
    IF to_regclass('public.students') IS NOT NULL THEN
        SELECT string_agg(required.column_name, ', ' ORDER BY required.column_name)
          INTO missing_columns
        FROM (
            VALUES ('id'), ('nis'), ('full_name'), ('gender'), ('created_at'), ('updated_at')
        ) AS required(column_name)
        WHERE NOT EXISTS (
            SELECT 1
            FROM information_schema.columns c
            WHERE c.table_schema = 'public'
              AND c.table_name = 'students'
              AND c.column_name = required.column_name
        );
        IF missing_columns IS NOT NULL THEN
            RAISE EXCEPTION 'Existing public.students is incompatible; missing columns: %', missing_columns;
        END IF;

        IF EXISTS (
            SELECT 1
            FROM (
                VALUES
                    ('id', 'uuid', 'NO'),
                    ('nis', 'text', 'NO'),
                    ('full_name', 'text', 'NO'),
                    ('gender', 'text', 'NO'),
                    ('created_at', 'timestamp with time zone', 'NO'),
                    ('updated_at', 'timestamp with time zone', 'NO')
            ) AS required(column_name, data_type, is_nullable)
            WHERE NOT EXISTS (
                SELECT 1
                FROM information_schema.columns c
                WHERE c.table_schema = 'public'
                  AND c.table_name = 'students'
                  AND c.column_name = required.column_name
                  AND c.data_type = required.data_type
                  AND c.is_nullable = required.is_nullable
            )
        ) OR NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conrelid = 'public.students'::regclass
              AND conname = 'students_gender_check'
              AND pg_get_constraintdef(oid) ILIKE '%gender%L%P%'
        ) OR NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conrelid = 'public.students'::regclass
              AND conname = 'students_pkey'
              AND contype = 'p'
        ) OR NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conrelid = 'public.students'::regclass
              AND conname = 'students_nis_key'
              AND contype = 'u'
        ) THEN
            RAISE EXCEPTION 'Existing public.students has an incompatible column or gender contract';
        END IF;
    END IF;

    IF to_regclass('public.student_bindings') IS NOT NULL THEN
        SELECT string_agg(required.column_name, ', ' ORDER BY required.column_name)
          INTO missing_columns
        FROM (
            VALUES ('student_id'), ('user_id'), ('created_at'), ('updated_at')
        ) AS required(column_name)
        WHERE NOT EXISTS (
            SELECT 1
            FROM information_schema.columns c
            WHERE c.table_schema = 'public'
              AND c.table_name = 'student_bindings'
              AND c.column_name = required.column_name
        );
        IF missing_columns IS NOT NULL THEN
            RAISE EXCEPTION 'Existing public.student_bindings is incompatible; missing columns: %', missing_columns;
        END IF;

        IF EXISTS (
            SELECT 1
            FROM (
                VALUES
                    ('student_id', 'uuid', 'NO'),
                    ('user_id', 'text', 'NO'),
                    ('created_at', 'timestamp with time zone', 'NO'),
                    ('updated_at', 'timestamp with time zone', 'NO')
            ) AS required(column_name, data_type, is_nullable)
            WHERE NOT EXISTS (
                SELECT 1
                FROM information_schema.columns c
                WHERE c.table_schema = 'public'
                  AND c.table_name = 'student_bindings'
                  AND c.column_name = required.column_name
                  AND c.data_type = required.data_type
                  AND c.is_nullable = required.is_nullable
            )
        ) OR NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conrelid = 'public.student_bindings'::regclass
              AND conname = 'student_bindings_pkey'
              AND contype = 'p'
        ) OR NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conrelid = 'public.student_bindings'::regclass
              AND conname = 'student_bindings_user_id_key'
              AND contype = 'u'
        ) THEN
            RAISE EXCEPTION 'Existing public.student_bindings has an incompatible column contract';
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM (
            VALUES
                ('class_enrollments', 'student_id', 'uuid', 'YES'),
                ('class_enrollments', 'absence_number', 'text', 'YES'),
                ('roster_reports', 'academic_period_id', 'uuid', 'YES'),
                ('leave_requests', 'original_end_date', 'date', 'YES'),
                ('leave_requests', 'effective_end_date', 'date', 'YES'),
                ('leave_requests', 'duration_days', 'integer', 'YES')
        ) AS required(table_name, column_name, data_type, is_nullable)
        JOIN information_schema.columns c
          ON c.table_schema = 'public'
         AND c.table_name = required.table_name
         AND c.column_name = required.column_name
        WHERE c.data_type <> required.data_type
           OR c.is_nullable <> required.is_nullable
    ) THEN
        RAISE EXCEPTION 'Existing Ticket 01/04 columns have incompatible types';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.class_enrollments'::regclass
          AND conname = 'class_enrollments_student_id_fkey'
          AND (
              contype <> 'f'
              OR pg_get_constraintdef(oid) NOT ILIKE '%FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE%'
          )
    ) OR EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.roster_reports'::regclass
          AND conname = 'roster_reports_academic_period_id_fkey'
          AND (
              contype <> 'f'
              OR pg_get_constraintdef(oid) NOT ILIKE '%FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id) ON DELETE RESTRICT%'
          )
    ) THEN
        RAISE EXCEPTION 'Existing Ticket 01/04 foreign-key contract is incompatible';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.class_enrollments'::regclass
          AND conname = 'class_enrollments_owner_check'
          AND pg_get_constraintdef(oid) NOT ILIKE '%student_id%NOT NULL%user_id%NOT NULL%'
    ) OR EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.class_enrollments'::regclass
          AND conname = 'class_enrollments_absence_number_check'
          AND pg_get_constraintdef(oid) NOT ILIKE '%absence_number%[1-9][0-9]*%'
    ) OR EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.leave_requests'::regclass
          AND conname = 'leave_requests_duration_days_check'
          AND pg_get_constraintdef(oid) NOT ILIKE '%duration_days%>= 1%duration_days%<= 30%'
    ) THEN
        RAISE EXCEPTION 'Existing Ticket 01/04 check constraint is incompatible';
    END IF;

    IF to_regclass('public.idx_students_nis') IS NOT NULL THEN
        IF pg_get_indexdef('public.idx_students_nis'::regclass) <> 'CREATE INDEX idx_students_nis ON public.students USING btree (nis)' THEN
            RAISE EXCEPTION 'Existing idx_students_nis has an incompatible definition';
        END IF;
    END IF;
    IF to_regclass('public.idx_class_enrollments_student_period') IS NOT NULL THEN
        IF pg_get_indexdef('public.idx_class_enrollments_student_period'::regclass) <> 'CREATE INDEX idx_class_enrollments_student_period ON public.class_enrollments USING btree (student_id, academic_period_id)' THEN
            RAISE EXCEPTION 'Existing idx_class_enrollments_student_period has an incompatible definition';
        END IF;
    END IF;
    IF to_regclass('public.uq_active_student_class_enrollment') IS NOT NULL THEN
        IF pg_get_indexdef('public.uq_active_student_class_enrollment'::regclass) <> 'CREATE UNIQUE INDEX uq_active_student_class_enrollment ON public.class_enrollments USING btree (student_id, academic_period_id) WHERE (status = ''active''::text)' THEN
            RAISE EXCEPTION 'Existing uq_active_student_class_enrollment has an incompatible definition';
        END IF;
    END IF;
    IF to_regclass('public.uq_active_class_absence_number') IS NOT NULL THEN
        IF pg_get_indexdef('public.uq_active_class_absence_number'::regclass) <> 'CREATE UNIQUE INDEX uq_active_class_absence_number ON public.class_enrollments USING btree (class_id, academic_period_id, absence_number) WHERE ((status = ''active''::text) AND (absence_number IS NOT NULL))' THEN
            RAISE EXCEPTION 'Existing uq_active_class_absence_number has an incompatible definition';
        END IF;
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nis TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    gender TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT students_gender_check CHECK (gender IN ('L', 'P'))
);

CREATE TABLE IF NOT EXISTS student_bindings (
    student_id UUID PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL UNIQUE REFERENCES profiles(user_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE class_enrollments
    ADD COLUMN IF NOT EXISTS student_id UUID;

ALTER TABLE class_enrollments
    ADD COLUMN IF NOT EXISTS absence_number TEXT;

ALTER TABLE class_enrollments
    ALTER COLUMN user_id DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.class_enrollments'::regclass
          AND conname = 'class_enrollments_student_id_fkey'
    ) THEN
        ALTER TABLE class_enrollments
            ADD CONSTRAINT class_enrollments_student_id_fkey
            FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.class_enrollments'::regclass
          AND conname = 'class_enrollments_owner_check'
    ) THEN
        ALTER TABLE class_enrollments
            ADD CONSTRAINT class_enrollments_owner_check
            CHECK (student_id IS NOT NULL OR user_id IS NOT NULL)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.class_enrollments'::regclass
          AND conname = 'class_enrollments_absence_number_check'
    ) THEN
        ALTER TABLE class_enrollments
            ADD CONSTRAINT class_enrollments_absence_number_check
            CHECK (absence_number IS NULL OR absence_number ~ '^[1-9][0-9]*$')
            NOT VALID;
    END IF;
END
$$;

ALTER TABLE roster_reports
    ADD COLUMN IF NOT EXISTS academic_period_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.roster_reports'::regclass
          AND conname = 'roster_reports_academic_period_id_fkey'
    ) THEN
        ALTER TABLE roster_reports
            ADD CONSTRAINT roster_reports_academic_period_id_fkey
            FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id) ON DELETE RESTRICT
            NOT VALID;
    END IF;
END
$$;

ALTER TABLE leave_requests
    ADD COLUMN IF NOT EXISTS original_end_date DATE;

ALTER TABLE leave_requests
    ADD COLUMN IF NOT EXISTS effective_end_date DATE;

ALTER TABLE leave_requests
    ADD COLUMN IF NOT EXISTS duration_days INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.leave_requests'::regclass
          AND conname = 'leave_requests_duration_days_check'
    ) THEN
        ALTER TABLE leave_requests
            ADD CONSTRAINT leave_requests_duration_days_check
            CHECK (duration_days IS NULL OR duration_days BETWEEN 1 AND 30)
            NOT VALID;
    END IF;
END
$$;

COMMIT;

-- These indexes are intentionally outside the transaction. They can be
-- retried independently if a concurrent build times out or loses a race.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_students_nis
    ON students(nis);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_class_enrollments_student_period
    ON class_enrollments(student_id, academic_period_id);

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_active_student_class_enrollment
    ON class_enrollments(student_id, academic_period_id)
    WHERE status = 'active';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_active_class_absence_number
    ON class_enrollments(class_id, academic_period_id, absence_number)
    WHERE status = 'active' AND absence_number IS NOT NULL;
