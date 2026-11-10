-- ============================================================================
-- Migration: 20261110000001_fix_location_geofence_and_rpc.sql
-- Description:
--   1. Update public.settings with default campus coordinates for Admiralty
--      University of Nigeria (ADUN), Ibusa, Delta State:
--      campus_center_lat = 6.1118, campus_center_lng = 6.6011,
--      campus_radius_m = 5000, location_accuracy_threshold_m = 150.
--   2. Fix rpc_verify_location and rpc_submit_attendance:
--      Replace RAISE EXCEPTION 'GEOFENCE_NOT_CONFIGURED' with structured JSON
--      return objects so transactions do not abort and PostgREST does not
--      return generic HTTP 500 DATABASE_ERROR.
--   3. Ensure strict security permissions: revoke from public/anon/auth and grant to service_role.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. UPDATE INSTITUTIONAL SETTINGS WITH ADUN CAMPUS COORDINATES
-- ----------------------------------------------------------------------------
UPDATE public.settings
SET campus_center_lat = 6.1118,
    campus_center_lng = 6.6011,
    campus_radius_m = 5000.0,
    location_accuracy_threshold_m = 150.0,
    updated_at = clock_timestamp()
WHERE id = 1;

-- If no row exists (clean DB), insert row 1 with ADUN campus settings
INSERT INTO public.settings (
    id,
    location_mode,
    campus_center_lat,
    campus_center_lng,
    campus_radius_m,
    location_accuracy_threshold_m,
    default_session_duration_minutes,
    max_session_duration_minutes,
    selfie_retention_days,
    grace_minutes,
    max_active_courses_per_lecturer,
    rate_limit_token_per_minute,
    rate_limit_matric_per_minute,
    updated_at
) VALUES (
    1,
    'enforce',
    6.1118,
    6.6011,
    5000.0,
    150.0,
    15,
    30,
    30,
    3,
    8,
    60,
    30,
    clock_timestamp()
) ON CONFLICT (id) DO UPDATE
SET campus_center_lat = EXCLUDED.campus_center_lat,
    campus_center_lng = EXCLUDED.campus_center_lng,
    campus_radius_m = EXCLUDED.campus_radius_m,
    location_accuracy_threshold_m = EXCLUDED.location_accuracy_threshold_m,
    updated_at = clock_timestamp();


