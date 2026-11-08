-- ============================================================================
-- ADUN Attendance System Database Schema Migration
-- Migration Name: 20261108000000_adun_attendance_schema.sql
-- Description: Core schema, constraints, triggers, RLS, RPCs, storage bucket,
--              and seed admin account for Admiralty University of Nigeria.
-- STRICT POLICY: ZERO DEMO DATA (No dummy students, courses, or records).
-- Timezone Standard: Africa/Lagos
-- ============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. CUSTOM ENUMS
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('admin', 'lecturer');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE user_status AS ENUM ('active', 'soft_deleted');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE course_status AS ENUM ('active', 'archived');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE session_status AS ENUM ('scheduled', 'active', 'expired', 'closed', 'revoked');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE attempt_step AS ENUM ('identity', 'location', 'selfie', 'video', 'submitted');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE attendance_status AS ENUM ('present', 'late');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE verification_status AS ENUM ('passed', 'manual_review');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE device_binding_status AS ENUM ('active', 'reset', 'revoked');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE device_event_type AS ENUM (
        'bind', 'match', 'mismatch', 'cookie_missing', 'cookie_mismatch', 'admin_reset', 'proxy_detected'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE proxy_risk_level AS ENUM ('low', 'medium', 'high');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE location_mode AS ENUM ('enforce', 'evidence_only');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. TABLES DEFINITION

-- 3.1 USERS TABLE (Admin & Lecturers)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role user_role NOT NULL DEFAULT 'lecturer',
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    auth_id UUID UNIQUE NULL,
    status user_status NOT NULL DEFAULT 'active',
    must_change_password BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    deleted_at TIMESTAMPTZ NULL
);

-- 3.2 STUDENTS MASTER TABLE (Institution student directory)
CREATE TABLE IF NOT EXISTS students_master (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    matric_no TEXT NOT NULL UNIQUE,
    search_key TEXT NOT NULL,
    surname TEXT NOT NULL,
    first_name TEXT NOT NULL,
    middle_name TEXT NULL,
    program TEXT NOT NULL,
    level INTEGER NOT NULL CHECK (level IN (100, 200, 300, 400, 500, 600, 700, 800)),
    email TEXT NULL,
    phone TEXT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 3.3 COURSES TABLE (Max 9 active per lecturer)
CREATE TABLE IF NOT EXISTS courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    lecturer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status course_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 3.4 COURSE ROSTER TABLE (Eligible students enrolled per course)
CREATE TABLE IF NOT EXISTS course_roster (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students_master(id) ON DELETE CASCADE,
    uploaded_by UUID NOT NULL REFERENCES users(id),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT unique_course_roster_entry UNIQUE (course_id, student_id)
);

-- 3.5 LECTURE SESSIONS TABLE (Lecture QR / links)
CREATE TABLE IF NOT EXISTS lecture_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    starts_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    grace_minutes INTEGER NOT NULL DEFAULT 10 CHECK (grace_minutes >= 0),
    status session_status NOT NULL DEFAULT 'active',
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    closed_at TIMESTAMPTZ NULL,
    CONSTRAINT check_session_times CHECK (expires_at > starts_at)
);

-- 3.6 DEVICE BINDINGS TABLE (Strict Option 2 Device Binding per ADUN spec)
CREATE TABLE IF NOT EXISTS device_bindings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students_master(id) ON DELETE CASCADE,
    fingerprint_hash TEXT NOT NULL,
    device_id UUID NULL,
    trusted_cookie_hash TEXT NULL,
    user_agent TEXT NULL,
    first_bound_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    status device_binding_status NOT NULL DEFAULT 'active',
    is_shared BOOLEAN NOT NULL DEFAULT false,
    reset_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    reset_at TIMESTAMPTZ NULL
);

-- PARTIAL UNIQUE INDEX: One active binding per physical device fingerprint
CREATE UNIQUE INDEX IF NOT EXISTS one_active_binding_per_fingerprint 
ON device_bindings (fingerprint_hash) 
WHERE status = 'active';

-- 3.7 DEVICE EVENTS TABLE (Append-only forensic audit for device binding lifecycle & proxy detection)
CREATE TABLE IF NOT EXISTS device_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NULL REFERENCES students_master(id) ON DELETE SET NULL,
    fingerprint_hash TEXT NOT NULL,
    event_type device_event_type NOT NULL,
    reference_code TEXT NOT NULL,
    metadata JSONB NULL DEFAULT '{}'::jsonb,
    ip TEXT NULL,
    user_agent TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 3.8 ATTENDANCE ATTEMPTS TABLE (Ephemeral 10-15 min student check-in session)
CREATE TABLE IF NOT EXISTS attendance_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES lecture_sessions(id) ON DELETE CASCADE,
    student_id UUID NULL REFERENCES students_master(id) ON DELETE CASCADE,
    attempt_token_hash TEXT NOT NULL UNIQUE,
    step attempt_step NOT NULL DEFAULT 'identity',
    matric_hash TEXT NULL,
    device_id TEXT NULL,
    latitude DOUBLE PRECISION NULL,
    longitude DOUBLE PRECISION NULL,
    accuracy_m DOUBLE PRECISION NULL,
    selfie_path TEXT NULL,
    video_seen BOOLEAN NOT NULL DEFAULT false,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now()) + INTERVAL '15 minutes'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    completed_at TIMESTAMPTZ NULL
);

-- 3.9 ATTENDANCE RECORDS TABLE (Immutable signed records)
CREATE TABLE IF NOT EXISTS attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES lecture_sessions(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students_master(id) ON DELETE RESTRICT,
    signed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    status attendance_status NOT NULL,
    latitude DOUBLE PRECISION NULL,
    longitude DOUBLE PRECISION NULL,
    accuracy_m DOUBLE PRECISION NULL,
    selfie_path TEXT NOT NULL,
    verification_status verification_status NOT NULL DEFAULT 'passed',
    device_info JSONB NULL,
    receipt_id TEXT NOT NULL UNIQUE,
    idempotency_key TEXT NULL UNIQUE,
    fingerprint_hash TEXT NULL,
    binding_id UUID NULL REFERENCES device_bindings(id) ON DELETE SET NULL,
    proxy_risk proxy_risk_level NOT NULL DEFAULT 'low',
    CONSTRAINT unique_session_student UNIQUE (session_id, student_id)
);

