-- ============================================================================
-- Migration: 20261110000003_add_session_geofence_and_50m_radius.sql
-- Description:
--   1. Add per-lecture classroom geofence columns to public.lecture_sessions:
--      - latitude DOUBLE PRECISION NULL
--      - longitude DOUBLE PRECISION NULL
--      - radius_m DOUBLE PRECISION NOT NULL DEFAULT 50.0
--      - location_name TEXT NULL
--   2. Update rpc_verify_location:
--      - Checks per-lecture session geofence (50m radius) if session coordinates are set.
--      - Returns OUTSIDE_CLASSROOM_BOUNDARY with distance_m and allowed_radius_m if student is outside.
--      - Falls back to institutional campus boundary if session coordinates are NULL.
--   3. Update rpc_submit_attendance:
--      - Performs in-transaction verification of per-session 50m geofence.
--      - Returns OUTSIDE_CLASSROOM_BOUNDARY if student is outside classroom boundary.
--      - Falls back to institutional campus boundary if session coordinates are NULL.
--   4. Grants execute strictly to service_role, revoking from public/anon/authenticated.
--
-- Rollback / Revert Instructions:
--   ALTER TABLE public.lecture_sessions DROP COLUMN IF EXISTS latitude;
--   ALTER TABLE public.lecture_sessions DROP COLUMN IF EXISTS longitude;
--   ALTER TABLE public.lecture_sessions DROP COLUMN IF EXISTS radius_m;
--   ALTER TABLE public.lecture_sessions DROP COLUMN IF EXISTS location_name;
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ADD CLASSROOM GEOFENCE COLUMNS TO LECTURE_SESSIONS
-- ----------------------------------------------------------------------------
ALTER TABLE public.lecture_sessions
    ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION NULL,
    ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION NULL,
    ADD COLUMN IF NOT EXISTS radius_m DOUBLE PRECISION NOT NULL DEFAULT 50.0,
    ADD COLUMN IF NOT EXISTS location_name TEXT NULL;