-- ----------------------------------------------------------------------------
-- 2. REWRITE rpc_verify_location WITH STRUCTURED JSON ERROR RETURN
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

    -- Read institutional settings
    SELECT * INTO v_settings FROM public.settings WHERE id = 1;

    -- Accuracy verification
    IF p_accuracy_m > COALESCE(v_settings.location_accuracy_threshold_m, 150.0) THEN
        IF v_settings.location_mode = 'enforce' THEN
            RETURN jsonb_build_object('success', false, 'error', 'LOW_ACCURACY', 'message', 'GPS accuracy is too low for verification.');
        END IF;
    END IF;

    -- Geofence boundary determination
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
-- 3. REWRITE rpc_submit_attendance WITH STRUCTURED JSON ERROR RETURN
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_submit_attendance(
    p_attempt_id UUID,
    p_attempt_token TEXT,
    p_selfie_path TEXT,
    p_device_info JSONB DEFAULT '{}'::jsonb,
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
    v_attempt_hash := encode(digest(p_attempt_token, 'sha256'), 'hex');

    SELECT * INTO v_attempt
    FROM public.attendance_attempts
    WHERE id = p_attempt_id AND attempt_token_hash = v_attempt_hash
    FOR UPDATE;

    IF v_attempt.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_ATTEMPT', 'message', 'Invalid check-in session.');
    END IF;

    -- Check Duplicate Attendance First (Idempotent Retry Handling)
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

    IF clock_timestamp() >= v_attempt.expires_at OR v_attempt.completed_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'ATTEMPT_EXPIRED', 'message', 'Check-in session has expired.');
    END IF;

    IF v_attempt.student_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'IDENTITY_MISSING', 'message', 'Student identity not verified.');
    END IF;

    -- 2. Verify step (Fixes SEC-08, QA-01)
    IF v_attempt.step NOT IN ('selfie', 'video') THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_STEP', 'message', 'Attempt has not passed required verification steps.');
    END IF;

    -- 3. Verify location was captured (Fixes SEC-08)
    IF v_attempt.latitude IS NULL OR v_attempt.longitude IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'LOCATION_MISSING', 'message', 'Location step was skipped or missing.');
    END IF;

    -- 4. Re-verify geofence in-transaction if location_mode = 'enforce' (Fixes SEC-07, SEC-09)
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

    -- 5. Validate canonical selfie path (Fixes SEC-14, PERF-08)
    -- Pattern: attendance/<session_id>/<student_id>/<attempt_id>.jpg
    v_expected_path := 'attendance/' || v_attempt.session_id::text || '/' || v_attempt.student_id::text || '/' || v_attempt.id::text || '.jpg';
    IF p_selfie_path IS NULL OR TRIM(p_selfie_path) <> v_expected_path THEN
        RETURN jsonb_build_object('success', false, 'error', 'INVALID_SELFIE_PATH', 'message', 'Invalid selfie storage path: must match canonical format.');
    END IF;

    -- 6. Resolve and Lock Fingerprint Hash (Fixes SEC-10, PERF-01 line 1381 crash)
    v_fingerprint_hash := COALESCE(p_fingerprint_hash, (p_device_info->>'fingerprint_hash'), v_attempt.fingerprint_hash);
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
        IF p_local_device_id IS NOT NULL AND v_binding.device_id IS NOT NULL AND v_binding.device_id = p_local_device_id THEN
            v_device_match := true;
        END IF;

        IF NOT (v_cookie_valid AND v_device_match) THEN
            IF p_incognito_signal = true THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'action', 'OPEN_NORMAL_BROWSER',
                    'error', 'DEVICE_CHECK_FAILED',
                    'reason', 'INCOGNITO_MODE',
                    'reference_code', 'BIND-205'
                );
            ELSE
                RETURN jsonb_build_object(
                    'success', false,
                    'action', 'CONTACT_ADMIN',
                    'error', 'DEVICE_CHECK_FAILED',
                    'reason', 'UNRECOGNIZED_DEVICE',
                    'reference_code', 'BIND-204'
                );
            END IF;
        END IF;
    ELSE
        -- No active binding: verify hardware not bound to another student
        IF EXISTS (SELECT 1 FROM public.device_bindings WHERE fingerprint_hash = v_fingerprint_hash AND status = 'active' AND student_id <> v_attempt.student_id) THEN
            RETURN jsonb_build_object(
                'success', false,
                'action', 'CONTACT_ADMIN',
                'error', 'DEVICE_CHECK_FAILED',
                'reason', 'DEVICE_BOUND_TO_ANOTHER_STUDENT',
                'reference_code', 'BIND-202'
            );
        ELSIF p_incognito_signal = true THEN
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
                student_id, fingerprint_hash, device_id, trusted_cookie_hash, status, first_seen_at, last_used_at, metadata
            ) VALUES (
                v_attempt.student_id, v_fingerprint_hash, p_local_device_id, p_cookie_token_hash, 'active', clock_timestamp(), clock_timestamp(), p_device_info
            ) RETURNING id INTO v_new_binding_id;
        END IF;
    END IF;

    -- 8. Enforce Same-Session Single-Device Policy (Anti-Proxy Collision Gate, Fixes SEC-11)
    IF EXISTS (
        SELECT 1 FROM public.attendance_records
        WHERE session_id = v_attempt.session_id
          AND fingerprint_hash = v_fingerprint_hash
          AND student_id <> v_attempt.student_id
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'action', 'CONTACT_ADMIN',
            'error', 'PROXY_DETECTED',
            'reason', 'SAME_SESSION_DEVICE_COLLISION',
            'reference_code', 'BIND-203'
        );
    END IF;

    -- 9. Check Duplicate Attendance (Idempotent Retry Handling)
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

    -- 10. Verify Lecture Session Window
    SELECT * INTO v_session FROM public.lecture_sessions WHERE id = v_attempt.session_id;
    IF v_session.id IS NULL OR clock_timestamp() > v_session.expires_at THEN
        RETURN jsonb_build_object('success', false, 'error', 'SESSION_EXPIRED', 'message', 'Lecture session has expired.');
    END IF;

    -- 11. Grace Period Calculation (present vs late)
    v_grace_limit := v_session.starts_at + ((COALESCE(v_session.grace_minutes, 10)) || ' minutes')::INTERVAL;
    IF clock_timestamp() <= v_grace_limit THEN
        v_status := 'present';
    ELSE
        v_status := 'late';
    END IF;

    -- 12. Generate Receipt ID: ADUN-YYYYMMDD-XXXXXX
    v_receipt_id := 'ADUN-' || to_char(clock_timestamp() AT TIME ZONE 'Africa/Lagos', 'YYYYMMDD') || '-' || UPPER(SUBSTRING(encode(gen_random_bytes(3), 'hex') FROM 1 FOR 6));

    -- 13. Insert Attendance Record Atomically
    INSERT INTO public.attendance_records (
        session_id,
        student_id,
        course_id,
        status,
        receipt_id,
        selfie_url,
        latitude,
        longitude,
        accuracy_m,
        fingerprint_hash,
        device_binding_id,
        device_info,
        idempotency_key,
        signed_at
    ) VALUES (
        v_attempt.session_id,
        v_attempt.student_id,
        v_session.course_id,
        v_status,
        v_receipt_id,
        p_selfie_path,
        v_attempt.latitude,
        v_attempt.longitude,
        v_attempt.accuracy_m,
        v_fingerprint_hash,
        COALESCE(v_binding.id, v_new_binding_id, p_binding_id),
        p_device_info,
        p_idempotency_key,
        clock_timestamp()
    ) RETURNING signed_at INTO v_signed_at;

    -- Mark attempt completed
    UPDATE public.attendance_attempts
    SET completed_at = clock_timestamp(),
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
-- 4. REVOKE RPC EXECUTION FROM CLIENT ROLES & GRANT TO service_role ONLY
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.rpc_verify_location(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_verify_location(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO service_role;

REVOKE EXECUTE ON FUNCTION public.rpc_submit_attendance(UUID, TEXT, TEXT, JSONB, UUID, TEXT, UUID, TEXT, UUID, BOOLEAN) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_submit_attendance(UUID, TEXT, TEXT, JSONB, UUID, TEXT, UUID, TEXT, UUID, BOOLEAN) TO service_role;
