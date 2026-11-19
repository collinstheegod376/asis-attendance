-- ============================================================================
-- Migration: 20261119000003_layered_geofence_and_dynamic_qr.sql
-- Description:
--   Implements Part A of Implementation Plan (v3) + Patch v4 + Confirmed Decisions:
--   1. Enables pgcrypto extension.
--   2. Adds test_mode, test_mode_expires_at, qr_secret, and 4-step expires_at
--      backfill + index to public.lecture_sessions.
--   3. Adds qr_verified, device_hash, heartbeat_pass_count, heartbeat_total_count,
--      final_status, finalized_at + indexes to public.attendance_attempts.
--   4. Creates public.attendance_heartbeats table + index + RLS.
--   5. Ensures public.rate_limits table and adds public.rpc_check_rate_limit().
--   6. Updates settings.location_accuracy_threshold_m default & row id=1 to 120.0m
--      while keeping default_session_duration_minutes and max_session_duration_minutes untouched.
--   7. Creates public.rpc_get_live_qr(p_session_id UUID) for 45-second HMAC buckets.
--   8. Updates public.rpc_validate_session_token() with live QR verification,
--      90-second grace window (current & previous 45s bucket), test_mode bypass,
--      and device_hash persistence (dropping old 2-arg overload).
--   9. Updates public.rpc_verify_location() and public.rpc_submit_attendance()
--      with tiered accuracy-to-radius enforcement (<=60m -> radius_m,
--      60m..120m -> radius_m * 0.6, >120m -> LOW_ACCURACY), LIVE_QR_REQUIRED,
--      3-second sanity check, and session expires_at enforcement.
--  10. Creates public.rpc_log_heartbeat() with tiered radius + failed_events
--      audit flushing (inside_fence = NULL, status_note = 'network_failure',
--      without incrementing heartbeat_total_count).
--  11. Creates public.rpc_finalize_attempt() and public.rpc_finalize_session_attempts()
--      (0 heartbeats => 'verified', >=60% => 'verified', >=25% => 'partial', else 'rejected').
--  12. Creates public.v_device_hash_collisions view for anti-proxy monitoring.
--  13. Enforces strict REVOKE/GRANT permissions on all RPCs and views.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ENABLE PGCRYPTO EXTENSION
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 2. ALTER public.lecture_sessions (QR SECRET, TEST MODE, 4-STEP EXPIRES_AT)
-- ----------------------------------------------------------------------------
ALTER TABLE public.lecture_sessions
    ADD COLUMN IF NOT EXISTS test_mode BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS test_mode_expires_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS qr_secret BYTEA NOT NULL DEFAULT extensions.gen_random_bytes(32);

-- 4-step expires_at backfill (Issue 3)
ALTER TABLE public.lecture_sessions
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE public.lecture_sessions
SET expires_at = COALESCE(created_at, now() - interval '7 days') + interval '3 hours'
WHERE expires_at IS NULL;

ALTER TABLE public.lecture_sessions
    ALTER COLUMN expires_at SET NOT NULL;

ALTER TABLE public.lecture_sessions
    ALTER COLUMN expires_at SET DEFAULT (now() + interval '3 hours');

CREATE INDEX IF NOT EXISTS idx_lecture_sessions_expires_at
    ON public.lecture_sessions(expires_at);

-- ----------------------------------------------------------------------------
-- 3. ALTER public.attendance_attempts (QR, DEVICE HASH, HEARTBEATS, FINAL STATUS)
-- ----------------------------------------------------------------------------
ALTER TABLE public.attendance_attempts
    ADD COLUMN IF NOT EXISTS qr_verified BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS device_hash TEXT NULL,
    ADD COLUMN IF NOT EXISTS heartbeat_pass_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS heartbeat_total_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS final_status TEXT NULL CHECK (final_status IN ('verified', 'partial', 'rejected')),
    ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_attempts_session_device
    ON public.attendance_attempts(session_id, device_hash);

CREATE INDEX IF NOT EXISTS idx_attempts_final_status
    ON public.attendance_attempts(session_id, final_status);

-- ----------------------------------------------------------------------------
-- 4. CREATE public.attendance_heartbeats TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_heartbeats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES public.attendance_attempts(id) ON DELETE CASCADE,
    lat DOUBLE PRECISION NULL,
    lon DOUBLE PRECISION NULL,
    accuracy_m NUMERIC NULL,
    distance_m NUMERIC NULL,
    effective_radius_m NUMERIC NULL,
    inside_fence BOOLEAN NULL,
    status_note TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_heartbeats_attempt
    ON public.attendance_heartbeats(attempt_id);

ALTER TABLE public.attendance_heartbeats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_heartbeats FROM anon, authenticated, public;
GRANT ALL ON public.attendance_heartbeats TO service_role;