-- ----------------------------------------------------------------------------
-- 2. REWRITE rpc_verify_location WITH PER-LECTURE 50M GEOFENCE SUPPORT
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
BEGIN
    -- Verify attempt
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

    -- Look up the session corresponding to v_attempt.session_id
    SELECT * INTO v_session
    FROM public.lecture_sessions
    WHERE id = v_attempt.session_id;

    IF v_session.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'SESSION_NOT_FOUND', 'message', 'Lecture session not found.');
    END IF;

    -- Read institutional settings
    SELECT * INTO v_settings FROM public.settings WHERE id = 1;

    -- Accuracy verification
    IF p_accuracy_m > COALESCE(v_settings.location_accuracy_threshold_m, 150.0) THEN
        IF v_settings.location_mode = 'enforce' THEN
            RETURN jsonb_build_object('success', false, 'error', 'LOW_ACCURACY', 'message', 'GPS accuracy is too low for verification.');
        END IF;
    END IF;

    -- Geofence boundary determination:
    -- Priority 1: Per-lecture classroom geofence if lecturer coordinates exist
    IF v_session.latitude IS NOT NULL AND v_session.longitude IS NOT NULL THEN
        v_distance := public.fn_haversine_distance_m(p_latitude, p_longitude, v_session.latitude, v_session.longitude);
        v_inside := (v_distance <= COALESCE(v_session.radius_m, 50.0));
        IF NOT v_inside THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'OUTSIDE_CLASSROOM_BOUNDARY',
                'message', 'You are outside the classroom. You must be within ' || COALESCE(v_session.radius_m, 50.0)::int || ' meters of the lecturer.',
                'distance_m', round(v_distance::numeric, 1),
                'allowed_radius_m', COALESCE(v_session.radius_m, 50.0)
            );
        END IF;
    ELSE
        -- Priority 2: Fallback to institutional campus boundary check in public.settings
        IF v_settings.campus_boundary_geojson IS NOT NULL THEN
            v_inside := public.fn_is_point_in_geojson_polygon(p_latitude, p_longitude, v_settings.campus_boundary_geojson);
        ELSIF v_settings.campus_center_lat IS NOT NULL AND v_settings.campus_center_lng IS NOT NULL THEN
            v_distance := public.fn_haversine_distance_m(p_latitude, p_longitude, v_settings.campus_center_lat, v_settings.campus_center_lng);
            v_inside := (v_distance <= COALESCE(v_settings.campus_radius_m, 5000.0));
        ELSIF v_settings.location_mode = 'enforce' THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'GEOFENCE_NOT_CONFIGURED',
                'message', 'Campus boundary has not been configured in university settings.'
            );
        ELSE
            v_inside := true; -- Evidence only mode defaults to true when geofence unconfigured
        END IF;

        -- Enforce mode check
        IF v_settings.location_mode = 'enforce' AND NOT v_inside THEN
            RETURN jsonb_build_object('success', false, 'error', 'OUTSIDE_CAMPUS_BOUNDARY', 'message', 'Current position is outside the designated campus boundary.');
        END IF;
    END IF;

    -- Advance attempt step to selfie and record location coordinates
    UPDATE public.attendance_attempts
    SET latitude = p_latitude,
        longitude = p_longitude,
        accuracy_m = p_accuracy_m,
        step = 'selfie'
    WHERE id = v_attempt.id;

    RETURN jsonb_build_object(
        'success', true,
        'inside_boundary', v_inside
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. REWRITE rpc_submit_attendance WITH PER-LECTURE 50M GEOFENCE SUPPORT
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

    -- 2. Idempotent Return for Duplicate Submissions (Checked BEFORE expiry to support idempotent retries)
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

    -- 3. Validate Attempt Progression Steps
    IF v_attempt.step NOT IN ('selfie', 'video') THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_STEP', 'message', 'All prior verification gates must be passed.');
    END IF;

    -- 4. Re-verify Geofence Boundary at Submission
    IF v_attempt.latitude IS NULL OR v_attempt.longitude IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'LOCATION_MISSING', 'message', 'Location step was skipped or missing.');
    END IF;

    -- Look up lecture session
    SELECT * INTO v_session FROM public.lecture_sessions WHERE id = v_attempt.session_id;
    IF v_session.id IS NULL OR clock_timestamp() > v_session.expires_at THEN
        RETURN jsonb_build_object('success', false, 'error', 'SESSION_EXPIRED', 'message', 'Lecture session has expired.');
    END IF;

    -- Per-lecture session geofence verification
    IF v_session.latitude IS NOT NULL AND v_session.longitude IS NOT NULL THEN
        v_distance := public.fn_haversine_distance_m(v_attempt.latitude, v_attempt.longitude, v_session.latitude, v_session.longitude);
        IF v_distance > COALESCE(v_session.radius_m, 50.0) THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'OUTSIDE_CLASSROOM_BOUNDARY',
                'message', 'You are outside the classroom. You must be within ' || COALESCE(v_session.radius_m, 50.0)::int || ' meters of the lecturer.',
                'distance_m', round(v_distance::numeric, 1),
                'allowed_radius_m', COALESCE(v_session.radius_m, 50.0)
            );
        END IF;
    ELSE
        -- Fallback to institutional campus boundary check in public.settings
        SELECT * INTO v_settings FROM public.settings WHERE id = 1;
        IF v_settings.location_mode = 'enforce' THEN
            IF v_settings.campus_boundary_geojson IS NOT NULL THEN
                IF NOT public.fn_is_point_in_geojson_polygon(v_attempt.latitude, v_attempt.longitude, v_settings.campus_boundary_geojson) THEN
                    RETURN jsonb_build_object('success', false, 'error', 'OUTSIDE_CAMPUS_BOUNDARY', 'message', 'Location is outside authorized campus boundary.');
                END IF;
            ELSIF v_settings.campus_center_lat IS NOT NULL AND v_settings.campus_center_lng IS NOT NULL THEN
                v_distance := public.fn_haversine_distance_m(v_attempt.latitude, v_attempt.longitude, v_settings.campus_center_lat, v_settings.campus_center_lng);
                IF v_distance > COALESCE(v_settings.campus_radius_m, 5000.0) THEN
                    RETURN jsonb_build_object('success', false, 'error', 'OUTSIDE_CAMPUS_BOUNDARY', 'message', 'Location is outside authorized campus radius.');
                END IF;
            ELSE
                RETURN jsonb_build_object(
                    'success', false,
                    'error', 'GEOFENCE_NOT_CONFIGURED',
                    'message', 'Campus boundary has not been configured in university settings.'
                );
            END IF;
        END IF;
    END IF;

    -- 5. Validate canonical selfie path (Fixes SEC-14, PERF-08)
    v_expected_path := 'attendance/' || v_attempt.session_id::text || '/' || v_attempt.student_id::text || '/' || v_attempt.id::text || '.jpg';
    IF p_selfie_path IS NULL OR TRIM(p_selfie_path) <> v_expected_path THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_SELFIE_PATH', 'message', 'Invalid selfie storage path: must match canonical format.');
    END IF;

    -- 6. Resolve and Lock Fingerprint Hash (Fixes SEC-10, PERF-01)
    v_fingerprint_hash := COALESCE(v_attempt.fingerprint_hash, p_fingerprint_hash, (p_device_info->>'fingerprint_hash'));
    IF v_fingerprint_hash IS NULL OR TRIM(v_fingerprint_hash) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'FINGERPRINT_REQUIRED', 'message', 'Device fingerprint is required for submission.');
    END IF;

    -- 64-bit advisory lock on fingerprint
    PERFORM pg_advisory_xact_lock(hashtextextended(v_fingerprint_hash, 0));

    -- 7. INLINE Gate 4 Device Verification within this transaction (Fixes SEC-02, SEC-11)
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

    -- 8. Enforce Same-Session Single-Device Policy (Anti-Proxy Collision Gate, Fixes SEC-11)
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
-- 4. STRICT PERMISSIONS LOCKDOWN
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.rpc_verify_location(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_verify_location(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO service_role;

REVOKE EXECUTE ON FUNCTION public.rpc_submit_attendance(UUID, TEXT, TEXT, JSONB, UUID, TEXT, UUID, TEXT, UUID, BOOLEAN) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_submit_attendance(UUID, TEXT, TEXT, JSONB, UUID, TEXT, UUID, TEXT, UUID, BOOLEAN) TO service_role;