-- 3.10 AUDIT LOGS TABLE (Immutable administrative audit trail)
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT NULL,
    metadata JSONB NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 3.11 SETTINGS TABLE (System configuration singleton)
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    location_mode location_mode NOT NULL DEFAULT 'evidence_only',
    campus_boundary_geojson JSONB NULL,
    location_accuracy_threshold_m DOUBLE PRECISION NOT NULL DEFAULT 50,
    default_session_duration_minutes INTEGER NOT NULL DEFAULT 60,
    max_session_duration_minutes INTEGER NOT NULL DEFAULT 180,
    selfie_retention_days INTEGER NOT NULL DEFAULT 180,
    grace_minutes INTEGER NOT NULL DEFAULT 10,
    max_active_courses_per_lecturer INTEGER NOT NULL DEFAULT 9,
    rate_limit_token_per_minute INTEGER NOT NULL DEFAULT 60,
    rate_limit_matric_per_minute INTEGER NOT NULL DEFAULT 30,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 4. PERFORMANCE & LOOKUP INDEXES
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_auth_id ON users(auth_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE INDEX IF NOT EXISTS idx_students_matric_no ON students_master(matric_no);
CREATE INDEX IF NOT EXISTS idx_students_search_key ON students_master(search_key);
CREATE INDEX IF NOT EXISTS idx_students_level_program ON students_master(level, program);

CREATE INDEX IF NOT EXISTS idx_courses_lecturer_status ON courses(lecturer_id, status);
CREATE INDEX IF NOT EXISTS idx_courses_code ON courses(code);

CREATE INDEX IF NOT EXISTS idx_course_roster_course ON course_roster(course_id);
CREATE INDEX IF NOT EXISTS idx_course_roster_student ON course_roster(student_id);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON lecture_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_course_status ON lecture_sessions(course_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_dates ON lecture_sessions(starts_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_attempts_token_hash ON attendance_attempts(attempt_token_hash);
CREATE INDEX IF NOT EXISTS idx_attempts_session_student ON attendance_attempts(session_id, student_id);
CREATE INDEX IF NOT EXISTS idx_attempts_expires ON attendance_attempts(expires_at);

CREATE INDEX IF NOT EXISTS idx_records_session ON attendance_records(session_id);
CREATE INDEX IF NOT EXISTS idx_records_course_student ON attendance_records(course_id, student_id);
CREATE INDEX IF NOT EXISTS idx_records_student ON attendance_records(student_id);
CREATE INDEX IF NOT EXISTS idx_records_signed_at ON attendance_records(signed_at);
CREATE INDEX IF NOT EXISTS idx_records_receipt_id ON attendance_records(receipt_id);
CREATE INDEX IF NOT EXISTS idx_records_fingerprint ON attendance_records(fingerprint_hash);
CREATE INDEX IF NOT EXISTS idx_records_session_fingerprint ON attendance_records(session_id, fingerprint_hash);
CREATE INDEX IF NOT EXISTS idx_records_binding_id ON attendance_records(binding_id);
CREATE INDEX IF NOT EXISTS idx_records_proxy_risk ON attendance_records(proxy_risk);

CREATE INDEX IF NOT EXISTS idx_device_bindings_student ON device_bindings(student_id, status);
CREATE INDEX IF NOT EXISTS idx_device_bindings_fingerprint ON device_bindings(fingerprint_hash, status);
CREATE INDEX IF NOT EXISTS idx_device_bindings_cookie_hash ON device_bindings(trusted_cookie_hash);
CREATE INDEX IF NOT EXISTS idx_device_bindings_device_id ON device_bindings(device_id);

CREATE INDEX IF NOT EXISTS idx_device_events_student ON device_events(student_id);
CREATE INDEX IF NOT EXISTS idx_device_events_fingerprint ON device_events(fingerprint_hash);
CREATE INDEX IF NOT EXISTS idx_device_events_created_at ON device_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_events_ref_code ON device_events(reference_code);
CREATE INDEX IF NOT EXISTS idx_device_events_event_type ON device_events(event_type);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- 5. TRIGGERS & INTEGRITY ENFORCEMENT

-- 5.1 Enforce maximum 9 active courses per lecturer
CREATE OR REPLACE FUNCTION check_lecturer_active_course_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_active_count INTEGER;
    v_max_allowed INTEGER;
BEGIN
    IF NEW.status = 'active' THEN
        SELECT COALESCE(max_active_courses_per_lecturer, 9)
        INTO v_max_allowed
        FROM settings
        WHERE id = 1;

        IF v_max_allowed IS NULL THEN
            v_max_allowed := 9;
        END IF;

        SELECT COUNT(*)
        INTO v_active_count
        FROM courses
        WHERE lecturer_id = NEW.lecturer_id
          AND status = 'active'
          AND (TG_OP = 'INSERT' OR id != NEW.id);

        IF v_active_count >= v_max_allowed THEN
            RAISE EXCEPTION 'Lecturer cannot have more than % active courses. Current active count is %. Archive an existing course to activate a new one.', v_max_allowed, v_active_count;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_courses_max_active ON courses;
CREATE TRIGGER trg_courses_max_active
    BEFORE INSERT OR UPDATE OF status, lecturer_id
    ON courses
    FOR EACH ROW
    EXECUTE FUNCTION check_lecturer_active_course_limit();

-- 5.2 Auto normalize matric number and compute 3-digit search key
CREATE OR REPLACE FUNCTION normalize_student_matric()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_digits TEXT;
BEGIN
    NEW.matric_no := UPPER(TRIM(NEW.matric_no));
    
    -- Extract trailing numeric digits (e.g. "001" from "ADUN/FS/COM/25/001" or "42" from ".../42")
    v_digits := substring(NEW.matric_no FROM '([0-9]{1,6})$');
    IF v_digits IS NOT NULL AND length(v_digits) > 0 THEN
        NEW.search_key := LPAD(RIGHT(v_digits, 3), 3, '0');
    ELSE
        NEW.search_key := RIGHT(NEW.matric_no, 3);
    END IF;
    
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_students_matric_normalize ON students_master;
CREATE TRIGGER trg_students_matric_normalize
    BEFORE INSERT OR UPDATE OF matric_no
    ON students_master
    FOR EACH ROW
    EXECUTE FUNCTION normalize_student_matric();

-- 5.3 Enforce settings updated_at
CREATE OR REPLACE FUNCTION update_settings_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := timezone('utc', now());
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_settings_updated ON settings;
CREATE TRIGGER trg_settings_updated
    BEFORE UPDATE ON settings
    FOR EACH ROW
    EXECUTE FUNCTION update_settings_timestamp();

-- 6. GEOLOCATION & MATHEMATICAL UTILITIES

-- 6.1 Haversine Distance (metres)
CREATE OR REPLACE FUNCTION fn_haversine_distance_m(
    lat1 DOUBLE PRECISION,
    lon1 DOUBLE PRECISION,
    lat2 DOUBLE PRECISION,
    lon2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    r CONSTANT DOUBLE PRECISION := 6371000; -- Earth radius in metres
    phi1 DOUBLE PRECISION;
    phi2 DOUBLE PRECISION;
    delta_phi DOUBLE PRECISION;
    delta_lambda DOUBLE PRECISION;
    a DOUBLE PRECISION;
    c DOUBLE PRECISION;
BEGIN
    phi1 := radians(lat1);
    phi2 := radians(lat2);
    delta_phi := radians(lat2 - lat1);
    delta_lambda := radians(lon2 - lon1);

    a := sin(delta_phi / 2.0)^2 + cos(phi1) * cos(phi2) * sin(delta_lambda / 2.0)^2;
    c := 2.0 * atan2(sqrt(a), sqrt(1.0 - a));

    RETURN r * c;
END;
$$;

-- 6.2 Ray-Casting Point-in-Polygon for GeoJSON
CREATE OR REPLACE FUNCTION fn_is_point_in_geojson_polygon(
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION,
    p_geojson JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_type TEXT;
    v_rings JSONB;
    v_ring JSONB;
    v_coords JSONB;
    v_num_pts INTEGER;
    v_inside BOOLEAN := false;
    i INTEGER;
    j INTEGER;
    xi DOUBLE PRECISION;
    yi DOUBLE PRECISION;
    xj DOUBLE PRECISION;
    yj DOUBLE PRECISION;
    v_intersect BOOLEAN;
BEGIN
    IF p_geojson IS NULL OR p_lat IS NULL OR p_lng IS NULL THEN
        RETURN FALSE;
    END IF;

    v_type := p_geojson->>'type';

    IF v_type = 'Feature' THEN
        p_geojson := p_geojson->'geometry';
        v_type := p_geojson->>'type';
    END IF;

    IF v_type = 'Polygon' THEN
        v_rings := p_geojson->'coordinates';
        -- Check outer boundary (first linear ring)
        v_ring := v_rings->0;
        v_num_pts := jsonb_array_length(v_ring);
        IF v_num_pts < 3 THEN
            RETURN FALSE;
        END IF;

        j := v_num_pts - 1;
        FOR i IN 0..(v_num_pts - 1) LOOP
            xi := (v_ring->i->0)::DOUBLE PRECISION; -- lng
            yi := (v_ring->i->1)::DOUBLE PRECISION; -- lat
            xj := (v_ring->j->0)::DOUBLE PRECISION;
            yj := (v_ring->j->1)::DOUBLE PRECISION;

            v_intersect := ((yi > p_lat) != (yj > p_lat)) AND
                           (p_lng < (xj - xi) * (p_lat - yi) / NULLIF(yj - yi, 0) + xi);

            IF v_intersect THEN
                v_inside := NOT v_inside;
            END IF;
            j := i;
        END LOOP;

        RETURN v_inside;
    ELSIF v_type = 'MultiPolygon' THEN
        -- Check each polygon in multipolygon
        FOR k IN 0..(jsonb_array_length(p_geojson->'coordinates') - 1) LOOP
            v_ring := p_geojson->'coordinates'->k->0;
            v_num_pts := jsonb_array_length(v_ring);
            v_inside := false;
            j := v_num_pts - 1;
            FOR i IN 0..(v_num_pts - 1) LOOP
                xi := (v_ring->i->0)::DOUBLE PRECISION;
                yi := (v_ring->i->1)::DOUBLE PRECISION;
                xj := (v_ring->j->0)::DOUBLE PRECISION;
                yj := (v_ring->j->1)::DOUBLE PRECISION;

                v_intersect := ((yi > p_lat) != (yj > p_lat)) AND
                               (p_lng < (xj - xi) * (p_lat - yi) / NULLIF(yj - yi, 0) + xi);

                IF v_intersect THEN
                    v_inside := NOT v_inside;
                END IF;
                j := i;
            END LOOP;

            IF v_inside THEN
                RETURN TRUE;
            END IF;
        END LOOP;
        RETURN FALSE;
    END IF;

    RETURN FALSE;
END;
$$;

-- 7. STORED PROCEDURES (CORE BACKEND RPC LOGIC)

-- 7.1 Validate Session Token and Initiate Attempt
CREATE OR REPLACE FUNCTION rpc_validate_session_token(
    p_raw_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_token_hash TEXT;
    v_session RECORD;
    v_attempt_token TEXT;
    v_attempt_token_hash TEXT;
    v_attempt_id UUID;
    v_now TIMESTAMPTZ := timezone('utc', now());
    v_lagos_now TIMESTAMPTZ := timezone('Africa/Lagos', now());
BEGIN
    IF p_raw_token IS NULL OR length(trim(p_raw_token)) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_TOKEN', 'message', 'Token is missing or empty.');
    END IF;

    -- Hash incoming token with SHA-256
    v_token_hash := encode(digest(trim(p_raw_token), 'sha256'), 'hex');

    -- Lookup lecture session
    SELECT s.*, c.code AS course_code, c.title AS course_title, c.status AS course_status
    INTO v_session
    FROM lecture_sessions s
    JOIN courses c ON c.id = s.course_id
    WHERE s.token_hash = v_token_hash;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_TOKEN', 'message', 'Lecture session not found for this token.');
    END IF;

    IF v_session.course_status = 'archived' THEN
        RETURN jsonb_build_object('success', false, 'error', 'COURSE_ARCHIVED', 'message', 'The course for this session has been archived.');
    END IF;

    IF v_session.status = 'closed' OR v_session.status = 'revoked' THEN
        RETURN jsonb_build_object('success', false, 'error', 'SESSION_CLOSED', 'message', 'This lecture session was closed or revoked by the lecturer.');
    END IF;

    IF v_now < v_session.starts_at THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'SESSION_NOT_STARTED',
            'message', 'This lecture session has not started yet.',
            'starts_at', v_session.starts_at
        );
    END IF;

    IF v_now >= v_session.expires_at OR v_session.status = 'expired' THEN
        -- Mark as expired if not already
        IF v_session.status != 'expired' THEN
            UPDATE lecture_sessions SET status = 'expired' WHERE id = v_session.id;
        END IF;
        RETURN jsonb_build_object('success', false, 'error', 'SESSION_EXPIRED', 'message', 'This attendance session link has expired.');
    END IF;

    -- Generate random 256-bit attempt token
    v_attempt_token := encode(gen_random_bytes(32), 'hex');
    v_attempt_token_hash := encode(digest(v_attempt_token, 'sha256'), 'hex');

    -- Insert attendance attempt with 15-minute TTL
    INSERT INTO attendance_attempts (
        session_id,
        attempt_token_hash,
        step,
        expires_at,
        created_at
    ) VALUES (
        v_session.id,
        v_attempt_token_hash,
        'identity',
        v_now + INTERVAL '15 minutes',
        v_now
    ) RETURNING id INTO v_attempt_id;

    RETURN jsonb_build_object(
        'success', true,
        'attempt_id', v_attempt_id,
        'attempt_token', v_attempt_token,
        'session', jsonb_build_object(
            'id', v_session.id,
            'title', v_session.title,
            'course_code', v_session.course_code,
            'course_title', v_session.course_title,
            'starts_at', v_session.starts_at,
            'expires_at', v_session.expires_at,
            'grace_minutes', v_session.grace_minutes
        )
    );
END;
$$;

-- 7.2 Lookup Student Matric, Validate Enrollment & Optional Device Binding Hint
CREATE OR REPLACE FUNCTION rpc_lookup_matric(
    p_attempt_id UUID,
    p_attempt_token TEXT,
    p_raw_matric TEXT,
    p_device_id TEXT DEFAULT NULL,
    p_fingerprint_hash TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_attempt_hash TEXT;
    v_attempt RECORD;
    v_session RECORD;
    v_norm_matric TEXT;
    v_matric_hash TEXT;
    v_student RECORD;
    v_roster_exists BOOLEAN;
    v_existing_record RECORD;
    v_active_binding RECORD;
    v_now TIMESTAMPTZ := timezone('utc', now());
BEGIN
    IF p_attempt_token IS NULL OR p_raw_matric IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_REQUEST', 'message', 'Attempt token and matric number are required.');
    END IF;

    v_attempt_hash := encode(digest(p_attempt_token, 'sha256'), 'hex');

    -- Verify attempt
    SELECT * INTO v_attempt
    FROM attendance_attempts
    WHERE id = p_attempt_id AND attempt_token_hash = v_attempt_hash;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_ATTEMPT', 'message', 'Invalid or expired attempt token.');
    END IF;

    IF v_now >= v_attempt.expires_at OR v_attempt.completed_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'ATTEMPT_EXPIRED', 'message', 'This check-in attempt has expired. Please scan the QR code again.');
    END IF;

    -- Verify session still active
    SELECT * INTO v_session
    FROM lecture_sessions
    WHERE id = v_attempt.session_id;

    IF NOT FOUND OR v_session.status != 'active' OR v_now >= v_session.expires_at THEN
        RETURN jsonb_build_object('success', false, 'error', 'SESSION_EXPIRED', 'message', 'Lecture session has expired or is closed.');
    END IF;

    -- Normalize matric
    v_norm_matric := UPPER(TRIM(p_raw_matric));
    v_matric_hash := encode(digest(v_norm_matric, 'sha256'), 'hex');

    -- Search students_master
    SELECT * INTO v_student
    FROM students_master
    WHERE matric_no = v_norm_matric;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'STUDENT_NOT_FOUND', 'message', 'Matric number not found in institution student database.');
    END IF;

    -- Check course_roster qualification
    SELECT EXISTS (
        SELECT 1 FROM course_roster
        WHERE course_id = v_session.course_id AND student_id = v_student.id
    ) INTO v_roster_exists;

    IF NOT v_roster_exists THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'NOT_ON_ROSTER',
            'message', 'You are not on the authorized attendance roster for this course.'
        );
    END IF;

    -- Check if student already signed for this session
    SELECT * INTO v_existing_record
    FROM attendance_records
    WHERE session_id = v_session.id AND student_id = v_student.id;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'ALREADY_SIGNED',
            'message', 'Attendance has already been recorded for this student in this session.',
            'signed_at', v_existing_record.signed_at,
            'receipt_id', v_existing_record.receipt_id
        );
    END IF;

    -- Check if fingerprint is actively bound to another student
    IF p_fingerprint_hash IS NOT NULL AND length(trim(p_fingerprint_hash)) > 0 THEN
        SELECT * INTO v_active_binding
        FROM device_bindings
        WHERE fingerprint_hash = trim(p_fingerprint_hash) AND status = 'active'
        LIMIT 1;

        IF FOUND AND v_active_binding.student_id != v_student.id THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'DEVICE_REGISTERED_TO_ANOTHER',
                'message', 'This device is registered to another student. Contact the admin if this is an error.'
            );
        END IF;
    END IF;

    -- Update attempt with student_id and matric_hash
    UPDATE attendance_attempts
    SET student_id = v_student.id,
        matric_hash = v_matric_hash,
        device_id = trim(p_device_id),
        step = 'location'
    WHERE id = v_attempt.id;

    RETURN jsonb_build_object(
        'success', true,
        'student', jsonb_build_object(
            'id', v_student.id,
            'matric_no', v_student.matric_no,
            'surname', v_student.surname,
            'first_name', v_student.first_name,
            'middle_name', v_student.middle_name,
            'program', v_student.program,
            'level', v_student.level
        )
    );
END;
$$;

-- 7.2b Strict Device Check (Option 2 Anti-Proxy Specification)
CREATE OR REPLACE FUNCTION rpc_device_check(
    p_student_id UUID,
    p_fingerprint_hash TEXT,
    p_cookie_token_hash TEXT DEFAULT NULL,
    p_local_device_id UUID DEFAULT NULL,
    p_incognito_signal BOOLEAN DEFAULT false,
    p_user_agent TEXT DEFAULT NULL,
    p_ip TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_binding RECORD;
    v_other RECORD;
    v_ref_code TEXT;
    v_binding_id UUID;
    v_now TIMESTAMPTZ := timezone('utc', now());
    v_is_ios BOOLEAN := false;
BEGIN
    IF p_student_id IS NULL OR p_fingerprint_hash IS NULL OR length(trim(p_fingerprint_hash)) = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'allowed', false,
            'status', 400,
            'error', 'BAD_REQUEST',
            'reason', 'student_id and fingerprint_hash are required.',
            'action', 'CONTACT_ADMIN'
        );
    END IF;

    -- Detect iOS user agents (Safari deliberately reduces fingerprint entropy)
    IF p_user_agent IS NOT NULL AND (
        p_user_agent ILIKE '%iPhone%' OR 
        p_user_agent ILIKE '%iPad%' OR 
        p_user_agent ILIKE '%iPod%'
    ) THEN
        v_is_ios := true;
    END IF;

    -- Look up active binding for this student
    SELECT * INTO v_binding
    FROM device_bindings
    WHERE student_id = p_student_id AND status = 'active'
    LIMIT 1;

    -- -------------------------------------------------------------
    -- FIRST EVER SIGN-IN (OR POST-RESET): No active binding exists
    -- -------------------------------------------------------------
    IF NOT FOUND THEN
        -- Check: is this physical fingerprint already bound to a DIFFERENT student?
        SELECT * INTO v_other
        FROM device_bindings
        WHERE fingerprint_hash = p_fingerprint_hash AND status = 'active'
        LIMIT 1;

        IF FOUND THEN
            -- Impersonation attempt: student is attempting to sign on friend's phone
            v_ref_code := 'BIND-202-' || UPPER(substring(encode(gen_random_bytes(2), 'hex') FROM 1 FOR 4));
            
            INSERT INTO device_events (
                student_id,
                fingerprint_hash,
                event_type,
                reference_code,
                metadata,
                ip,
                user_agent,
                created_at
            ) VALUES (
                p_student_id,
                p_fingerprint_hash,
                'proxy_detected',
                v_ref_code,
                jsonb_build_object(
                    'conflict_with_student_id', v_other.student_id,
                    'conflict_binding_id', v_other.id,
                    'reason', 'Device registered to another student',
                    'proxy_risk', 'high'
                ),
                p_ip,
                p_user_agent,
                v_now
            );

            RETURN jsonb_build_object(
                'success', false,
                'allowed', false,
                'status', 403,
                'error', 'DEVICE_REGISTERED_TO_ANOTHER',
                'reason', 'This device is registered to another student. Contact the admin if this is an error.',
                'reference_code', v_ref_code,
                'action', 'CONTACT_ADMIN'
            );
        END IF;

        -- Safe to bind this device to this student
        v_ref_code := 'BIND-201-' || UPPER(substring(encode(gen_random_bytes(2), 'hex') FROM 1 FOR 4));
        
        INSERT INTO device_bindings (
            student_id,
            fingerprint_hash,
            device_id,
            trusted_cookie_hash,
            user_agent,
            first_bound_at,
            last_seen_at,
            status,
            is_shared
        ) VALUES (
            p_student_id,
            p_fingerprint_hash,
            p_local_device_id,
            p_cookie_token_hash,
            p_user_agent,
            v_now,
            v_now,
            'active',
            false
        ) RETURNING id INTO v_binding_id;

        INSERT INTO device_events (
            student_id,
            fingerprint_hash,
            event_type,
            reference_code,
            metadata,
            ip,
            user_agent,
            created_at
        ) VALUES (
            p_student_id,
            p_fingerprint_hash,
            'bind',
            v_ref_code,
            jsonb_build_object(
                'binding_id', v_binding_id,
                'is_first_bind', true
            ),
            p_ip,
            p_user_agent,
            v_now
        );

        RETURN jsonb_build_object(
            'success', true,
            'allowed', true,
            'status', 200,
            'action', 'BOUND',
            'binding_id', v_binding_id,
            'reference_code', v_ref_code,
            'is_new_binding', true
        );
    END IF;

    -- -------------------------------------------------------------
    -- SUBSEQUENT SIGN-IN: Active binding already exists
    -- -------------------------------------------------------------

    -- Case 4: Fingerprint does NOT match the bound fingerprint for this student
    IF v_binding.fingerprint_hash != p_fingerprint_hash THEN
        v_ref_code := 'BIND-201-' || UPPER(substring(encode(gen_random_bytes(2), 'hex') FROM 1 FOR 4));

        INSERT INTO device_events (
            student_id,
            fingerprint_hash,
            event_type,
            reference_code,
            metadata,
            ip,
            user_agent,
            created_at
        ) VALUES (
            p_student_id,
            p_fingerprint_hash,
            'mismatch',
            v_ref_code,
            jsonb_build_object(
                'expected_fingerprint_hash', v_binding.fingerprint_hash,
                'provided_fingerprint_hash', p_fingerprint_hash,
                'binding_id', v_binding.id
            ),
            p_ip,
            p_user_agent,
            v_now
        );

        RETURN jsonb_build_object(
            'success', false,
            'allowed', false,
            'status', 409,
            'error', 'NEW_DEVICE_DETECTED',
            'reason', 'New device detected. Contact the admin to reset your device, then try again.',
            'reference_code', v_ref_code,
            'action', 'CONTACT_ADMIN'
        );
    END IF;

    -- Case 2: Fingerprint matches, but BOTH cookie and localStorage device_id are missing
    IF p_cookie_token_hash IS NULL AND p_local_device_id IS NULL THEN
        IF p_incognito_signal = true THEN
            v_ref_code := 'BIND-205-' || UPPER(substring(encode(gen_random_bytes(2), 'hex') FROM 1 FOR 4));
            
            INSERT INTO device_events (
                student_id,
                fingerprint_hash,
                event_type,
                reference_code,
                metadata,
                ip,
                user_agent,
                created_at
            ) VALUES (
                p_student_id,
                p_fingerprint_hash,
                'cookie_missing',
                v_ref_code,
                jsonb_build_object(
                    'incognito_detected', true,
                    'binding_id', v_binding.id
                ),
                p_ip,
                p_user_agent,
                v_now
            );

            RETURN jsonb_build_object(
                'success', false,
                'allowed', false,
                'status', 403,
                'error', 'INCOGNITO_MODE_BLOCKED',
                'reason', 'Attendance is not allowed in Incognito. Open your normal browser.',
                'reference_code', v_ref_code,
                'action', 'OPEN_NORMAL_BROWSER'
            );
        ELSE
            v_ref_code := 'BIND-204-' || UPPER(substring(encode(gen_random_bytes(2), 'hex') FROM 1 FOR 4));
            
            INSERT INTO device_events (
                student_id,
                fingerprint_hash,
                event_type,
                reference_code,
                metadata,
                ip,
                user_agent,
                created_at
            ) VALUES (
                p_student_id,
                p_fingerprint_hash,
                'cookie_missing',
                v_ref_code,
                jsonb_build_object(
                    'cookie_missing', true,
                    'local_device_id_missing', true,
                    'binding_id', v_binding.id
                ),
                p_ip,
                p_user_agent,
                v_now
            );

            RETURN jsonb_build_object(
                'success', false,
                'allowed', false,
                'status', 409,
                'error', 'DEVICE_NOT_RECOGNIZED',
                'reason', 'This device is not fully recognised. Contact the admin to reset your device, then try again.',
                'reference_code', v_ref_code,
                'action', 'CONTACT_ADMIN'
            );
        END IF;
    END IF;

    -- Case 3 / Cookie Mismatch: Cookie provided does not match bound cookie hash
    IF p_cookie_token_hash IS NOT NULL AND v_binding.trusted_cookie_hash IS NOT NULL AND p_cookie_token_hash != v_binding.trusted_cookie_hash THEN
        v_ref_code := 'BIND-204-' || UPPER(substring(encode(gen_random_bytes(2), 'hex') FROM 1 FOR 4));

        INSERT INTO device_events (
            student_id,
            fingerprint_hash,
            event_type,
            reference_code,
            metadata,
            ip,
            user_agent,
            created_at
        ) VALUES (
            p_student_id,
            p_fingerprint_hash,
            'cookie_mismatch',
            v_ref_code,
            jsonb_build_object(
                'reason', 'Trusted cookie hash mismatch',
                'binding_id', v_binding.id
            ),
            p_ip,
            p_user_agent,
            v_now
        );

        RETURN jsonb_build_object(
            'success', false,
            'allowed', false,
            'status', 409,
            'error', 'DEVICE_NOT_RECOGNIZED',
            'reason', 'This device is not fully recognised. Contact the admin to reset your device, then try again.',
            'reference_code', v_ref_code,
            'action', 'CONTACT_ADMIN'
        );
    END IF;

    -- iOS strict entropy enforcement (Section 3 & 9):
    -- Safari reduces fingerprint entropy; require both cookie and local_device_id to match.
    IF v_is_ios AND (p_cookie_token_hash IS NULL OR p_local_device_id IS NULL) THEN
        v_ref_code := 'BIND-204-' || UPPER(substring(encode(gen_random_bytes(2), 'hex') FROM 1 FOR 4));

        INSERT INTO device_events (
            student_id,
            fingerprint_hash,
            event_type,
            reference_code,
            metadata,
            ip,
            user_agent,
            created_at
        ) VALUES (
            p_student_id,
            p_fingerprint_hash,
            'cookie_missing',
            v_ref_code,
            jsonb_build_object(
                'reason', 'iOS strict entropy check failed (cookie or device_id absent)',
                'binding_id', v_binding.id
            ),
            p_ip,
            p_user_agent,
            v_now
        );

        RETURN jsonb_build_object(
            'success', false,
            'allowed', false,
            'status', 409,
            'error', 'DEVICE_NOT_RECOGNIZED',
            'reason', 'This device is not fully recognised. Contact the admin to reset your device, then try again.',
            'reference_code', v_ref_code,
            'action', 'CONTACT_ADMIN'
        );
    END IF;

    -- Device ID mismatch if bound
    IF v_binding.device_id IS NOT NULL AND p_local_device_id IS NOT NULL AND v_binding.device_id != p_local_device_id THEN
        v_ref_code := 'BIND-204-' || UPPER(substring(encode(gen_random_bytes(2), 'hex') FROM 1 FOR 4));

        INSERT INTO device_events (
            student_id,
            fingerprint_hash,
            event_type,
            reference_code,
            metadata,
            ip,
            user_agent,
            created_at
        ) VALUES (
            p_student_id,
            p_fingerprint_hash,
            'mismatch',
            v_ref_code,
            jsonb_build_object(
                'reason', 'Local device_id mismatch',
                'expected_device_id', v_binding.device_id,
                'provided_device_id', p_local_device_id,
                'binding_id', v_binding.id
            ),
            p_ip,
            p_user_agent,
            v_now
        );

        RETURN jsonb_build_object(
            'success', false,
            'allowed', false,
            'status', 409,
            'error', 'DEVICE_NOT_RECOGNIZED',
            'reason', 'This device is not fully recognised. Contact the admin to reset your device, then try again.',
            'reference_code', v_ref_code,
            'action', 'CONTACT_ADMIN'
        );
    END IF;

    -- Case 1: Match! Update last_seen_at and any missing cookie/device_id
    v_ref_code := 'BIND-200-' || UPPER(substring(encode(gen_random_bytes(2), 'hex') FROM 1 FOR 4));

    UPDATE device_bindings
    SET last_seen_at = v_now,
        user_agent = COALESCE(p_user_agent, user_agent),
        device_id = COALESCE(v_binding.device_id, p_local_device_id),
        trusted_cookie_hash = COALESCE(v_binding.trusted_cookie_hash, p_cookie_token_hash)
    WHERE id = v_binding.id;

    INSERT INTO device_events (
        student_id,
        fingerprint_hash,
        event_type,
        reference_code,
        metadata,
        ip,
        user_agent,
        created_at
    ) VALUES (
        p_student_id,
        p_fingerprint_hash,
        'match',
        v_ref_code,
        jsonb_build_object(
            'binding_id', v_binding.id,
            'is_shared', v_binding.is_shared
        ),
        p_ip,
        p_user_agent,
        v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'allowed', true,
        'status', 200,
        'action', 'OK',
        'binding_id', v_binding.id,
        'is_shared', v_binding.is_shared,
        'reference_code', v_ref_code
    );
END;
$$;

-- 7.3 Record and Verify Geolocation
CREATE OR REPLACE FUNCTION rpc_verify_location(
    p_attempt_id UUID,
    p_attempt_token TEXT,
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_accuracy_m DOUBLE PRECISION
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_attempt_hash TEXT;
    v_attempt RECORD;
    v_settings RECORD;
    v_inside_boundary BOOLEAN := true;
    v_accuracy_valid BOOLEAN := true;
    v_now TIMESTAMPTZ := timezone('utc', now());
BEGIN
    v_attempt_hash := encode(digest(p_attempt_token, 'sha256'), 'hex');

    SELECT * INTO v_attempt
    FROM attendance_attempts
    WHERE id = p_attempt_id AND attempt_token_hash = v_attempt_hash;

    IF NOT FOUND OR v_now >= v_attempt.expires_at OR v_attempt.completed_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'ATTEMPT_EXPIRED', 'message', 'Attempt has expired.');
    END IF;

    -- Fetch global settings
    SELECT * INTO v_settings FROM settings WHERE id = 1;

    -- Evaluate accuracy threshold
    IF p_accuracy_m > v_settings.location_accuracy_threshold_m THEN
        v_accuracy_valid := false;
    END IF;

    -- Evaluate Geofence boundary if configured
    IF v_settings.campus_boundary_geojson IS NOT NULL THEN
        v_inside_boundary := fn_is_point_in_geojson_polygon(p_latitude, p_longitude, v_settings.campus_boundary_geojson);
    END IF;

    -- If location_mode is 'enforce', reject outside coordinates or inaccurate readings
    IF v_settings.location_mode = 'enforce' THEN
        IF NOT v_accuracy_valid THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'LOW_ACCURACY',
                'message', 'Location accuracy (' || round(p_accuracy_m::numeric, 1) || 'm) exceeds maximum threshold (' || v_settings.location_accuracy_threshold_m || 'm). Please move to an open area and retry.',
                'accuracy_m', p_accuracy_m,
                'threshold_m', v_settings.location_accuracy_threshold_m
            );
        END IF;

        IF NOT v_inside_boundary THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'OUTSIDE_CAMPUS_BOUNDARY',
                'message', 'Your current location is outside the authorized Admiralty University campus boundary.',
                'inside_boundary', false
            );
        END IF;
    END IF;

    -- Update attempt with location
    UPDATE attendance_attempts
    SET latitude = p_latitude,
        longitude = p_longitude,
        accuracy_m = p_accuracy_m,
        step = 'selfie'
    WHERE id = v_attempt.id;

    RETURN jsonb_build_object(
        'success', true,
        'location_mode', v_settings.location_mode,
        'inside_boundary', v_inside_boundary,
        'accuracy_valid', v_accuracy_valid,
        'accuracy_m', p_accuracy_m
    );
