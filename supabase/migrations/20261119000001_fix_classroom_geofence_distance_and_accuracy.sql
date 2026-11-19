-- ============================================================================
-- Migration: 20261119000001_fix_classroom_geofence_distance_and_accuracy.sql
-- Description:
--   Fixes false-positive OUTSIDE_CLASSROOM_BOUNDARY ("too far") and LOW_ACCURACY
--   errors during student classroom location verification and attendance submission:
--
--   1. Increases default lecture_sessions.radius_m from 50.0m to 100.0m and
--      upgrades existing sessions with radius_m < 100.0m to 100.0m.
--   2. Relaxes settings.location_accuracy_threshold_m to 500.0m so indoor mobile
--      browsers (which commonly report 100m-350m GPS/Wi-Fi accuracy inside concrete
--      lecture halls) do not prematurely fail with LOW_ACCURACY before testing
--      geofence circle intersection.
--   3. Hardens fn_haversine_distance_m against floating-point domain errors by
--      clamping 'a' to [0.0, 1.0].
--   4. Updates rpc_verify_location and rpc_submit_attendance to use identical,
--      physically realistic geofence circle-intersection math:
--      - Accounts for student GPS accuracy radius:
--        v_accuracy_buffer := LEAST(GREATEST(COALESCE(p_accuracy_m, 0.0), 15.0), 200.0)
--      - Accounts for lecturer indoor GPS/Wi-Fi capture drift: 30.0m
--      - Computes effective distance outside uncertainty circles:
--        v_effective_distance := GREATEST(0.0, v_distance - v_accuracy_buffer - 30.0)
--      - Compares against effective classroom radius:
--        v_allowed_radius := GREATEST(COALESCE(v_session.radius_m, 100.0), 100.0)
--        v_inside := (v_effective_distance <= v_allowed_radius)
--      - Gracefully passes rpc_verify_location if lecturer disabled location
--        (v_session.latitude IS NULL OR v_session.longitude IS NULL).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. UPDATE LECTURE_SESSIONS RADIUS DEFAULT & EXISTING SESSIONS
-- ----------------------------------------------------------------------------
ALTER TABLE public.lecture_sessions
    ALTER COLUMN radius_m SET DEFAULT 100.0;

ALTER TABLE public.lecture_sessions
    DROP CONSTRAINT IF EXISTS check_session_radius_m;

ALTER TABLE public.lecture_sessions
    ADD CONSTRAINT check_session_radius_m
        CHECK (radius_m >= 10.0 AND radius_m <= 1000.0);

UPDATE public.lecture_sessions
SET radius_m = 100.0
WHERE radius_m IS NULL OR radius_m < 100.0;

-- ----------------------------------------------------------------------------
-- 2. RELAX SETTINGS ACCURACY THRESHOLD FOR INDOOR MOBILE GPS (500M)
-- ----------------------------------------------------------------------------
ALTER TABLE public.settings
    ALTER COLUMN location_accuracy_threshold_m SET DEFAULT 500.0;

UPDATE public.settings
SET location_accuracy_threshold_m = 500.0,
    updated_at = clock_timestamp()
WHERE id = 1
  AND (location_accuracy_threshold_m IS NULL OR location_accuracy_threshold_m < 500.0);

