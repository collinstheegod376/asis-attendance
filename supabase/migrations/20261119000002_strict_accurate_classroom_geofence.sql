-- ============================================================================
-- Migration: 20261119000002_strict_accurate_classroom_geofence.sql
-- Description:
--   Closes all backend geospatial loopholes introduced by 20261119000001 and
--   enforces strict, exact classroom geofencing:
--
--   1. Restores lecture_sessions.radius_m DEFAULT to 50.0m (from 100.0m),
--      tightens check_session_radius_m to [10.0, 500.0], and adds a Null Island
--      constraint forbidding (0, 0) classroom coordinates.
--   2. Tightens settings.location_accuracy_threshold_m to 65.0m (from 500.0m)
--      because a coarse ±200m–500m fix cannot verify a 50m lecture hall.
--   3. Rewrites rpc_verify_location:
--      - Rejects missing, non-finite, NaN, out-of-range, or (0, 0) Null Island
--        coordinates and rejects missing or <= 0 accuracy_m (INVALID_ACCURACY).
--      - Enforces active, unexpired lecture session status.
--      - Always enforces the accuracy ceiling (capped at 65.0m) whenever the
--        session has classroom coordinates enabled, regardless of global
--        settings.location_mode.
--      - Strictly enforces the lecturer's exact v_session.radius_m (default 50.0m,
--        NEVER inflated to 100m) with ZERO accuracy-buffer or drift subtraction:
--          v_distance <= COALESCE(v_session.radius_m, 50.0)
--      - Never overwrites verified coordinates or advances step to 'selfie' on
--        failed verification.
--   4. Rewrites rpc_submit_attendance:
--      - Enforces active, unexpired lecture session status.
--      - Re-verifies coordinate validity, accuracy_m > 0, accuracy_m <= threshold
--        (capped at 65.0m), and exact Haversine distance <= v_session.radius_m
--        (default 50.0m) atomically inside the submission transaction so stale,
--        coarse, or out-of-bounds attempts can never slip through.
--   5. Locks down EXECUTE permissions strictly to service_role.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. RESTORE LECTURE_SESSIONS 50M DEFAULT & TIGHTEN INTEGRITY CONSTRAINTS
-- ----------------------------------------------------------------------------
ALTER TABLE public.lecture_sessions
    ALTER COLUMN radius_m SET DEFAULT 50.0;

-- Sanitize any out-of-range radius or Null Island coordinates before constraining
UPDATE public.lecture_sessions
SET radius_m = 50.0
WHERE radius_m IS NULL OR radius_m < 10.0;

UPDATE public.lecture_sessions
SET radius_m = 500.0
WHERE radius_m > 500.0;

UPDATE public.lecture_sessions
SET latitude = NULL,
    longitude = NULL
WHERE latitude IS NOT NULL
  AND longitude IS NOT NULL
  AND abs(latitude) < 1e-6
  AND abs(longitude) < 1e-6;

ALTER TABLE public.lecture_sessions
    DROP CONSTRAINT IF EXISTS check_session_radius_m,
    DROP CONSTRAINT IF EXISTS check_session_not_null_island;

ALTER TABLE public.lecture_sessions
    ADD CONSTRAINT check_session_radius_m
        CHECK (radius_m >= 10.0 AND radius_m <= 500.0),
    ADD CONSTRAINT check_session_not_null_island
        CHECK (
            latitude IS NULL
            OR longitude IS NULL
            OR NOT (abs(latitude) < 1e-6 AND abs(longitude) < 1e-6)
        );

-- ----------------------------------------------------------------------------
-- 2. TIGHTEN SETTINGS ACCURACY THRESHOLD TO 65.0M
-- ----------------------------------------------------------------------------
ALTER TABLE public.settings
    ALTER COLUMN location_accuracy_threshold_m SET DEFAULT 65.0;

UPDATE public.settings
SET location_accuracy_threshold_m = 65.0,
    updated_at = clock_timestamp()
WHERE id = 1
  AND (
      location_accuracy_threshold_m IS NULL
      OR location_accuracy_threshold_m > 65.0
      OR location_accuracy_threshold_m <= 0.0
  );

-- ----------------------------------------------------------------------------
-- 3. REWRITE rpc_verify_location: STRICT EXACT CLASSROOM GEOFENCE
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
    v_allowed_radius DOUBLE PRECISION;
    v_accuracy_threshold DOUBLE PRECISION;