END;
$$;

-- 7.4 Atomically Submit Attendance and Issue Receipt
CREATE OR REPLACE FUNCTION rpc_submit_attendance(
    p_attempt_id UUID,
    p_attempt_token TEXT,
    p_selfie_path TEXT,
    p_device_info JSONB DEFAULT '{}'::jsonb,
    p_idempotency_key TEXT DEFAULT NULL,
    p_fingerprint_hash TEXT DEFAULT NULL,
    p_binding_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_attempt_hash TEXT;
    v_attempt RECORD;
    v_session RECORD;
    v_course RECORD;
    v_student RECORD;
    v_existing_rec RECORD;
    v_status attendance_status;
    v_now_utc TIMESTAMPTZ := timezone('utc', now());
    v_now_lagos TIMESTAMPTZ := timezone('Africa/Lagos', now());
    v_receipt_id TEXT;
    v_record_id UUID;
    v_fingerprint_hash TEXT;
    v_binding_id UUID;
    v_proxy_risk proxy_risk_level := 'low';
    v_binding RECORD;
    v_ref_code TEXT;
BEGIN
    -- Idempotency check: if key already used, return existing record
    IF p_idempotency_key IS NOT NULL THEN
        SELECT r.*, c.code AS course_code, c.title AS course_title, s.matric_no, s.surname, s.first_name
        INTO v_existing_rec
        FROM attendance_records r
        JOIN courses c ON c.id = r.course_id
        JOIN students_master s ON s.id = r.student_id
        WHERE r.idempotency_key = p_idempotency_key;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'success', true,
                'is_idempotent_replay', true,
                'receipt_id', v_existing_rec.receipt_id,
                'status', v_existing_rec.status,
                'signed_at', v_existing_rec.signed_at,
                'course_code', v_existing_rec.course_code,
                'course_title', v_existing_rec.course_title,
                'student_name', v_existing_rec.surname || ' ' || v_existing_rec.first_name,
                'matric_no', v_existing_rec.matric_no
            );
        END IF;
    END IF;

    -- Verify attempt
    v_attempt_hash := encode(digest(p_attempt_token, 'sha256'), 'hex');

    SELECT * INTO v_attempt
    FROM attendance_attempts
    WHERE id = p_attempt_id AND attempt_token_hash = v_attempt_hash;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_ATTEMPT', 'message', 'Invalid attempt session.');
    END IF;

    IF v_now_utc >= v_attempt.expires_at OR v_attempt.completed_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'ATTEMPT_EXPIRED', 'message', 'This attendance attempt has expired.');
    END IF;

    IF v_attempt.student_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'IDENTITY_MISSING', 'message', 'Student identity was not established.');
    END IF;

    IF p_selfie_path IS NULL OR length(trim(p_selfie_path)) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'SELFIE_REQUIRED', 'message', 'Selfie evidence is mandatory.');
    END IF;

    -- Fetch session & verify active
    SELECT * INTO v_session
    FROM lecture_sessions
    WHERE id = v_attempt.session_id;

    IF NOT FOUND OR v_session.status != 'active' OR v_now_utc >= v_session.expires_at THEN
        RETURN jsonb_build_object('success', false, 'error', 'SESSION_EXPIRED', 'message', 'Lecture session is no longer active.');
    END IF;

    SELECT * INTO v_course FROM courses WHERE id = v_session.course_id;
    SELECT * INTO v_student FROM students_master WHERE id = v_attempt.student_id;

    -- Prevent duplicate sign-in
    SELECT * INTO v_existing_rec
    FROM attendance_records
    WHERE session_id = v_session.id AND student_id = v_student.id;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'ALREADY_SIGNED',
            'message', 'Attendance has already been signed for this lecture.',
            'receipt_id', v_existing_rec.receipt_id,
            'signed_at', v_existing_rec.signed_at
        );
    END IF;

    -- Resolve effective fingerprint_hash and binding_id
    v_fingerprint_hash := COALESCE(
        p_fingerprint_hash,
        p_device_info->>'fingerprint_hash',
        v_attempt.fingerprint_hash
    );

    IF p_binding_id IS NOT NULL THEN
        v_binding_id := p_binding_id;
    ELSIF p_device_info->>'binding_id' IS NOT NULL AND length(p_device_info->>'binding_id') > 0 THEN
        v_binding_id := (p_device_info->>'binding_id')::UUID;
    ELSE
        SELECT id, is_shared INTO v_binding
        FROM device_bindings
        WHERE student_id = v_student.id AND status = 'active'
        LIMIT 1;

        IF FOUND THEN
            v_binding_id := v_binding.id;
            IF v_binding.is_shared = true THEN
                v_proxy_risk := 'medium';
            END IF;
        END IF;
    END IF;

    -- Check if active binding marked as shared (raises proxy_risk)
    IF v_binding_id IS NOT NULL AND v_proxy_risk = 'low' THEN
        SELECT is_shared INTO v_binding
        FROM device_bindings
        WHERE id = v_binding_id;

        IF FOUND AND v_binding.is_shared = true THEN
            v_proxy_risk := 'medium';
        END IF;
    END IF;

    -- BELT-AND-BRACES: Same-Session Multi-Student Collision Check (Section 10 of Spec)
    -- Checks if this physical device fingerprint was already used to sign for a different student in this session
    IF v_fingerprint_hash IS NOT NULL AND length(trim(v_fingerprint_hash)) > 0 THEN
        IF EXISTS (
            SELECT 1 FROM attendance_records
            WHERE session_id = v_session.id
              AND fingerprint_hash = v_fingerprint_hash
              AND student_id <> v_student.id
            LIMIT 1
        ) THEN
            v_ref_code := 'BIND-203-' || UPPER(substring(encode(gen_random_bytes(2), 'hex') FROM 1 FOR 4));

            INSERT INTO device_events (
                student_id,
                fingerprint_hash,
                event_type,
                reference_code,
                metadata,
                ip,
                user_agent,
                created_at
            ) VALUES (
                v_student.id,
                v_fingerprint_hash,
                'proxy_detected',
                v_ref_code,
                jsonb_build_object(
                    'session_id', v_session.id,
                    'course_id', v_course.id,
                    'proxy_risk', 'high',
                    'reason', 'Same-session multi-student collision detected'
                ),
                p_device_info->>'ip',
                p_device_info->>'user_agent',
                v_now_utc
            );

            RETURN jsonb_build_object(
                'success', false,
                'error', 'PROXY_DETECTED',
                'reason', 'This device has already been used for another student in this session. Contact the admin.',
                'reference_code', v_ref_code,
                'action', 'CONTACT_ADMIN'
            );
        END IF;
    END IF;

    -- Determine 'present' vs 'late' based on session start time + grace minutes
    IF v_now_utc <= (v_session.starts_at + (v_session.grace_minutes || ' minutes')::INTERVAL) THEN
        v_status := 'present';
    ELSE
        v_status := 'late';
    END IF;

    -- Generate human-verifiable unique receipt ID (e.g. ADUN-20261108-A7F92B)
    v_receipt_id := 'ADUN-' || to_char(v_now_lagos, 'YYYYMMDD') || '-' || UPPER(substring(encode(gen_random_bytes(4), 'hex') FROM 1 FOR 6));

    -- Insert attendance record atomically with fingerprint snapshot and binding link
    INSERT INTO attendance_records (
        session_id,
        course_id,
        student_id,
        signed_at,
        status,
        latitude,
        longitude,
        accuracy_m,
        selfie_path,
        verification_status,
        device_info,
        receipt_id,
        idempotency_key,
        fingerprint_hash,
        binding_id,
        proxy_risk
    ) VALUES (
        v_session.id,
        v_course.id,
        v_student.id,
        v_now_utc,
        v_status,
        v_attempt.latitude,
        v_attempt.longitude,
        v_attempt.accuracy_m,
        trim(p_selfie_path),
        'passed',
        p_device_info,
        v_receipt_id,
        p_idempotency_key,
        v_fingerprint_hash,
        v_binding_id,
        v_proxy_risk
    ) RETURNING id INTO v_record_id;

    -- Update binding last_seen_at
    IF v_binding_id IS NOT NULL THEN
        UPDATE device_bindings
        SET last_seen_at = v_now_utc
        WHERE id = v_binding_id;
    END IF;

    -- Complete attempt
    UPDATE attendance_attempts
    SET step = 'submitted',
        selfie_path = trim(p_selfie_path),
        completed_at = v_now_utc
    WHERE id = v_attempt.id;

    -- Create audit log
    INSERT INTO audit_logs (
        actor_id,
        actor_role,
        action,
        entity,
        entity_id,
        metadata
    ) VALUES (
        NULL,
        'student',
        'ATTENDANCE_SIGNED',
        'attendance_records',
        v_record_id::text,
        jsonb_build_object(
            'matric_no', v_student.matric_no,
            'receipt_id', v_receipt_id,
            'status', v_status,
            'session_id', v_session.id,
            'course_code', v_course.code,
            'proxy_risk', v_proxy_risk
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'receipt_id', v_receipt_id,
        'status', v_status,
        'signed_at', v_now_utc,
        'course_code', v_course.code,
        'course_title', v_course.title,
        'student_name', v_student.surname || ' ' || v_student.first_name,
        'matric_no', v_student.matric_no
    );
END;
$$;

-- 7.5 Reset Student Device Binding (Admin / Lecturer only)
CREATE OR REPLACE FUNCTION rpc_reset_device_binding(
    p_student_id UUID,
    p_actor_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_actor RECORD;
    v_reset_count INTEGER;
    v_reset_fingerprint TEXT;
    v_ref_code TEXT;
    v_now TIMESTAMPTZ := timezone('utc', now());
BEGIN
    IF p_student_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'BAD_REQUEST', 'message', 'student_id is required.');
    END IF;

    IF p_actor_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'actor_id is required.');
    END IF;

    -- MANDATORY REASON CHECK: Per spec, reset requires a free text reason field stored in device_events
    IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'REASON_REQUIRED',
            'message', 'A reason is mandatory for resetting a student device binding.'
        );
    END IF;

    SELECT * INTO v_actor FROM users WHERE id = p_actor_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Authorized user not found.');
    END IF;

    -- Retrieve current bound fingerprint prior to reset
    SELECT fingerprint_hash INTO v_reset_fingerprint
    FROM device_bindings
    WHERE student_id = p_student_id AND status = 'active'
    LIMIT 1;

    -- Transition active binding to 'reset' status (preserving history)
    UPDATE device_bindings
    SET status = 'reset',
        reset_by = p_actor_id,
        reset_at = v_now
    WHERE student_id = p_student_id AND status = 'active';

    GET DIAGNOSTICS v_reset_count = ROW_COUNT;

    v_ref_code := 'BIND-206-' || UPPER(substring(encode(gen_random_bytes(2), 'hex') FROM 1 FOR 4));

    -- Forensic device event log
    INSERT INTO device_events (
        student_id,
        fingerprint_hash,
        event_type,
        reference_code,
        metadata,
        created_at
    ) VALUES (
        p_student_id,
        COALESCE(v_reset_fingerprint, 'unknown'),
        'admin_reset',
        v_ref_code,
        jsonb_build_object(
            'actor_id', p_actor_id,
            'actor_role', v_actor.role::text,
            'reason', trim(p_reason),
            'reset_count', v_reset_count
        ),
        v_now
    );

    -- Administrative audit log
    INSERT INTO audit_logs (
        actor_id,
        actor_role,
        action,
        entity,
        entity_id,
        metadata
    ) VALUES (
        p_actor_id,
        v_actor.role::text,
        'DEVICE_BINDING_RESET',
        'device_bindings',
        p_student_id::text,
        jsonb_build_object(
            'reason', trim(p_reason),
            'reset_count', v_reset_count,
            'reference_code', v_ref_code
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'reset_count', v_reset_count,
        'student_id', p_student_id,
        'reference_code', v_ref_code
    );
END;
$$;

-- 8. ROW LEVEL SECURITY (RLS) POLICIES

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE students_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE lecture_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Helper to get current user role
CREATE OR REPLACE FUNCTION auth_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT role::text FROM users WHERE auth_id = auth.uid() OR id = auth.uid() LIMIT 1;
$$;

-- Helper to get current user primary id
CREATE OR REPLACE FUNCTION auth_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT id FROM users WHERE auth_id = auth.uid() OR id = auth.uid() LIMIT 1;
$$;

-- 8.1 USERS TABLE RLS
DROP POLICY IF EXISTS "Admin full access on users" ON users;
CREATE POLICY "Admin full access on users" ON users
    FOR ALL
    TO authenticated
    USING (auth_user_role() = 'admin')
    WITH CHECK (auth_user_role() = 'admin');

DROP POLICY IF EXISTS "Lecturers can view and update own profile" ON users;
CREATE POLICY "Lecturers can view and update own profile" ON users
    FOR SELECT
    TO authenticated
    USING (auth_id = auth.uid() OR id = auth.uid());

-- 8.2 STUDENTS_MASTER RLS
DROP POLICY IF EXISTS "Admin full access on students_master" ON students_master;
CREATE POLICY "Admin full access on students_master" ON students_master
    FOR ALL
    TO authenticated
    USING (auth_user_role() = 'admin')
    WITH CHECK (auth_user_role() = 'admin');

DROP POLICY IF EXISTS "Lecturers can select enrolled students" ON students_master;
CREATE POLICY "Lecturers can select enrolled students" ON students_master
    FOR SELECT
    TO authenticated
    USING (
        auth_user_role() = 'lecturer' AND id IN (
            SELECT r.student_id FROM course_roster r
            JOIN courses c ON c.id = r.course_id
            WHERE c.lecturer_id = auth_user_id()
        )
    );

-- 8.3 COURSES RLS
DROP POLICY IF EXISTS "Admin full access on courses" ON courses;
CREATE POLICY "Admin full access on courses" ON courses
    FOR ALL
    TO authenticated
    USING (auth_user_role() = 'admin')
    WITH CHECK (auth_user_role() = 'admin');

DROP POLICY IF EXISTS "Lecturers manage own courses" ON courses;
CREATE POLICY "Lecturers manage own courses" ON courses
    FOR ALL
    TO authenticated
    USING (lecturer_id = auth_user_id())
    WITH CHECK (lecturer_id = auth_user_id());

-- 8.4 COURSE_ROSTER RLS
DROP POLICY IF EXISTS "Admin full access on course_roster" ON course_roster;
CREATE POLICY "Admin full access on course_roster" ON course_roster
    FOR ALL
    TO authenticated
    USING (auth_user_role() = 'admin')
    WITH CHECK (auth_user_role() = 'admin');

DROP POLICY IF EXISTS "Lecturers manage roster for own courses" ON course_roster;
CREATE POLICY "Lecturers manage roster for own courses" ON course_roster
    FOR ALL
    TO authenticated
    USING (
        course_id IN (SELECT id FROM courses WHERE lecturer_id = auth_user_id())
    )
    WITH CHECK (
        course_id IN (SELECT id FROM courses WHERE lecturer_id = auth_user_id())
    );

-- 8.5 LECTURE_SESSIONS RLS
DROP POLICY IF EXISTS "Admin full access on lecture_sessions" ON lecture_sessions;
CREATE POLICY "Admin full access on lecture_sessions" ON lecture_sessions
    FOR ALL
    TO authenticated
    USING (auth_user_role() = 'admin')
    WITH CHECK (auth_user_role() = 'admin');

DROP POLICY IF EXISTS "Lecturers manage own lecture sessions" ON lecture_sessions;
CREATE POLICY "Lecturers manage own lecture sessions" ON lecture_sessions
    FOR ALL
    TO authenticated
    USING (
        course_id IN (SELECT id FROM courses WHERE lecturer_id = auth_user_id())
    )
    WITH CHECK (
        course_id IN (SELECT id FROM courses WHERE lecturer_id = auth_user_id())
    );

-- 8.6 ATTENDANCE_ATTEMPTS RLS
DROP POLICY IF EXISTS "Admin can view attempts" ON attendance_attempts;
CREATE POLICY "Admin can view attempts" ON attendance_attempts
    FOR SELECT
    TO authenticated
    USING (auth_user_role() = 'admin');

-- 8.7 ATTENDANCE_RECORDS RLS (Immutable for Lecturers!)
DROP POLICY IF EXISTS "Admin full view and export on records" ON attendance_records;
CREATE POLICY "Admin full view and export on records" ON attendance_records
    FOR SELECT
    TO authenticated
    USING (auth_user_role() = 'admin');

DROP POLICY IF EXISTS "Lecturers view attendance for their courses" ON attendance_records;
CREATE POLICY "Lecturers view attendance for their courses" ON attendance_records
    FOR SELECT
    TO authenticated
    USING (
        course_id IN (SELECT id FROM courses WHERE lecturer_id = auth_user_id())
    );

-- STRICT RULE: Lecturers CANNOT UPDATE OR DELETE attendance records!
-- Inserts happen strictly through secure RPC / Edge Functions.

-- 8.8 DEVICE_BINDINGS RLS
DROP POLICY IF EXISTS "Admin manage device bindings" ON device_bindings;
CREATE POLICY "Admin manage device bindings" ON device_bindings
    FOR ALL
    TO authenticated
    USING (auth_user_role() = 'admin');

DROP POLICY IF EXISTS "Lecturers view and reset device bindings for their students" ON device_bindings;
CREATE POLICY "Lecturers view and reset device bindings for their students" ON device_bindings
    FOR SELECT
    TO authenticated
    USING (
        student_id IN (
            SELECT r.student_id FROM course_roster r
            JOIN courses c ON c.id = r.course_id
            WHERE c.lecturer_id = auth_user_id()
        )
    );

-- 8.8b DEVICE_EVENTS RLS (Forensic audit trail)
DROP POLICY IF EXISTS "Admin view device events" ON device_events;
CREATE POLICY "Admin view device events" ON device_events
    FOR SELECT
    TO authenticated
    USING (auth_user_role() = 'admin');

DROP POLICY IF EXISTS "Lecturers view device events for their students" ON device_events;
CREATE POLICY "Lecturers view device events for their students" ON device_events
    FOR SELECT
    TO authenticated
    USING (
        student_id IN (
            SELECT r.student_id FROM course_roster r
            JOIN courses c ON c.id = r.course_id
            WHERE c.lecturer_id = auth_user_id()
        )
    );

-- 8.9 AUDIT_LOGS RLS (Append-only)
DROP POLICY IF EXISTS "Admin view audit logs" ON audit_logs;
CREATE POLICY "Admin view audit logs" ON audit_logs
    FOR SELECT
    TO authenticated
    USING (auth_user_role() = 'admin');

-- 8.10 SETTINGS RLS
DROP POLICY IF EXISTS "Admin manage settings" ON settings;
CREATE POLICY "Admin manage settings" ON settings
    FOR ALL
    TO authenticated
    USING (auth_user_role() = 'admin')
    WITH CHECK (auth_user_role() = 'admin');

DROP POLICY IF EXISTS "Lecturers view settings" ON settings;
CREATE POLICY "Lecturers view settings" ON settings
    FOR SELECT
    TO authenticated
    USING (auth_user_role() = 'lecturer');

-- 9. SUPABASE STORAGE BUCKET CONFIGURATION (Selfies)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'selfies',
    'selfies',
    false,
    5242880, -- 5 MB limit
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Storage RLS: anon cannot read or list selfies directly
DROP POLICY IF EXISTS "Authenticated users cannot view selfies without signed URL" ON storage.objects;
DROP POLICY IF EXISTS "Allow service role and admins to access selfies" ON storage.objects;

CREATE POLICY "Allow service role and admins to access selfies" ON storage.objects
    FOR ALL
    TO authenticated
    USING (bucket_id = 'selfies' AND auth_user_role() = 'admin')
    WITH CHECK (bucket_id = 'selfies' AND auth_user_role() = 'admin');

-- 10. SYSTEM SEED (MANDATORY ADMIN ACCOUNT & SYSTEM SETTINGS ONLY)
-- STRICT INSTRUCTION: NO DUMMY STUDENTS, NO DUMMY COURSES, NO DUMMY ATTENDANCE!

-- 10.1 Default Settings Singleton
INSERT INTO settings (
    id,
    location_mode,
    campus_boundary_geojson,
    location_accuracy_threshold_m,
    default_session_duration_minutes,
    max_session_duration_minutes,
    selfie_retention_days,
    grace_minutes,
    max_active_courses_per_lecturer,
    rate_limit_token_per_minute,
    rate_limit_matric_per_minute
) VALUES (
    1,
    'evidence_only',
    NULL,
    50.0,
    60,
    180,
    180,
    10,
    9,
    60,
    30
) ON CONFLICT (id) DO NOTHING;

-- 10.2 Mandatory Seed Admin Account
-- Username: admin
-- Password: admin (hashed using Blowfish crypt / bcrypt standard)
-- Role: admin
-- Must Change Password: true
INSERT INTO users (
    id,
    role,
    username,
    email,
    password_hash,
    status,
    must_change_password,
    created_at
) VALUES (
    '00000000-0000-0000-0000-000000000001'::uuid,
    'admin',
    'admin',
    'admin@adun.edu.ng',
    crypt('admin', gen_salt('bf', 10)),
    'active',
    true,
    timezone('utc', now())
) ON CONFLICT (username) DO NOTHING;

-- Log initialization
INSERT INTO audit_logs (
    actor_id,
    actor_role,
    action,
    entity,
    entity_id,
    metadata
) VALUES (
    '00000000-0000-0000-0000-000000000001'::uuid,
    'system',
    'SYSTEM_SCHEMA_INITIALIZED',
    'system',
    '20261108000000',
    '{"description": "ADUN Attendance schema created with seed admin and default settings. Zero mock/demo data inserted."}'::jsonb
);
