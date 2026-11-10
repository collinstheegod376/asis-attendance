-- ============================================================================
-- Migration: 20261110000007_optional_classroom_geofence.sql
-- Description:
--   1. Updates rpc_validate_session_token to return location_enabled flag
--      (true when v_session.latitude IS NOT NULL AND v_session.longitude IS NOT NULL, false otherwise).
--   2. Updates rpc_submit_attendance to only enforce classroom boundary check
--      when the lecturer explicitly enabled location for the lecture session.
--      If the lecturer disabled location, students skip GPS check and go straight
--      from matric identity verification to selfie proof and submission.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. rpc_validate_session_token
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_validate_session_token(
    p_raw_token TEXT,
    p_existing_attempt_token TEXT DEFAULT NULL
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
    v_expires_at TIMESTAMPTZ;
    v_location_enabled BOOLEAN;
BEGIN
    IF p_raw_token IS NULL OR length(trim(p_raw_token)) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_TOKEN', 'message', 'Token is missing or empty.');
    END IF;

    v_token_hash := encode(digest(p_raw_token, 'sha256'), 'hex');

    -- Lookup lecture session
    SELECT * INTO v_session
    FROM public.lecture_sessions
    WHERE token_hash = v_token_hash;

    IF v_session.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_TOKEN', 'message', 'Lecture session not found for this token.');
    END IF;

    IF v_session.status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'SESSION_CLOSED', 'message', 'Lecture session has ended or is closed.');
    END IF;

    IF clock_timestamp() < v_session.starts_at THEN
        RETURN jsonb_build_object('success', false, 'error', 'SESSION_NOT_STARTED', 'message', 'Lecture session check-in has not started yet.');
    END IF;

    IF clock_timestamp() > v_session.expires_at THEN
        RETURN jsonb_build_object('success', false, 'error', 'SESSION_EXPIRED', 'message', 'Lecture session check-in has expired.');
    END IF;

    v_location_enabled := (v_session.latitude IS NOT NULL AND v_session.longitude IS NOT NULL);

    -- Check if client passed existing attempt token for reuse
    IF p_existing_attempt_token IS NOT NULL AND TRIM(p_existing_attempt_token) <> '' THEN
        v_existing_token_hash := encode(digest(p_existing_attempt_token, 'sha256'), 'hex');

        SELECT * INTO v_existing_attempt
        FROM public.attendance_attempts
        WHERE session_id = v_session.id
          AND attempt_token_hash = v_existing_token_hash
          AND expires_at > clock_timestamp()
          AND completed_at IS NULL;

        IF v_existing_attempt.id IS NOT NULL THEN
            -- Reuse existing uncompleted attempt without inserting a new row
            RETURN jsonb_build_object(
                'success', true,
                'attempt_id', v_existing_attempt.id,
                'attempt_token', p_existing_attempt_token,
                'session_id', v_session.id,
                'course_id', v_session.course_id,
                'expires_at', v_existing_attempt.expires_at,
                'step', v_existing_attempt.step,
                'student_id', v_existing_attempt.student_id,
                'location_enabled', v_location_enabled
            );
        END IF;
    END IF;

    -- Create new attendance attempt with 15-minute TTL
    v_new_attempt_token := encode(gen_random_bytes(32), 'hex');
    v_new_token_hash := encode(digest(v_new_attempt_token, 'sha256'), 'hex');
    v_expires_at := clock_timestamp() + INTERVAL '15 minutes';

    INSERT INTO public.attendance_attempts (
        session_id,
        attempt_token_hash,
        step,
        expires_at,
        device_bound
    ) VALUES (
        v_session.id,
        v_new_token_hash,
        'identity',
        v_expires_at,
        false
    ) RETURNING id INTO v_attempt_id;

    RETURN jsonb_build_object(
        'success', true,
        'attempt_id', v_attempt_id,
        'attempt_token', v_new_attempt_token,
        'session_id', v_session.id,
        'course_id', v_session.course_id,
        'expires_at', v_expires_at,
        'step', 'identity',
        'student_id', NULL,
        'location_enabled', v_location_enabled
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_validate_session_token(TEXT, TEXT) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_validate_session_token(TEXT, TEXT) TO service_role;


-- ----------------------------------------------------------------------------
-- 2. rpc_submit_attendance (Optional Classroom Geofence)
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

    -- 3 & 4. Validate Progression Steps and Location Coordinates
    IF v_session.latitude IS NOT NULL AND v_session.longitude IS NOT NULL THEN
        -- Location Geofence is active for this session
        IF v_attempt.step NOT IN ('selfie', 'video') THEN
            RETURN jsonb_build_object('success', false, 'error', 'INVALID_STEP', 'message', 'All prior verification gates must be passed.');
        END IF;

        IF v_attempt.latitude IS NULL OR v_attempt.longitude IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'LOCATION_MISSING', 'message', 'Location step was skipped or missing.');
        END IF;

        v_distance := public.fn_haversine_distance_m(v_attempt.latitude, v_attempt.longitude, v_session.latitude, v_session.longitude);
        IF v_distance > COALESCE(v_session.radius_m, 50.0) THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'OUTSIDE_CLASSROOM_BOUNDARY',
                'message', 'Location re-verification failed: outside classroom boundary (' || round(v_distance::numeric, 1) || 'm > ' || COALESCE(v_session.radius_m, 50.0)::int || 'm).'
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

REVOKE EXECUTE ON FUNCTION public.rpc_submit_attendance(UUID, TEXT, TEXT, JSONB, UUID, TEXT, UUID, TEXT, UUID, BOOLEAN) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_submit_attendance(UUID, TEXT, TEXT, JSONB, UUID, TEXT, UUID, TEXT, UUID, BOOLEAN) TO service_role;