-- ----------------------------------------------------------------------------
-- 3. HARDEN fn_haversine_distance_m AGAINST FLOATING-POINT DOMAIN DRIFT
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_haversine_distance_m(
    lat1 DOUBLE PRECISION,
    lon1 DOUBLE PRECISION,
    lat2 DOUBLE PRECISION,
    lon2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
    r CONSTANT DOUBLE PRECISION := 6371000.0; -- Earth radius in metres
    phi1 DOUBLE PRECISION;
    phi2 DOUBLE PRECISION;
    delta_phi DOUBLE PRECISION;
    delta_lambda DOUBLE PRECISION;
    a DOUBLE PRECISION;
    c DOUBLE PRECISION;
BEGIN
    IF lat1 IS NULL OR lon1 IS NULL OR lat2 IS NULL OR lon2 IS NULL THEN
        RETURN NULL;
    END IF;

    phi1 := radians(lat1);
    phi2 := radians(lat2);
    delta_phi := radians(lat2 - lat1);
    delta_lambda := radians(lon2 - lon1);

    a := sin(delta_phi / 2.0)^2 + cos(phi1) * cos(phi2) * sin(delta_lambda / 2.0)^2;
    a := LEAST(1.0, GREATEST(0.0, a));
    c := 2.0 * atan2(sqrt(a), sqrt(1.0 - a));

    RETURN r * c;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. REWRITE rpc_verify_location WITH ACCURACY-COMPENSATED GEOFENCE INTERSECTION
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
    v_accuracy_buffer DOUBLE PRECISION;
    v_lecturer_drift_buffer CONSTANT DOUBLE PRECISION := 30.0;
    v_effective_distance DOUBLE PRECISION;
    v_allowed_radius DOUBLE PRECISION;
    v_accuracy_threshold DOUBLE PRECISION;
BEGIN
    -- 1. Verify attempt
    IF p_attempt_token IS NULL OR length(trim(p_attempt_token)) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_ATTEMPT_TOKEN', 'message', 'Attempt token is required.');
    END IF;

    v_attempt_hash := encode(digest(p_attempt_token, 'sha256'), 'hex');

    SELECT * INTO v_attempt
    FROM public.attendance_attempts
    WHERE (id = p_attempt_id OR p_attempt_id IS NULL)
      AND attempt_token_hash = v_attempt_hash
    FOR UPDATE;

    IF v_attempt.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_ATTEMPT', 'message', 'Invalid check-in session.');
    END IF;

    IF clock_timestamp() >= v_attempt.expires_at OR v_attempt.completed_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'ATTEMPT_EXPIRED', 'message', 'Check-in session has expired.');
    END IF;

    -- 2. Look up the lecture session corresponding to v_attempt.session_id
    SELECT * INTO v_session
    FROM public.lecture_sessions
    WHERE id = v_attempt.session_id;

    IF v_session.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'SESSION_NOT_FOUND', 'message', 'Lecture session not found.');
    END IF;

    -- 3. If lecturer disabled location for this session, advance step to 'selfie' immediately
    IF v_session.latitude IS NULL OR v_session.longitude IS NULL THEN
        UPDATE public.attendance_attempts
        SET latitude = p_latitude,
            longitude = p_longitude,
            accuracy_m = COALESCE(p_accuracy_m, 0.0),
            step = 'selfie'
        WHERE id = v_attempt.id;

        RETURN jsonb_build_object(
            'success', true,
            'inside_boundary', true,
            'distance_m', 0,
            'effective_distance_m', 0,
            'allowed_radius_m', GREATEST(COALESCE(v_session.radius_m, 100.0), 100.0),
            'message', 'Location verification skipped (not enabled for this lecture session).'
        );
    END IF;

    -- 4. Read institutional settings and enforce relaxed 500m coarse accuracy ceiling
    SELECT * INTO v_settings FROM public.settings WHERE id = 1;
    v_accuracy_threshold := GREATEST(COALESCE(v_settings.location_accuracy_threshold_m, 500.0), 500.0);

    IF COALESCE(p_accuracy_m, 0.0) > v_accuracy_threshold THEN
        IF v_settings.location_mode = 'enforce' THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'LOW_ACCURACY',
                'message', 'GPS signal is extremely weak (±' || round(COALESCE(p_accuracy_m, 0.0)::numeric, 0) || 'm). Please enable High Accuracy Location / Wi-Fi and try again.'
            );
        END IF;
    END IF;

    -- 5. Compute Haversine distance and accuracy-compensated geofence intersection
    v_distance := public.fn_haversine_distance_m(p_latitude, p_longitude, v_session.latitude, v_session.longitude);
    v_accuracy_buffer := LEAST(GREATEST(COALESCE(p_accuracy_m, 0.0), 15.0), 200.0);
    v_effective_distance := GREATEST(0.0, v_distance - v_accuracy_buffer - v_lecturer_drift_buffer);
    v_allowed_radius := GREATEST(COALESCE(v_session.radius_m, 100.0), 100.0);
    v_inside := (v_effective_distance <= v_allowed_radius);

    IF NOT v_inside THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'OUTSIDE_CLASSROOM_BOUNDARY',
            'message', 'You are too far from the classroom (' || round(v_effective_distance::numeric, 0) || 'm away; must be within ' || round(v_allowed_radius::numeric, 0) || 'm of the lecture hall).',
            'distance_m', round(v_distance::numeric, 1),
            'effective_distance_m', round(v_effective_distance::numeric, 1),
            'allowed_radius_m', v_allowed_radius,
            'accuracy_buffer_m', round(v_accuracy_buffer::numeric, 1)
        );
    END IF;

    -- 6. Advance attempt step to 'selfie' and persist exact student coordinates
    UPDATE public.attendance_attempts
    SET latitude = p_latitude,
        longitude = p_longitude,
        accuracy_m = COALESCE(p_accuracy_m, 0.0),
        step = 'selfie'
    WHERE id = v_attempt.id;

    RETURN jsonb_build_object(
        'success', true,
        'inside_boundary', true,
        'distance_m', round(v_distance::numeric, 1),
        'effective_distance_m', round(v_effective_distance::numeric, 1),
        'allowed_radius_m', v_allowed_radius,
        'accuracy_buffer_m', round(v_accuracy_buffer::numeric, 1),
        'message', 'Location verified within classroom boundary.'
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. REWRITE rpc_submit_attendance WITH MATCHING ACCURACY-COMPENSATED GEOFENCE
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
    v_distance DOUBLE PRECISION;
    v_accuracy_buffer DOUBLE PRECISION;
    v_lecturer_drift_buffer CONSTANT DOUBLE PRECISION := 30.0;
    v_effective_distance DOUBLE PRECISION;
    v_allowed_radius DOUBLE PRECISION;
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

    -- Look up lecture session
    SELECT * INTO v_session FROM public.lecture_sessions WHERE id = v_attempt.session_id;
    IF v_session.id IS NULL OR clock_timestamp() > v_session.expires_at THEN
        RETURN jsonb_build_object('success', false, 'error', 'SESSION_EXPIRED', 'message', 'Lecture session has expired.');
    END IF;

    -- 3 & 4. Validate Progression Steps and Accuracy-Compensated Classroom Coordinates
    IF v_session.latitude IS NOT NULL AND v_session.longitude IS NOT NULL THEN
        -- Location Geofence is active for this session
        IF v_attempt.step NOT IN ('selfie', 'video') THEN
            RETURN jsonb_build_object('success', false, 'error', 'INVALID_STEP', 'message', 'All prior verification gates must be passed.');
        END IF;

        IF v_attempt.latitude IS NULL OR v_attempt.longitude IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'LOCATION_MISSING', 'message', 'Location step was skipped or missing.');
        END IF;

        v_distance := public.fn_haversine_distance_m(v_attempt.latitude, v_attempt.longitude, v_session.latitude, v_session.longitude);
        v_accuracy_buffer := LEAST(GREATEST(COALESCE(v_attempt.accuracy_m, 0.0), 15.0), 200.0);
        v_effective_distance := GREATEST(0.0, v_distance - v_accuracy_buffer - v_lecturer_drift_buffer);
        v_allowed_radius := GREATEST(COALESCE(v_session.radius_m, 100.0), 100.0);

        IF v_effective_distance > v_allowed_radius THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'OUTSIDE_CLASSROOM_BOUNDARY',
                'message', 'Location re-verification failed: outside classroom boundary (' || round(v_effective_distance::numeric, 1) || 'm effective distance > ' || round(v_allowed_radius::numeric, 0) || 'm allowed radius).',
                'distance_m', round(v_distance::numeric, 1),
                'effective_distance_m', round(v_effective_distance::numeric, 1),
                'allowed_radius_m', v_allowed_radius
            );
        END IF;
    ELSE
        -- Location Geofence is disabled by lecturer for this session
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
-- 6. STRICT PERMISSIONS LOCKDOWN
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.rpc_verify_location(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_verify_location(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO service_role;

REVOKE EXECUTE ON FUNCTION public.rpc_submit_attendance(UUID, TEXT, TEXT, JSONB, UUID, TEXT, UUID, TEXT, UUID, BOOLEAN) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_submit_attendance(UUID, TEXT, TEXT, JSONB, UUID, TEXT, UUID, TEXT, UUID, BOOLEAN) TO service_role;