-- ----------------------------------------------------------------------------
-- 5. RATE LIMIT TABLE & public.rpc_check_rate_limit (Issue 4)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rate_limits (
    key TEXT PRIMARY KEY,
    count INT NOT NULL DEFAULT 1,
    window_start TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limits FROM anon, authenticated, public;
GRANT ALL ON public.rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.rpc_check_rate_limit(
    p_key TEXT,
    p_limit INT,
    p_window_seconds INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_key IS NULL OR length(trim(p_key)) = 0
       OR p_limit IS NULL OR p_limit <= 0
       OR p_window_seconds IS NULL OR p_window_seconds <= 0
    THEN
        RETURN false;
    END IF;

    RETURN public.fn_rate_limit(p_key, p_limit, p_window_seconds);
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. UPDATE public.settings ACCURACY THRESHOLD TO 120.0M
--    (Keep default_session_duration_minutes & max_session_duration_minutes untouched)
-- ----------------------------------------------------------------------------
ALTER TABLE public.settings
    ALTER COLUMN location_accuracy_threshold_m SET DEFAULT 120.0;

UPDATE public.settings
SET location_accuracy_threshold_m = 120.0,
    updated_at = clock_timestamp()
WHERE id = 1;

-- ----------------------------------------------------------------------------
-- 7. CREATE public.rpc_get_live_qr(p_session_id UUID)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_live_qr(
    p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_session RECORD;
    v_caller_id UUID;
    v_caller_role TEXT;
    v_bucket BIGINT;
    v_sig TEXT;
    v_expires TIMESTAMPTZ;
    v_effective_test_mode BOOLEAN;
BEGIN
    IF p_session_id IS NULL THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', 'SESSION_NOT_FOUND',
            'message', 'Session ID is required.'
        );
    END IF;

    SELECT ls.*, c.lecturer_id
    INTO v_session
    FROM public.lecture_sessions ls
    JOIN public.courses c ON c.id = ls.course_id
    WHERE ls.id = p_session_id;

    IF v_session.id IS NULL THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', 'SESSION_NOT_FOUND',
            'message', 'Lecture session not found.'
        );
    END IF;

    -- If called by an authenticated user (not service_role), verify ownership or admin role
    IF auth.uid() IS NOT NULL THEN
        SELECT id, role::text INTO v_caller_id, v_caller_role
        FROM public.users
        WHERE auth_id = auth.uid() OR id = auth.uid()
        LIMIT 1;

        IF v_caller_id IS NULL OR (
            v_caller_role <> 'admin'
            AND v_session.created_by <> v_caller_id
            AND v_session.lecturer_id <> v_caller_id
        ) THEN
            RETURN jsonb_build_object(
                'ok', false,
                'error', 'FORBIDDEN',
                'message', 'You are not authorized to access the live QR for this session.'
            );
        END IF;
    END IF;

    IF v_session.status <> 'active' THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', 'SESSION_CLOSED',
            'message', 'Lecture session has been closed.'
        );
    END IF;

    IF clock_timestamp() > v_session.expires_at THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', 'SESSION_ENDED',
            'message', 'Lecture session has ended.'
        );
    END IF;

    v_bucket := floor(extract(epoch FROM clock_timestamp()) / 45)::BIGINT;
    v_sig := encode(
        extensions.hmac(
            convert_to(v_session.id::text || ':' || v_bucket::text, 'UTF8'),
            v_session.qr_secret,
            'sha256'
        ),
        'hex'
    );
    v_expires := to_timestamp((v_bucket + 1) * 45);
    v_effective_test_mode := v_session.test_mode
        AND (v_session.test_mode_expires_at IS NULL OR clock_timestamp() <= v_session.test_mode_expires_at);

    RETURN jsonb_build_object(
        'ok', true,
        'bucket', v_bucket,
        'signature', v_sig,
        'expires_at', v_expires,
        'test_mode', v_effective_test_mode
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. UPDATE public.rpc_validate_session_token (DROP 2-ARG OVERLOAD FIRST)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.rpc_validate_session_token(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.rpc_validate_session_token(
    p_raw_token TEXT,
    p_existing_attempt_token TEXT DEFAULT NULL,
    p_qr_bucket BIGINT DEFAULT NULL,
    p_qr_sig TEXT DEFAULT NULL,
    p_device_hash TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_token_hash TEXT;
    v_session RECORD;
    v_existing_token_hash TEXT;
    v_existing_attempt RECORD;
    v_new_attempt_token TEXT;
    v_new_token_hash TEXT;
    v_attempt_id UUID;
    v_attempt_expires_at TIMESTAMPTZ;
    v_location_enabled BOOLEAN;
    v_effective_test_mode BOOLEAN;
    v_current_bucket BIGINT;
    v_expected_sig TEXT;
    v_qr_valid BOOLEAN := false;
    v_clean_device_hash TEXT;
BEGIN
    IF p_raw_token IS NULL OR length(trim(p_raw_token)) = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'INVALID_TOKEN',
            'message', 'Token is missing or empty.'
        );
    END IF;

    v_token_hash := encode(digest(p_raw_token, 'sha256'), 'hex');

    SELECT * INTO v_session
    FROM public.lecture_sessions
    WHERE token_hash = v_token_hash;

    IF v_session.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'INVALID_TOKEN',
            'message', 'Lecture session not found for this token.'
        );
    END IF;

    IF v_session.status <> 'active' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'SESSION_CLOSED',
            'message', 'Lecture session has ended or is closed.'
        );
    END IF;

    IF clock_timestamp() < v_session.starts_at THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'SESSION_NOT_STARTED',
            'message', 'Lecture session check-in has not started yet.'
        );
    END IF;

    IF clock_timestamp() > v_session.expires_at THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'SESSION_EXPIRED',
            'message', 'Lecture session check-in has expired.'
        );
    END IF;

    v_location_enabled := (v_session.latitude IS NOT NULL AND v_session.longitude IS NOT NULL);
    v_effective_test_mode := v_session.test_mode
        AND (v_session.test_mode_expires_at IS NULL OR clock_timestamp() <= v_session.test_mode_expires_at);
    v_clean_device_hash := NULLIF(trim(p_device_hash), '');

    -- Verify 45-second HMAC bucket with 90-second grace window (current or previous bucket)
    v_current_bucket := floor(extract(epoch FROM clock_timestamp()) / 45)::BIGINT;
    IF p_qr_bucket IS NOT NULL AND p_qr_sig IS NOT NULL AND length(trim(p_qr_sig)) > 0 THEN
        IF p_qr_bucket IN (v_current_bucket, v_current_bucket - 1) THEN
            v_expected_sig := encode(
                extensions.hmac(
                    convert_to(v_session.id::text || ':' || p_qr_bucket::text, 'UTF8'),
                    v_session.qr_secret,
                    'sha256'
                ),
                'hex'
            );
            IF trim(p_qr_sig) = v_expected_sig THEN
                v_qr_valid := true;
            END IF;
        END IF;
    END IF;

    -- Check if client passed existing attempt token for reuse
    IF p_existing_attempt_token IS NOT NULL AND length(trim(p_existing_attempt_token)) > 0 THEN
        v_existing_token_hash := encode(digest(p_existing_attempt_token, 'sha256'), 'hex');

        SELECT * INTO v_existing_attempt
        FROM public.attendance_attempts
        WHERE session_id = v_session.id
          AND attempt_token_hash = v_existing_token_hash
          AND expires_at > clock_timestamp()
          AND completed_at IS NULL
        FOR UPDATE;

        IF v_existing_attempt.id IS NOT NULL THEN
            IF NOT v_effective_test_mode
               AND NOT v_qr_valid
               AND NOT COALESCE(v_existing_attempt.qr_verified, false)
            THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error', 'LIVE_QR_REQUIRED',
                    'message', 'A valid live QR code scan is required.'
                );
            END IF;

            IF (v_qr_valid AND NOT COALESCE(v_existing_attempt.qr_verified, false))
               OR (v_clean_device_hash IS NOT NULL AND v_existing_attempt.device_hash IS NULL)
            THEN
                UPDATE public.attendance_attempts
                SET qr_verified = COALESCE(qr_verified, false) OR v_qr_valid,
                    device_hash = COALESCE(device_hash, v_clean_device_hash)
                WHERE id = v_existing_attempt.id;
            END IF;

            RETURN jsonb_build_object(
                'success', true,
                'attempt_id', v_existing_attempt.id,
                'attempt_token', p_existing_attempt_token,
                'session_id', v_session.id,
                'course_id', v_session.course_id,
                'expires_at', v_session.expires_at,
                'session_started_at', v_session.created_at,
                'step', v_existing_attempt.step,
                'student_id', v_existing_attempt.student_id,
                'location_enabled', v_location_enabled,
                'qr_verified', COALESCE(v_existing_attempt.qr_verified, false) OR v_qr_valid,
                'test_mode', v_effective_test_mode
            );
        END IF;
    END IF;

    -- New attempt requires valid live QR unless test_mode is active
    IF NOT v_effective_test_mode AND NOT v_qr_valid THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'LIVE_QR_REQUIRED',
            'message', 'A valid live QR code scan is required.'
        );
    END IF;

    v_new_attempt_token := encode(extensions.gen_random_bytes(32), 'hex');
    v_new_token_hash := encode(digest(v_new_attempt_token, 'sha256'), 'hex');
    v_attempt_expires_at := clock_timestamp() + INTERVAL '15 minutes';

    INSERT INTO public.attendance_attempts (
        session_id,
        attempt_token_hash,
        step,
        expires_at,
        device_bound,
        qr_verified,
        device_hash
    ) VALUES (
        v_session.id,
        v_new_token_hash,
        'identity',
        v_attempt_expires_at,
        false,
        v_qr_valid,
        v_clean_device_hash
    ) RETURNING id INTO v_attempt_id;

    RETURN jsonb_build_object(
        'success', true,
        'attempt_id', v_attempt_id,
        'attempt_token', v_new_attempt_token,
        'session_id', v_session.id,
        'course_id', v_session.course_id,
        'expires_at', v_session.expires_at,
        'session_started_at', v_session.created_at,
        'step', 'identity',
        'student_id', NULL,
        'location_enabled', v_location_enabled,
        'qr_verified', v_qr_valid,
        'test_mode', v_effective_test_mode
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 9A. UPDATE public.rpc_verify_location (TIERED ACCURACY-TO-RADIUS)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_verify_location(
    p_attempt_id UUID,
    p_attempt_token TEXT,
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_accuracy_m DOUBLE PRECISION
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_attempt RECORD;
    v_attempt_hash TEXT;
    v_session RECORD;
    v_settings RECORD;
    v_inside BOOLEAN := false;
    v_distance DOUBLE PRECISION;
    v_base_radius DOUBLE PRECISION;
    v_effective_radius DOUBLE PRECISION;
    v_accuracy_threshold DOUBLE PRECISION;
BEGIN
    IF p_attempt_token IS NULL OR length(trim(p_attempt_token)) = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'INVALID_ATTEMPT_TOKEN',
            'message', 'Attempt token is required.'
        );
    END IF;

    v_attempt_hash := encode(digest(p_attempt_token, 'sha256'), 'hex');

    SELECT * INTO v_attempt
    FROM public.attendance_attempts
    WHERE (id = p_attempt_id OR p_attempt_id IS NULL)
      AND attempt_token_hash = v_attempt_hash
    FOR UPDATE;

    IF v_attempt.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'INVALID_ATTEMPT',
            'message', 'Invalid check-in session.'
        );
    END IF;

    IF clock_timestamp() >= v_attempt.expires_at OR v_attempt.completed_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'ATTEMPT_EXPIRED',
            'message', 'Check-in session has expired.'
        );
    END IF;

    IF v_attempt.student_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'IDENTITY_MISSING',
            'message', 'Student matriculation identity must be verified before location check.'
        );
    END IF;

    SELECT * INTO v_session
    FROM public.lecture_sessions
    WHERE id = v_attempt.session_id;

    IF v_session.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'SESSION_NOT_FOUND',
            'message', 'Lecture session not found.'
        );
    END IF;

    IF v_session.status <> 'active' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'SESSION_CLOSED',
            'message', 'Lecture session has ended or been closed.'
        );
    END IF;

    IF clock_timestamp() > v_session.expires_at THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'SESSION_EXPIRED',
            'message', 'Lecture session has expired.'
        );
    END IF;

    -- If lecturer disabled classroom location for this session, advance step to 'selfie'
    IF v_session.latitude IS NULL OR v_session.longitude IS NULL THEN
        UPDATE public.attendance_attempts
        SET step = CASE WHEN step = 'video'::public.attempt_step THEN 'video'::public.attempt_step ELSE 'selfie'::public.attempt_step END
        WHERE id = v_attempt.id;

        RETURN jsonb_build_object(
            'success', true,
            'inside_boundary', true,
            'distance_m', 0,
            'allowed_radius_m', COALESCE(v_session.radius_m, 50.0),
            'message', 'Location verification skipped (not enabled for this lecture session).'
        );
    END IF;

    -- Validate coordinates
    IF p_latitude IS NULL
       OR p_longitude IS NULL
       OR p_latitude = 'NaN'::double precision
       OR p_longitude = 'NaN'::double precision
       OR p_latitude < -90.0
       OR p_latitude > 90.0
       OR p_longitude < -180.0
       OR p_longitude > 180.0
       OR (abs(p_latitude) < 1e-6 AND abs(p_longitude) < 1e-6)
    THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'BAD_REQUEST',
            'message', 'Valid non-zero GPS latitude and longitude coordinates are required.'
        );
    END IF;

    -- Validate positive GPS accuracy_m
    IF p_accuracy_m IS NULL
       OR p_accuracy_m = 'NaN'::double precision
       OR p_accuracy_m = 'Infinity'::double precision
       OR p_accuracy_m = '-Infinity'::double precision
       OR p_accuracy_m <= 0.0
    THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'INVALID_ACCURACY',
            'message', 'A valid positive GPS accuracy measurement (accuracy_m > 0) is required.'
        );
    END IF;

    SELECT * INTO v_settings FROM public.settings WHERE id = 1;
    v_accuracy_threshold := LEAST(GREATEST(COALESCE(v_settings.location_accuracy_threshold_m, 120.0), 5.0), 120.0);

    IF p_accuracy_m > v_accuracy_threshold THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'LOW_ACCURACY',
            'message', 'GPS accuracy (±' || round(p_accuracy_m::numeric, 1) || 'm) is too coarse for classroom verification (maximum allowed: ±' || round(v_accuracy_threshold::numeric, 0) || 'm). Move closer to a window or open sky and try again.',
            'accuracy_m', round(p_accuracy_m::numeric, 1),
            'max_accuracy_m', v_accuracy_threshold
        );
    END IF;

    -- Tiered accuracy-to-radius calculation (A1)
    v_base_radius := COALESCE(v_session.radius_m, 50.0);
    IF p_accuracy_m <= 60.0 THEN
        v_effective_radius := v_base_radius;
    ELSE
        v_effective_radius := v_base_radius * 0.6;
    END IF;

    v_distance := public.fn_haversine_distance_m(p_latitude, p_longitude, v_session.latitude, v_session.longitude);

    IF v_distance IS NULL
       OR v_distance = 'NaN'::double precision
       OR v_distance = 'Infinity'::double precision
       OR v_distance = '-Infinity'::double precision
    THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'LOCATION_VERIFICATION_FAILED',
            'message', 'Unable to calculate distance to the classroom.'
        );
    END IF;

    v_inside := (v_distance <= v_effective_radius);

    IF NOT v_inside THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'OUTSIDE_CLASSROOM_BOUNDARY',
            'message', 'You are outside the lecture hall boundary (' || round(v_distance::numeric, 1) || 'm away; must be within ' || round(v_effective_radius::numeric, 1) || 'm).',
            'distance_m', round(v_distance::numeric, 1),
            'allowed_radius_m', v_effective_radius,
            'accuracy_m', round(p_accuracy_m::numeric, 1)
        );
    END IF;

    UPDATE public.attendance_attempts
    SET latitude = p_latitude,
        longitude = p_longitude,
        accuracy_m = p_accuracy_m,
        step = CASE WHEN step = 'video'::public.attempt_step THEN 'video'::public.attempt_step ELSE 'selfie'::public.attempt_step END
    WHERE id = v_attempt.id;

    RETURN jsonb_build_object(
        'success', true,
        'inside_boundary', true,
        'distance_m', round(v_distance::numeric, 1),
        'allowed_radius_m', v_effective_radius,
        'accuracy_m', round(p_accuracy_m::numeric, 1),
        'message', 'Location verified within classroom boundary.'
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 9B. UPDATE public.rpc_submit_attendance (TIERED GEOFENCE + LIVE QR + 3S CHECK)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_submit_attendance(
    p_attempt_id UUID,
    p_attempt_token TEXT,
    p_selfie_path TEXT,
    p_device_info JSONB,
    p_idempotency_key UUID DEFAULT NULL,
    p_fingerprint_hash TEXT DEFAULT NULL,
    p_binding_id UUID DEFAULT NULL,
    p_cookie_token_hash TEXT DEFAULT NULL,
    p_local_device_id UUID DEFAULT NULL,
    p_incognito_signal BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_attempt RECORD;
    v_attempt_hash TEXT;
    v_fingerprint_hash TEXT;
    v_expected_path TEXT;
    v_settings RECORD;
    v_distance DOUBLE PRECISION;
    v_base_radius DOUBLE PRECISION;
    v_effective_radius DOUBLE PRECISION;
    v_accuracy_threshold DOUBLE PRECISION;
    v_binding RECORD;
    v_new_binding_id UUID;
    v_existing_record RECORD;
    v_session RECORD;
    v_effective_test_mode BOOLEAN;
    v_grace_limit TIMESTAMPTZ;
    v_status TEXT;
    v_receipt_id TEXT;
    v_signed_at TIMESTAMPTZ;
    v_cookie_valid BOOLEAN := false;
    v_device_match BOOLEAN := false;
BEGIN
    -- 1. Validate Attempt
    IF p_attempt_token IS NOT NULL THEN
        v_attempt_hash := encode(digest(p_attempt_token, 'sha256'), 'hex');
        SELECT * INTO v_attempt
        FROM public.attendance_attempts
        WHERE attempt_token_hash = v_attempt_hash
        FOR UPDATE;
    ELSIF p_attempt_id IS NOT NULL THEN
        SELECT * INTO v_attempt
        FROM public.attendance_attempts
        WHERE id = p_attempt_id
        FOR UPDATE;
    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_ATTEMPT_TOKEN', 'message', 'Attempt token is required.');
    END IF;

    IF v_attempt.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_ATTEMPT', 'message', 'Attendance attempt session not found.');
    END IF;

    -- 2. Idempotent Return for Duplicate Submissions
    IF v_attempt.student_id IS NOT NULL THEN
        SELECT * INTO v_existing_record
        FROM public.attendance_records
        WHERE session_id = v_attempt.session_id AND student_id = v_attempt.student_id;

        IF v_existing_record.id IS NOT NULL THEN
            RETURN jsonb_build_object(
                'success', true,
                'already_signed', true,
                'receipt_id', v_existing_record.receipt_id,
                'signed_at', v_existing_record.signed_at,
                'status', v_existing_record.status
            );
        END IF;
    END IF;

    IF clock_timestamp() > v_attempt.expires_at OR v_attempt.completed_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'ATTEMPT_EXPIRED', 'message', 'Check-in window has expired. Please rescan the QR code.');
    END IF;

    IF v_attempt.student_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'IDENTITY_MISSING', 'message', 'Student matriculation identity has not been confirmed.');
    END IF;

    -- Look up lecture session and verify active/unexpired state
    SELECT * INTO v_session FROM public.lecture_sessions WHERE id = v_attempt.session_id;
    IF v_session.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'SESSION_NOT_FOUND', 'message', 'Lecture session not found.');
    END IF;

    IF v_session.status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'SESSION_CLOSED', 'message', 'Lecture session has ended or been closed.');
    END IF;

    IF clock_timestamp() > v_session.expires_at THEN
        RETURN jsonb_build_object('success', false, 'error', 'SESSION_EXPIRED', 'message', 'Lecture session has expired.');
    END IF;

    -- Enforce live QR verification unless effective test_mode is active
    v_effective_test_mode := v_session.test_mode
        AND (v_session.test_mode_expires_at IS NULL OR clock_timestamp() <= v_session.test_mode_expires_at);

    IF NOT v_effective_test_mode AND NOT COALESCE(v_attempt.qr_verified, false) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'LIVE_QR_REQUIRED',
            'message', 'Live QR code verification is required before submitting attendance.'
        );
    END IF;

    -- Keep 3-second sanity check
    IF clock_timestamp() < v_attempt.created_at + interval '3 seconds' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'TOO_FAST',
            'message', 'Submission occurred too quickly after check-in started. Please try again.'
        );
    END IF;

    -- 3 & 4. Strict Atomic Re-Verification of Progression Steps, GPS Accuracy, and Tiered Classroom Geofence
    IF v_session.latitude IS NOT NULL AND v_session.longitude IS NOT NULL THEN
        IF v_attempt.step NOT IN ('selfie', 'video') THEN
            RETURN jsonb_build_object('success', false, 'error', 'INVALID_STEP', 'message', 'All prior verification gates must be passed.');
        END IF;

        IF v_attempt.latitude IS NULL
           OR v_attempt.longitude IS NULL
           OR v_attempt.latitude = 'NaN'::double precision
           OR v_attempt.longitude = 'NaN'::double precision
           OR v_attempt.latitude < -90.0
           OR v_attempt.latitude > 90.0
           OR v_attempt.longitude < -180.0
           OR v_attempt.longitude > 180.0
           OR (abs(v_attempt.latitude) < 1e-6 AND abs(v_attempt.longitude) < 1e-6)
        THEN
            RETURN jsonb_build_object('success', false, 'error', 'LOCATION_MISSING', 'message', 'Verified classroom location coordinates are missing or invalid.');
        END IF;

        IF v_attempt.accuracy_m IS NULL
           OR v_attempt.accuracy_m = 'NaN'::double precision
           OR v_attempt.accuracy_m = 'Infinity'::double precision
           OR v_attempt.accuracy_m = '-Infinity'::double precision
           OR v_attempt.accuracy_m <= 0.0
        THEN
            RETURN jsonb_build_object('success', false, 'error', 'INVALID_ACCURACY', 'message', 'Verified GPS accuracy measurement is missing or invalid.');
        END IF;

        SELECT * INTO v_settings FROM public.settings WHERE id = 1;
        v_accuracy_threshold := LEAST(GREATEST(COALESCE(v_settings.location_accuracy_threshold_m, 120.0), 5.0), 120.0);

        IF v_attempt.accuracy_m > v_accuracy_threshold THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'LOW_ACCURACY',
                'message', 'Location re-verification failed: GPS accuracy (±' || round(v_attempt.accuracy_m::numeric, 1) || 'm) exceeds maximum allowed ±' || round(v_accuracy_threshold::numeric, 0) || 'm.',
                'accuracy_m', round(v_attempt.accuracy_m::numeric, 1),
                'max_accuracy_m', v_accuracy_threshold
            );
        END IF;

        v_base_radius := COALESCE(v_session.radius_m, 50.0);
        IF v_attempt.accuracy_m <= 60.0 THEN
            v_effective_radius := v_base_radius;
        ELSE
            v_effective_radius := v_base_radius * 0.6;
        END IF;

        v_distance := public.fn_haversine_distance_m(v_attempt.latitude, v_attempt.longitude, v_session.latitude, v_session.longitude);

        IF v_distance IS NULL
           OR v_distance = 'NaN'::double precision
           OR v_distance = 'Infinity'::double precision
           OR v_distance = '-Infinity'::double precision
           OR v_distance > v_effective_radius
        THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'OUTSIDE_CLASSROOM_BOUNDARY',
                'message', 'Location re-verification failed: outside lecture hall boundary (' ||
                    CASE
                        WHEN v_distance IS NOT NULL
                             AND v_distance <> 'NaN'::double precision
                             AND v_distance <> 'Infinity'::double precision
                             AND v_distance <> '-Infinity'::double precision
                        THEN round(v_distance::numeric, 1)::text || 'm'
                        ELSE 'unknown distance'
                    END ||
                    ' > ' || round(v_effective_radius::numeric, 1) || 'm).',
                'distance_m', CASE
                    WHEN v_distance IS NOT NULL
                         AND v_distance <> 'NaN'::double precision
                         AND v_distance <> 'Infinity'::double precision
                         AND v_distance <> '-Infinity'::double precision
                    THEN round(v_distance::numeric, 1)
                    ELSE NULL
                END,
                'allowed_radius_m', v_effective_radius,
                'accuracy_m', round(v_attempt.accuracy_m::numeric, 1)
            );
        END IF;
    ELSE
        IF v_attempt.step NOT IN ('identity', 'selfie', 'video') THEN
            RETURN jsonb_build_object('success', false, 'error', 'INVALID_STEP', 'message', 'All prior verification gates must be passed.');
        END IF;
    END IF;

    -- 5. Validate canonical selfie path
    v_expected_path := 'attendance/' || v_attempt.session_id::text || '/' || v_attempt.student_id::text || '/' || v_attempt.id::text || '.jpg';
    IF p_selfie_path IS NULL OR TRIM(p_selfie_path) <> v_expected_path THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_SELFIE_PATH', 'message', 'Invalid selfie storage path: must match canonical format.');
    END IF;

    -- 6. Resolve and Lock Fingerprint Hash
    v_fingerprint_hash := COALESCE(v_attempt.fingerprint_hash, p_fingerprint_hash, (p_device_info->>'fingerprint_hash'));
    IF v_fingerprint_hash IS NULL OR TRIM(v_fingerprint_hash) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'FINGERPRINT_REQUIRED', 'message', 'Device fingerprint is required for submission.');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(v_fingerprint_hash, 0));

    -- 7. INLINE Gate 4 Device Verification within this transaction
    SELECT * INTO v_binding
    FROM public.device_bindings
    WHERE student_id = v_attempt.student_id AND status = 'active'
    FOR UPDATE;

    IF v_binding.id IS NOT NULL THEN
        IF v_binding.fingerprint_hash <> v_fingerprint_hash THEN
            INSERT INTO public.device_events (
                student_id, fingerprint_hash, device_id, event_type, reference_code, metadata
            ) VALUES (
                v_attempt.student_id, v_fingerprint_hash, p_local_device_id, 'mismatch'::device_event_type, 'BIND-201',
                jsonb_build_object('attempt_id', v_attempt.id, 'bound_fp', v_binding.fingerprint_hash)
            );

            RETURN jsonb_build_object(
                'success', false,
                'action', 'CONTACT_ADMIN',
                'error', 'DEVICE_CHECK_FAILED',
                'reason', 'FINGERPRINT_MISMATCH',
                'reference_code', 'BIND-201'
            );
        END IF;

        IF p_cookie_token_hash IS NOT NULL AND (v_binding.trusted_cookie_hash IS NULL OR v_binding.trusted_cookie_hash = p_cookie_token_hash) THEN
            v_cookie_valid := true;
        END IF;
        IF p_local_device_id IS NOT NULL AND (v_binding.device_id IS NULL OR v_binding.device_id = p_local_device_id) THEN
            v_device_match := true;
        END IF;

        IF NOT (v_cookie_valid AND v_device_match) THEN
            IF p_incognito_signal = true THEN
                INSERT INTO public.device_events (
                    student_id, fingerprint_hash, device_id, event_type, reference_code, metadata
                ) VALUES (
                    v_attempt.student_id, v_fingerprint_hash, p_local_device_id, 'cookie_missing'::device_event_type, 'BIND-205',
                    jsonb_build_object('attempt_id', v_attempt.id, 'incognito', true)
                );

                RETURN jsonb_build_object(
                    'success', false,
                    'action', 'OPEN_NORMAL_BROWSER',
                    'error', 'DEVICE_CHECK_FAILED',
                    'reason', 'INCOGNITO_MODE',
                    'reference_code', 'BIND-205'
                );
            ELSE
                INSERT INTO public.device_events (
                    student_id, fingerprint_hash, device_id, event_type, reference_code, metadata
                ) VALUES (
                    v_attempt.student_id, v_fingerprint_hash, p_local_device_id, 'cookie_missing'::device_event_type, 'BIND-204',
                    jsonb_build_object('attempt_id', v_attempt.id, 'cookie_present', p_cookie_token_hash IS NOT NULL)
                );

                RETURN jsonb_build_object(
                    'success', false,
                    'action', 'CONTACT_ADMIN',
                    'error', 'DEVICE_CHECK_FAILED',
                    'reason', 'UNRECOGNIZED_DEVICE',
                    'reference_code', 'BIND-204'
                );
            END IF;
        END IF;

        UPDATE public.device_bindings
        SET last_seen_at = clock_timestamp(),
            updated_at = clock_timestamp(),
            device_id = COALESCE(v_binding.device_id, p_local_device_id)
        WHERE id = v_binding.id;
    ELSE
        IF EXISTS (SELECT 1 FROM public.device_bindings WHERE fingerprint_hash = v_fingerprint_hash AND status = 'active' AND student_id <> v_attempt.student_id) THEN
            INSERT INTO public.device_events (
                student_id, fingerprint_hash, device_id, event_type, reference_code, metadata
            ) VALUES (
                v_attempt.student_id, v_fingerprint_hash, p_local_device_id, 'proxy_detected'::device_event_type, 'BIND-202',
                jsonb_build_object('attempt_id', v_attempt.id)
            );

            RETURN jsonb_build_object(
                'success', false,
                'action', 'CONTACT_ADMIN',
                'error', 'DEVICE_CHECK_FAILED',
                'reason', 'DEVICE_BOUND_TO_ANOTHER_STUDENT',
                'reference_code', 'BIND-202'
            );
        ELSIF p_incognito_signal = true THEN
            INSERT INTO public.device_events (
                student_id, fingerprint_hash, device_id, event_type, reference_code, metadata
            ) VALUES (
                v_attempt.student_id, v_fingerprint_hash, p_local_device_id, 'cookie_missing'::device_event_type, 'BIND-205',
                jsonb_build_object('attempt_id', v_attempt.id, 'incognito', true)
            );

            RETURN jsonb_build_object(
                'success', false,
                'action', 'OPEN_NORMAL_BROWSER',
                'error', 'DEVICE_CHECK_FAILED',
                'reason', 'INCOGNITO_MODE',
                'reference_code', 'BIND-205'
            );
        ELSE
            INSERT INTO public.device_bindings (
                student_id,
                fingerprint_hash,
                device_id,
                trusted_cookie_hash,
                first_bound_at,
                last_seen_at,
                status,
                metadata,
                updated_at
            ) VALUES (
                v_attempt.student_id,
                v_fingerprint_hash,
                p_local_device_id,
                p_cookie_token_hash,
                clock_timestamp(),
                clock_timestamp(),
                'active',
                p_device_info,
                clock_timestamp()
            ) RETURNING id INTO v_new_binding_id;

            INSERT INTO public.device_events (
                student_id, fingerprint_hash, device_id, event_type, reference_code, metadata
            ) VALUES (
                v_attempt.student_id, v_fingerprint_hash, p_local_device_id, 'bind'::device_event_type, 'BIND-200',
                jsonb_build_object('binding_id', v_new_binding_id, 'attempt_id', v_attempt.id)
            );
        END IF;
    END IF;

    -- 8. Enforce Same-Session Single-Device Policy (Anti-Proxy Collision Gate)
    SELECT * INTO v_existing_record
    FROM public.attendance_records
    WHERE session_id = v_attempt.session_id
      AND fingerprint_hash = v_fingerprint_hash
      AND student_id <> v_attempt.student_id
    LIMIT 1;

    IF v_existing_record.id IS NOT NULL THEN
        INSERT INTO public.device_events (
            student_id, fingerprint_hash, device_id, event_type, reference_code, metadata
        ) VALUES (
            v_attempt.student_id, v_fingerprint_hash, p_local_device_id, 'proxy_detected'::device_event_type, 'BIND-203',
            jsonb_build_object('attempt_id', v_attempt.id, 'session_id', v_attempt.session_id, 'conflict_record_id', v_existing_record.id)
        );

        RETURN jsonb_build_object(
            'success', false,
            'action', 'CONTACT_ADMIN',
            'error', 'PROXY_DETECTED',
            'reason', 'SAME_SESSION_DEVICE_COLLISION',
            'reference_code', 'BIND-203'
        );
    END IF;

    -- 9. Calculate Attendance Status (Present vs Late)
    v_grace_limit := v_session.starts_at + ((COALESCE(v_session.grace_minutes, 10)) || ' minutes')::INTERVAL;
    IF clock_timestamp() <= v_grace_limit THEN
        v_status := 'present';
    ELSE
        v_status := 'late';
    END IF;

    -- 10. Generate Official Receipt ID (Africa/Lagos WAT timestamp format)
    v_signed_at := clock_timestamp();
    v_receipt_id := 'ADUN-' || to_char(v_signed_at AT TIME ZONE 'Africa/Lagos', 'YYYYMMDD') || '-' || UPPER(SUBSTRING(encode(extensions.gen_random_bytes(3), 'hex') FROM 1 FOR 6));

    -- 11. Insert Attendance Record
    INSERT INTO public.attendance_records (
        session_id,
        course_id,
        student_id,
        receipt_id,
        status,
        latitude,
        longitude,
        accuracy_m,
        selfie_path,
        fingerprint_hash,
        device_info,
        idempotency_key,
        binding_id,
        signed_at
    ) VALUES (
        v_attempt.session_id,
        v_session.course_id,
        v_attempt.student_id,
        v_receipt_id,
        v_status::attendance_status,
        v_attempt.latitude,
        v_attempt.longitude,
        v_attempt.accuracy_m,
        v_expected_path,
        v_fingerprint_hash,
        p_device_info,
        p_idempotency_key::text,
        COALESCE(v_binding.id, v_new_binding_id),
        v_signed_at
    );

    -- 12. Finalize Attempt submission step
    UPDATE public.attendance_attempts
    SET completed_at = v_signed_at,
        step = 'submitted'
    WHERE id = v_attempt.id;

    RETURN jsonb_build_object(
        'success', true,
        'receipt_id', v_receipt_id,
        'signed_at', v_signed_at,
        'status', v_status
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. CREATE public.rpc_log_heartbeat
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_log_heartbeat(
    p_attempt_id UUID,
    p_lat DOUBLE PRECISION,
    p_lon DOUBLE PRECISION,
    p_accuracy_m NUMERIC,
    p_failed_events JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_attempt RECORD;
    v_session RECORD;
    v_event JSONB;
    v_base_radius DOUBLE PRECISION;
    v_effective_radius NUMERIC := 0;
    v_distance DOUBLE PRECISION := NULL;
    v_inside BOOLEAN := false;
    v_status_note TEXT := NULL;
    v_pass_count INT;
    v_total_count INT;
BEGIN
    IF p_attempt_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ATTEMPT', 'message', 'Attempt ID is required.');
    END IF;

    SELECT * INTO v_attempt
    FROM public.attendance_attempts
    WHERE id = p_attempt_id
    FOR UPDATE;

    IF v_attempt.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ATTEMPT', 'message', 'Attendance attempt not found.');
    END IF;

    SELECT * INTO v_session
    FROM public.lecture_sessions
    WHERE id = v_attempt.session_id;

    IF v_session.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'SESSION_NOT_FOUND', 'message', 'Lecture session not found.');
    END IF;

    IF v_session.status <> 'active' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'SESSION_CLOSED', 'message', 'Lecture session has been closed.');
    END IF;

    IF clock_timestamp() > v_session.expires_at THEN
        RETURN jsonb_build_object('ok', false, 'error', 'SESSION_ENDED', 'message', 'Lecture session has ended.');
    END IF;

    -- Flush any buffered network_failure events as audit rows WITHOUT incrementing heartbeat_total_count
    IF p_failed_events IS NOT NULL
       AND jsonb_typeof(p_failed_events) = 'array'
       AND jsonb_array_length(p_failed_events) > 0
    THEN
        FOR v_event IN SELECT * FROM jsonb_array_elements(p_failed_events)
        LOOP
            INSERT INTO public.attendance_heartbeats (
                attempt_id,
                lat,
                lon,
                accuracy_m,
                distance_m,
                effective_radius_m,
                inside_fence,
                status_note,
                created_at
            ) VALUES (
                v_attempt.id,
                NULLIF(v_event->>'lat', '')::DOUBLE PRECISION,
                NULLIF(v_event->>'lon', '')::DOUBLE PRECISION,
                NULLIF(v_event->>'accuracy_m', '')::NUMERIC,
                NULL,
                NULL,
                NULL,
                'network_failure',
                COALESCE(NULLIF(v_event->>'created_at', '')::TIMESTAMPTZ, clock_timestamp())
            );
        END LOOP;
    END IF;

    -- If this call was solely flushing failed_events without a live heartbeat fix
    IF p_lat IS NULL OR p_lon IS NULL THEN
        RETURN jsonb_build_object(
            'ok', true,
            'flushed_only', true,
            'heartbeat_pass_count', v_attempt.heartbeat_pass_count,
            'heartbeat_total_count', v_attempt.heartbeat_total_count
        );
    END IF;

    -- Evaluate live heartbeat against tiered geofence
    IF v_session.latitude IS NULL OR v_session.longitude IS NULL THEN
        v_effective_radius := COALESCE(v_session.radius_m, 50.0);
        v_distance := 0;
        v_inside := true;
        v_status_note := 'geofence_disabled';
    ELSE
        v_base_radius := COALESCE(v_session.radius_m, 50.0);

        IF p_accuracy_m IS NULL OR p_accuracy_m <= 0 THEN
            v_effective_radius := 0;
            v_status_note := 'invalid_accuracy';
        ELSIF p_accuracy_m > 120.0 THEN
            v_effective_radius := 0;
            v_status_note := 'low_accuracy';
        ELSIF p_accuracy_m <= 60.0 THEN
            v_effective_radius := v_base_radius;
        ELSE
            v_effective_radius := v_base_radius * 0.6;
        END IF;

        IF p_lat = 'NaN'::double precision
           OR p_lon = 'NaN'::double precision
           OR p_lat < -90.0 OR p_lat > 90.0
           OR p_lon < -180.0 OR p_lon > 180.0
           OR (abs(p_lat) < 1e-6 AND abs(p_lon) < 1e-6)
        THEN
            v_distance := NULL;
            v_inside := false;
            v_status_note := COALESCE(v_status_note, 'invalid_coordinates');
        ELSE
            v_distance := public.fn_haversine_distance_m(p_lat, p_lon, v_session.latitude, v_session.longitude);
            IF v_effective_radius > 0
               AND v_distance IS NOT NULL
               AND v_distance <> 'NaN'::double precision
               AND v_distance <> 'Infinity'::double precision
               AND v_distance <= v_effective_radius
            THEN
                v_inside := true;
                v_status_note := 'ok';
            ELSE
                v_inside := false;
                v_status_note := COALESCE(v_status_note, 'outside_fence');
            END IF;
        END IF;
    END IF;

    INSERT INTO public.attendance_heartbeats (
        attempt_id,
        lat,
        lon,
        accuracy_m,
        distance_m,
        effective_radius_m,
        inside_fence,
        status_note
    ) VALUES (
        v_attempt.id,
        p_lat,
        p_lon,
        p_accuracy_m,
        CASE WHEN v_distance IS NOT NULL THEN round(v_distance::numeric, 1) ELSE NULL END,
        v_effective_radius,
        v_inside,
        v_status_note
    );

    UPDATE public.attendance_attempts
    SET heartbeat_total_count = heartbeat_total_count + 1,
        heartbeat_pass_count = heartbeat_pass_count + CASE WHEN v_inside THEN 1 ELSE 0 END
    WHERE id = v_attempt.id
    RETURNING heartbeat_pass_count, heartbeat_total_count
    INTO v_pass_count, v_total_count;

    RETURN jsonb_build_object(
        'ok', true,
        'inside_fence', v_inside,
        'distance_m', CASE WHEN v_distance IS NOT NULL THEN round(v_distance::numeric, 1) ELSE NULL END,
        'effective_radius_m', v_effective_radius,
        'status_note', v_status_note,
        'heartbeat_pass_count', v_pass_count,
        'heartbeat_total_count', v_total_count
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 11. CREATE public.rpc_finalize_attempt & public.rpc_finalize_session_attempts
--     (0 heartbeats => 'verified', >=60% => 'verified', >=25% => 'partial', else 'rejected')
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_finalize_attempt(
    p_attempt_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_attempt RECORD;
    v_final_status TEXT;
BEGIN
    IF p_attempt_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ATTEMPT', 'message', 'Attempt ID is required.');
    END IF;

    SELECT * INTO v_attempt
    FROM public.attendance_attempts
    WHERE id = p_attempt_id
    FOR UPDATE;

    IF v_attempt.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ATTEMPT', 'message', 'Attendance attempt not found.');
    END IF;

    IF v_attempt.finalized_at IS NOT NULL AND v_attempt.final_status IS NOT NULL THEN
        RETURN jsonb_build_object(
            'ok', true,
            'already_finalized', true,
            'attempt_id', v_attempt.id,
            'final_status', v_attempt.final_status,
            'heartbeat_pass_count', v_attempt.heartbeat_pass_count,
            'heartbeat_total_count', v_attempt.heartbeat_total_count
        );
    END IF;

    IF COALESCE(v_attempt.heartbeat_total_count, 0) = 0 THEN
        v_final_status := 'verified';
    ELSIF (v_attempt.heartbeat_pass_count::NUMERIC / v_attempt.heartbeat_total_count::NUMERIC) >= 0.60 THEN
        v_final_status := 'verified';
    ELSIF (v_attempt.heartbeat_pass_count::NUMERIC / v_attempt.heartbeat_total_count::NUMERIC) >= 0.25 THEN
        v_final_status := 'partial';
    ELSE
        v_final_status := 'rejected';
    END IF;

    UPDATE public.attendance_attempts
    SET final_status = v_final_status,
        finalized_at = clock_timestamp()
    WHERE id = v_attempt.id;

    RETURN jsonb_build_object(
        'ok', true,
        'attempt_id', v_attempt.id,
        'final_status', v_final_status,
        'heartbeat_pass_count', v_attempt.heartbeat_pass_count,
        'heartbeat_total_count', v_attempt.heartbeat_total_count
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_finalize_session_attempts(
    p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_session RECORD;
    v_caller_id UUID;
    v_caller_role TEXT;
    v_finalized_count INT := 0;
BEGIN
    IF p_session_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'SESSION_NOT_FOUND', 'message', 'Session ID is required.');
    END IF;

    SELECT ls.*, c.lecturer_id
    INTO v_session
    FROM public.lecture_sessions ls
    JOIN public.courses c ON c.id = ls.course_id
    WHERE ls.id = p_session_id;

    IF v_session.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'SESSION_NOT_FOUND', 'message', 'Lecture session not found.');
    END IF;

    IF auth.uid() IS NOT NULL THEN
        SELECT id, role::text INTO v_caller_id, v_caller_role
        FROM public.users
        WHERE auth_id = auth.uid() OR id = auth.uid()
        LIMIT 1;

        IF v_caller_id IS NULL OR (
            v_caller_role <> 'admin'
            AND v_session.created_by <> v_caller_id
            AND v_session.lecturer_id <> v_caller_id
        ) THEN
            RETURN jsonb_build_object(
                'ok', false,
                'error', 'FORBIDDEN',
                'message', 'You are not authorized to finalize attempts for this session.'
            );
        END IF;
    END IF;

    WITH updated AS (
        UPDATE public.attendance_attempts
        SET final_status = CASE
                WHEN COALESCE(heartbeat_total_count, 0) = 0 THEN 'verified'
                WHEN (heartbeat_pass_count::NUMERIC / heartbeat_total_count::NUMERIC) >= 0.60 THEN 'verified'
                WHEN (heartbeat_pass_count::NUMERIC / heartbeat_total_count::NUMERIC) >= 0.25 THEN 'partial'
                ELSE 'rejected'
            END,
            finalized_at = clock_timestamp()
        WHERE session_id = p_session_id
          AND completed_at IS NOT NULL
          AND finalized_at IS NULL
        RETURNING id
    )
    SELECT count(*) INTO v_finalized_count FROM updated;

    RETURN jsonb_build_object(
        'ok', true,
        'session_id', p_session_id,
        'finalized_count', v_finalized_count
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 12. CREATE public.v_device_hash_collisions VIEW (Gap 5)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_device_hash_collisions AS
SELECT
    session_id,
    device_hash,
    COUNT(DISTINCT student_id) AS distinct_students,
    ARRAY_AGG(DISTINCT student_id) FILTER (WHERE student_id IS NOT NULL) AS student_ids,
    COUNT(*) AS attempt_count,
    MIN(created_at) AS first_seen_at,
    MAX(created_at) AS last_seen_at
FROM public.attendance_attempts
WHERE device_hash IS NOT NULL
  AND student_id IS NOT NULL
GROUP BY session_id, device_hash
HAVING COUNT(DISTINCT student_id) > 1;

REVOKE ALL ON public.v_device_hash_collisions FROM anon, public;
GRANT SELECT ON public.v_device_hash_collisions TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 13. STRICT REVOKE / GRANT PERMISSIONS ON ALL RPCs
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.rpc_check_rate_limit(TEXT, INT, INT) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_check_rate_limit(TEXT, INT, INT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.rpc_get_live_qr(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_get_live_qr(UUID) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.rpc_validate_session_token(TEXT, TEXT, BIGINT, TEXT, TEXT) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_validate_session_token(TEXT, TEXT, BIGINT, TEXT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.rpc_verify_location(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_verify_location(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO service_role;

REVOKE EXECUTE ON FUNCTION public.rpc_submit_attendance(UUID, TEXT, TEXT, JSONB, UUID, TEXT, UUID, TEXT, UUID, BOOLEAN) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_submit_attendance(UUID, TEXT, TEXT, JSONB, UUID, TEXT, UUID, TEXT, UUID, BOOLEAN) TO service_role;

REVOKE EXECUTE ON FUNCTION public.rpc_log_heartbeat(UUID, DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, JSONB) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_log_heartbeat(UUID, DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, JSONB) TO service_role;

REVOKE EXECUTE ON FUNCTION public.rpc_finalize_attempt(UUID) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_finalize_attempt(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.rpc_finalize_session_attempts(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_finalize_session_attempts(UUID) TO authenticated, service_role;