BEGIN
    -- 1. Verify attempt token
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

    -- 2. Look up lecture session and verify active/unexpired state
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

    -- 3. If lecturer disabled classroom location for this session, advance step to 'selfie'
    IF v_session.latitude IS NULL OR v_session.longitude IS NULL THEN
        UPDATE public.attendance_attempts
        SET step = CASE WHEN step = 'video' THEN 'video' ELSE 'selfie' END
        WHERE id = v_attempt.id;

        RETURN jsonb_build_object(
            'success', true,
            'inside_boundary', true,
            'distance_m', 0,
            'allowed_radius_m', COALESCE(v_session.radius_m, 50.0),
            'message', 'Location verification skipped (not enabled for this lecture session).'
        );
    END IF;

    -- 4. Strictly validate student coordinates (reject NULL, NaN, Infinity, out-of-range, and Null Island (0, 0))
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

    -- 5. Strictly validate GPS accuracy_m (reject NULL, NaN, Infinity, or <= 0 spoof values)
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

    -- 6. Strictly enforce GPS accuracy ceiling (default & max 65.0m; honors stricter admin settings down to 5.0m)
    SELECT * INTO v_settings FROM public.settings WHERE id = 1;
    v_accuracy_threshold := LEAST(GREATEST(COALESCE(v_settings.location_accuracy_threshold_m, 65.0), 5.0), 65.0);

    IF p_accuracy_m > v_accuracy_threshold THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'LOW_ACCURACY',
            'message', 'GPS accuracy (±' || round(p_accuracy_m::numeric, 1) || 'm) is too coarse for classroom verification (maximum allowed: ±' || round(v_accuracy_threshold::numeric, 0) || 'm). Move closer to a window or open sky and try again.',
            'accuracy_m', round(p_accuracy_m::numeric, 1),
            'max_accuracy_m', v_accuracy_threshold
        );
    END IF;

    -- 7. Strict exact Haversine distance check against lecturer's configured radius (default 50.0m, NO buffers, NO 100m floor)
    v_allowed_radius := COALESCE(v_session.radius_m, 50.0);
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

    v_inside := (v_distance <= v_allowed_radius);

    IF NOT v_inside THEN
        -- Fail closed: do NOT overwrite verified coordinates and NEVER advance step to 'selfie'
        RETURN jsonb_build_object(
            'success', false,
            'error', 'OUTSIDE_CLASSROOM_BOUNDARY',
            'message', 'You are outside the lecture hall boundary (' || round(v_distance::numeric, 1) || 'm away; must be within ' || round(v_allowed_radius::numeric, 0) || 'm).',
            'distance_m', round(v_distance::numeric, 1),
            'allowed_radius_m', v_allowed_radius,
            'accuracy_m', round(p_accuracy_m::numeric, 1)
        );
    END IF;

    -- 8. Location strictly verified: persist exact student coordinates and advance step to 'selfie'
    UPDATE public.attendance_attempts
    SET latitude = p_latitude,
        longitude = p_longitude,
        accuracy_m = p_accuracy_m,
        step = CASE WHEN step = 'video' THEN 'video' ELSE 'selfie' END
    WHERE id = v_attempt.id;

    RETURN jsonb_build_object(
        'success', true,
        'inside_boundary', true,
        'distance_m', round(v_distance::numeric, 1),
        'allowed_radius_m', v_allowed_radius,
        'accuracy_m', round(p_accuracy_m::numeric, 1),
        'message', 'Location verified within classroom boundary.'
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. REWRITE rpc_submit_attendance: STRICT ATOMIC RE-VERIFICATION
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
    v_allowed_radius DOUBLE PRECISION;
    v_accuracy_threshold DOUBLE PRECISION;
    v_binding RECORD;
    v_new_binding_id UUID;
    v_existing_record RECORD;
    v_session RECORD;
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

    -- 3 & 4. Strict Atomic Re-Verification of Progression Steps, GPS Accuracy, and Exact Classroom Distance
    IF v_session.latitude IS NOT NULL AND v_session.longitude IS NOT NULL THEN
        -- Classroom geofence is active for this session
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
        v_accuracy_threshold := LEAST(GREATEST(COALESCE(v_settings.location_accuracy_threshold_m, 65.0), 5.0), 65.0);

        IF v_attempt.accuracy_m > v_accuracy_threshold THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'LOW_ACCURACY',
                'message', 'Location re-verification failed: GPS accuracy (±' || round(v_attempt.accuracy_m::numeric, 1) || 'm) exceeds maximum allowed ±' || round(v_accuracy_threshold::numeric, 0) || 'm.',
                'accuracy_m', round(v_attempt.accuracy_m::numeric, 1),
                'max_accuracy_m', v_accuracy_threshold
            );
        END IF;

        v_allowed_radius := COALESCE(v_session.radius_m, 50.0);
        v_distance := public.fn_haversine_distance_m(v_attempt.latitude, v_attempt.longitude, v_session.latitude, v_session.longitude);

        IF v_distance IS NULL
           OR v_distance = 'NaN'::double precision
           OR v_distance = 'Infinity'::double precision
           OR v_distance = '-Infinity'::double precision
           OR v_distance > v_allowed_radius
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
                    ' > ' || round(v_allowed_radius::numeric, 0) || 'm).',
                'distance_m', CASE
                    WHEN v_distance IS NOT NULL
                         AND v_distance <> 'NaN'::double precision
                         AND v_distance <> 'Infinity'::double precision
                         AND v_distance <> '-Infinity'::double precision
                    THEN round(v_distance::numeric, 1)
                    ELSE NULL
                END,
                'allowed_radius_m', v_allowed_radius,
                'accuracy_m', round(v_attempt.accuracy_m::numeric, 1)
            );
        END IF;
    ELSE
        -- Classroom geofence is disabled by lecturer for this session
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

    -- 64-bit advisory lock on fingerprint
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

        -- Update binding timestamps
        UPDATE public.device_bindings
        SET last_seen_at = clock_timestamp(),
            updated_at = clock_timestamp(),
            device_id = COALESCE(v_binding.device_id, p_local_device_id)
        WHERE id = v_binding.id;
    ELSE
        -- No active binding: verify hardware not bound to another student
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
            -- Create initial binding atomically
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
    v_receipt_id := 'ADUN-' || to_char(v_signed_at AT TIME ZONE 'Africa/Lagos', 'YYYYMMDD') || '-' || UPPER(SUBSTRING(encode(gen_random_bytes(3), 'hex') FROM 1 FOR 6));

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

    -- 12. Finalize Attempt
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
-- 5. STRICT PERMISSIONS LOCKDOWN
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.rpc_verify_location(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_verify_location(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO service_role;

REVOKE EXECUTE ON FUNCTION public.rpc_submit_attendance(UUID, TEXT, TEXT, JSONB, UUID, TEXT, UUID, TEXT, UUID, BOOLEAN) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_submit_attendance(UUID, TEXT, TEXT, JSONB, UUID, TEXT, UUID, TEXT, UUID, BOOLEAN) TO service_role;
