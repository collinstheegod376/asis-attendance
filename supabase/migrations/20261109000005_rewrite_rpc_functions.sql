-- ============================================================================
-- ADUN Attendance System - Transactional Core RPC Rewrite
-- Migration: 20261109000005_rewrite_rpc_functions.sql
-- Defects Resolved: SEC-03, SEC-04, SEC-08, SEC-09, SEC-10, SEC-11, SEC-12,
--                   SEC-13, SEC-14, SEC-15, SEC-18, SEC-21, SEC-22,
--                   QA-01, PERF-01, PERF-06, C1, C2
--
-- Description:
--   Rewrites all student-facing and device-lifecycle stored procedures with:
--   - 64-bit transaction advisory locks (hashtextextended)
--   - Strict C1 Incognito precedence inside rpc_device_check
--   - Strict C2 Matric locking semantics inside rpc_lookup_matric
--   - Inlined Gate 4 device verification inside rpc_submit_attendance
--   - Canonical selfie storage path validation
--   - Anti-proxy same-session hardware collision locks (BIND-203)
--   - Fallback Haversine + GeoJSON ray-cast geofencing
--   - Server-enforced role and course-ownership validation on device resets
--   - Idempotent attempt reuse in validate-session-token
--   - Strict privilege lockdown: executable exclusively by service_role
--
-- Rollback Instructions:
--   Restore procedures from 20261108000000_adun_attendance_schema.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. rpc_device_check
-- Fixes: SEC-03, SEC-04, SEC-11, SEC-21, C1, C2
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_device_check(
    p_student_id UUID,
    p_fingerprint_hash TEXT,
    p_cookie_token_hash TEXT DEFAULT NULL,
    p_local_device_id UUID DEFAULT NULL,
    p_incognito_signal BOOLEAN DEFAULT false,
    p_attempt_id UUID DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL,
    p_ip TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_binding RECORD;
    v_other_binding RECORD;
    v_new_binding_id UUID;
    v_cookie_valid BOOLEAN := false;
    v_device_match BOOLEAN := false;
BEGIN
    -- 1. PERFORM pg_advisory_xact_lock(hashtextextended(p_fingerprint_hash, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended(p_fingerprint_hash, 0));

    -- 2. Lookup active binding for p_student_id
    SELECT * INTO v_binding
    FROM public.device_bindings
    WHERE student_id = p_student_id AND status = 'active'
    FOR UPDATE;

    -- 3. IF binding exists AND binding.fingerprint_hash = p_fingerprint_hash:
    IF v_binding.id IS NOT NULL AND v_binding.fingerprint_hash = p_fingerprint_hash THEN
        -- Evaluate cookie validity
        IF p_cookie_token_hash IS NOT NULL AND (v_binding.trusted_cookie_hash IS NULL OR v_binding.trusted_cookie_hash = p_cookie_token_hash) THEN
            v_cookie_valid := true;
        END IF;

        -- Evaluate local device ID match
        IF p_local_device_id IS NOT NULL AND v_binding.device_id IS NOT NULL AND v_binding.device_id = p_local_device_id THEN
            v_device_match := true;
        END IF;

        IF v_cookie_valid AND v_device_match THEN
            -- Update binding timestamps
            UPDATE public.device_bindings
            SET last_used_at = clock_timestamp(),
                updated_at = clock_timestamp()
            WHERE id = v_binding.id;

            -- If attempt provided, ensure fingerprint and device_bound are set (locks attempt per C2)
            IF p_attempt_id IS NOT NULL THEN
                UPDATE public.attendance_attempts
                SET fingerprint_hash = p_fingerprint_hash,
                    device_bound = true
                WHERE id = p_attempt_id;
            END IF;

            -- Log verification success event
            INSERT INTO public.device_events (
                student_id, fingerprint_hash, device_id, event_type, reference_code, metadata
            ) VALUES (
                p_student_id, p_fingerprint_hash, p_local_device_id, 'check_passed', 'BIND-200',
                jsonb_build_object('user_agent', p_user_agent, 'ip', p_ip)
            );

            RETURN jsonb_build_object(
                'action', 'OK',
                'reason', 'OK',
                'reference_code', 'BIND-200',
                'binding_id', v_binding.id
            );
        ELSIF p_incognito_signal = true THEN
            -- Known fingerprint but cookie missing and incognito signal present (C1 case 1)
            INSERT INTO public.device_events (
                student_id, fingerprint_hash, device_id, event_type, reference_code, metadata
            ) VALUES (
                p_student_id, p_fingerprint_hash, p_local_device_id, 'incognito_blocked', 'BIND-205',
                jsonb_build_object('user_agent', p_user_agent, 'ip', p_ip, 'incognito_signal', true)
            );

            RETURN jsonb_build_object(
                'action', 'OPEN_NORMAL_BROWSER',
                'reason', 'INCOGNITO_MODE',
                'reference_code', 'BIND-205'
            );
        ELSE
            -- Known fingerprint, cookie missing/invalid, incognito signal false
            INSERT INTO public.device_events (
                student_id, fingerprint_hash, device_id, event_type, reference_code, metadata
            ) VALUES (
                p_student_id, p_fingerprint_hash, p_local_device_id, 'device_unrecognized', 'BIND-204',
                jsonb_build_object('user_agent', p_user_agent, 'ip', p_ip, 'cookie_present', p_cookie_token_hash IS NOT NULL)
            );

            RETURN jsonb_build_object(
                'action', 'CONTACT_ADMIN',
                'reason', 'UNRECOGNIZED_DEVICE',
                'reference_code', 'BIND-204'
            );
        END IF;

    -- 4. IF binding exists AND fingerprint differs:
    ELSIF v_binding.id IS NOT NULL AND v_binding.fingerprint_hash <> p_fingerprint_hash THEN
        INSERT INTO public.device_events (
            student_id, fingerprint_hash, device_id, event_type, reference_code, metadata
        ) VALUES (
            p_student_id, p_fingerprint_hash, p_local_device_id, 'mismatch_blocked', 'BIND-201',
            jsonb_build_object('user_agent', p_user_agent, 'ip', p_ip, 'bound_fp', v_binding.fingerprint_hash)
        );

        RETURN jsonb_build_object(
            'action', 'CONTACT_ADMIN',
            'reason', 'FINGERPRINT_MISMATCH',
            'reference_code', 'BIND-201'
        );

    -- 5. IF no binding AND fingerprint already bound to another active student:
    ELSIF v_binding.id IS NULL THEN
        SELECT * INTO v_other_binding
        FROM public.device_bindings
        WHERE fingerprint_hash = p_fingerprint_hash AND status = 'active' AND student_id <> p_student_id
        LIMIT 1;

        IF v_other_binding.id IS NOT NULL THEN
            INSERT INTO public.device_events (
                student_id, fingerprint_hash, device_id, event_type, reference_code, metadata
            ) VALUES (
                p_student_id, p_fingerprint_hash, p_local_device_id, 'shared_device_blocked', 'BIND-202',
                jsonb_build_object('other_student_id', v_other_binding.student_id, 'user_agent', p_user_agent, 'ip', p_ip)
            );

            RETURN jsonb_build_object(
                'action', 'CONTACT_ADMIN',
                'reason', 'DEVICE_BOUND_TO_ANOTHER_STUDENT',
                'reference_code', 'BIND-202'
            );

        -- 6. IF p_incognito_signal = true on first-ever bind (C1 case 2):
        ELSIF p_incognito_signal = true THEN
            INSERT INTO public.device_events (
                student_id, fingerprint_hash, device_id, event_type, reference_code, metadata
            ) VALUES (
                p_student_id, p_fingerprint_hash, p_local_device_id, 'incognito_new_bind_blocked', 'BIND-205',
                jsonb_build_object('user_agent', p_user_agent, 'ip', p_ip, 'incognito_signal', true)
            );

            RETURN jsonb_build_object(
                'action', 'OPEN_NORMAL_BROWSER',
                'reason', 'INCOGNITO_MODE',
                'reference_code', 'BIND-205'
            );

        -- 7. ELSE create new binding, set attempt.fingerprint_hash + device_bound = true, issue cookie:
        ELSE
            INSERT INTO public.device_bindings (
                student_id,
                fingerprint_hash,
                device_id,
                trusted_cookie_hash,
                status,
                first_seen_at,
                last_used_at,
                metadata
            ) VALUES (
                p_student_id,
                p_fingerprint_hash,
                p_local_device_id,
                p_cookie_token_hash,
                'active',
                clock_timestamp(),
                clock_timestamp(),
                jsonb_build_object('user_agent', p_user_agent, 'ip', p_ip)
            ) RETURNING id INTO v_new_binding_id;

            IF p_attempt_id IS NOT NULL THEN
                UPDATE public.attendance_attempts
                SET fingerprint_hash = p_fingerprint_hash,
                    device_bound = true
                WHERE id = p_attempt_id;
            END IF;

            INSERT INTO public.device_events (
                student_id, fingerprint_hash, device_id, event_type, reference_code, metadata
            ) VALUES (
                p_student_id, p_fingerprint_hash, p_local_device_id, 'initial_bind', 'BIND-200',
                jsonb_build_object('binding_id', v_new_binding_id, 'user_agent', p_user_agent, 'ip', p_ip)
            );

            RETURN jsonb_build_object(
                'action', 'OK',
                'reason', 'BOUND',
                'reference_code', 'BIND-200',
                'binding_id', v_new_binding_id
            );
        END IF;
    END IF;
END;
$$;


-- ----------------------------------------------------------------------------
-- 2. rpc_lookup_matric
-- Fixes: SEC-12, SEC-18, C2
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_lookup_matric(
    p_attempt_id UUID,
    p_attempt_token TEXT,
    p_raw_matric TEXT,
    p_device_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_attempt RECORD;
    v_attempt_hash TEXT;
    v_clean_matric TEXT;
    v_student RECORD;
    v_session RECORD;
    v_full_name TEXT;
BEGIN
    -- Verify attempt session token
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

    -- Normalize matric: uppercase, trim, strip all whitespace (SEC-19)
    v_clean_matric := UPPER(REGEXP_REPLACE(TRIM(p_raw_matric), '\s+', '', 'g'));

    -- Lookup student in students_master
    SELECT * INTO v_student
    FROM public.students_master
    WHERE matric_no = v_clean_matric;

    -- Verify session exists
    SELECT * INTO v_session
    FROM public.lecture_sessions
    WHERE id = v_attempt.session_id;

    IF v_session.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'SESSION_NOT_FOUND', 'message', 'Session not found.');
    END IF;

    -- Verify enrollment on course_roster (SEC-18: generic error for NOT FOUND and NOT ON ROSTER)
    IF v_student.id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.course_roster
        WHERE course_id = v_session.course_id AND student_id = v_student.id
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'NOT_ELIGIBLE',
            'message', 'Student is not eligible for this lecture session.'
        );
    END IF;

    -- Check if student already signed attendance
    IF EXISTS (
        SELECT 1 FROM public.attendance_records
        WHERE session_id = v_attempt.session_id AND student_id = v_student.id
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'ALREADY_SIGNED',
            'message', 'Attendance has already been recorded for this student.'
        );
    END IF;

    -- C2 LOCKING SEMANTICS:
    -- - If attendance_attempts.student_id IS NULL: set student_id = matched student; return OK
    -- - If attendance_attempts.student_id = matched student: return OK (idempotent)
    -- - If attendance_attempts.student_id IS NOT NULL AND <> matched student:
    --     IF attendance_attempts.device_bound = false: replace student_id (user clicked Edit before confirming); return OK
    --     ELSE: return STUDENT_LOCKED (409)
    IF v_attempt.student_id IS NULL THEN
        UPDATE public.attendance_attempts
        SET student_id = v_student.id
        WHERE id = v_attempt.id;
    ELSIF v_attempt.student_id = v_student.id THEN
        -- Idempotent repeated lookup for same student
        NULL;
    ELSE
        -- Attempt already had a student_id assigned, but user entered a different matric
        IF v_attempt.device_bound = false THEN
            -- Allowed: user clicked Edit before completing device check
            UPDATE public.attendance_attempts
            SET student_id = v_student.id
            WHERE id = v_attempt.id;
        ELSE
            -- Blocked: device check already passed for previous student_id
            RETURN jsonb_build_object(
                'success', false,
                'error', 'STUDENT_LOCKED',
                'message', 'This check-in session is locked to a verified student identity.'
            );
        END IF;
    END IF;

    -- Format full name
    v_full_name := TRIM(
        COALESCE(v_student.surname, '') || ' ' ||
        COALESCE(v_student.first_name, '') || ' ' ||
        COALESCE(v_student.middle_name, '')
    );

    RETURN jsonb_build_object(
        'success', true,
        'student_id', v_student.id,
        'full_name', v_full_name,
        'program', v_student.program,
        'level', v_student.level,
        'matric_no', v_student.matric_no
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- 3. rpc_submit_attendance
-- Fixes: SEC-08, SEC-10, SEC-11, SEC-13, SEC-14, QA-01, PERF-01, PERF-06
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
            IF v_distance > COALESCE(v_settings.campus_radius_m, 500.0) THEN
                RETURN jsonb_build_object('success', false, 'error', 'OUTSIDE_CAMPUS_BOUNDARY', 'message', 'Location is outside authorized campus radius.');
            END IF;
        ELSE
            RAISE EXCEPTION 'GEOFENCE_NOT_CONFIGURED';
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
-- 4. rpc_verify_location
-- Fixes: SEC-07, SEC-09
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
    IF p_accuracy_m > COALESCE(v_settings.location_accuracy_threshold_m, 50.0) THEN
        IF v_settings.location_mode = 'enforce' THEN
            RETURN jsonb_build_object('success', false, 'error', 'LOW_ACCURACY', 'message', 'GPS accuracy is too low for verification.');
        END IF;
    END IF;

    -- Geofence boundary determination
    IF v_settings.campus_boundary_geojson IS NOT NULL THEN
        v_inside := public.fn_is_point_in_geojson_polygon(p_latitude, p_longitude, v_settings.campus_boundary_geojson);
    ELSIF v_settings.campus_center_lat IS NOT NULL AND v_settings.campus_center_lng IS NOT NULL THEN
        v_distance := public.fn_haversine_distance_m(p_latitude, p_longitude, v_settings.campus_center_lat, v_settings.campus_center_lng);
        v_inside := (v_distance <= COALESCE(v_settings.campus_radius_m, 500.0));
    ELSIF v_settings.location_mode = 'enforce' THEN
        RAISE EXCEPTION 'GEOFENCE_NOT_CONFIGURED';
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
-- 5. rpc_reset_device_binding
-- Fixes: SEC-15
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_reset_device_binding(
    p_student_id UUID,
    p_actor_id UUID,
    p_actor_role TEXT,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor RECORD;
    v_reset_count INT := 0;
    v_allowed BOOLEAN;
BEGIN
    -- Authoritative user lookup from users table (NEVER trust unverified client role)
    SELECT * INTO v_actor
    FROM public.users
    WHERE id = p_actor_id AND status = 'active';

    IF v_actor.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Actor account not found or inactive.');
    END IF;

    -- Rate limiting per role
    IF v_actor.role = 'admin' THEN
        v_allowed := public.fn_rate_limit('reset_binding_admin:' || p_actor_id::text, 50, 3600);
        IF NOT v_allowed THEN
            RETURN jsonb_build_object('success', false, 'error', 'RATE_LIMIT_EXCEEDED', 'message', 'Admin reset rate limit exceeded (max 50/hour).');
        END IF;
    ELSIF v_actor.role = 'lecturer' THEN
        v_allowed := public.fn_rate_limit('reset_binding_lecturer:' || p_actor_id::text, 10, 3600);
        IF NOT v_allowed THEN
            RETURN jsonb_build_object('success', false, 'error', 'RATE_LIMIT_EXCEEDED', 'message', 'Lecturer reset rate limit exceeded (max 10/hour).');
        END IF;

        -- Lecturer scope check: target student must be enrolled in at least one course taught by caller
        IF NOT EXISTS (
            SELECT 1 FROM public.course_roster r
            JOIN public.courses c ON c.id = r.course_id
            WHERE c.lecturer_id = p_actor_id AND r.student_id = p_student_id AND c.status = 'active'
        ) THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'FORBIDDEN',
                'message', 'Lecturers may only reset device bindings for students enrolled on their active course rosters.'
            );
        END IF;
    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Unauthorized role.');
    END IF;

    -- Deactivate current active device binding
    UPDATE public.device_bindings
    SET status = 'revoked',
        updated_at = clock_timestamp()
    WHERE student_id = p_student_id AND status = 'active';

    GET DIAGNOSTICS v_reset_count = ROW_COUNT;

    -- Append-only forensic logging to device_events (BIND-206)
    INSERT INTO public.device_events (
        student_id, event_type, reference_code, metadata
    ) VALUES (
        p_student_id,
        'admin_reset',
        'BIND-206',
        jsonb_build_object('reset_reason', p_reason, 'actor_id', p_actor_id, 'actor_role', v_actor.role)
    );

    -- Append-only audit log
    INSERT INTO public.audit_logs (
        actor_id, actor_role, action, target_table, record_id, metadata
    ) VALUES (
        p_actor_id,
        v_actor.role,
        'reset_device_binding',
        'device_bindings',
        p_student_id,
        jsonb_build_object('reason', p_reason, 'revoked_count', v_reset_count)
    );

    RETURN jsonb_build_object(
        'success', true,
        'reset_count', v_reset_count,
        'student_id', p_student_id
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- 6. rpc_validate_session_token
-- Fixes: SEC-22
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
BEGIN
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

    -- Check if client passed existing attempt token for reuse (Fixes SEC-22)
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
                'student_id', v_existing_attempt.student_id
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
        'student_id', NULL
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- STEP 7: REVOKE RPC EXECUTION FROM ALL CLIENT ROLES
-- Only service_role can invoke these procedures (Fixes SEC-02)
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.rpc_device_check(UUID, TEXT, TEXT, UUID, BOOLEAN, UUID, TEXT, TEXT) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_device_check(UUID, TEXT, TEXT, UUID, BOOLEAN, UUID, TEXT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.rpc_lookup_matric(UUID, TEXT, TEXT, TEXT) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_lookup_matric(UUID, TEXT, TEXT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.rpc_submit_attendance(UUID, TEXT, TEXT, JSONB, UUID, TEXT, UUID, TEXT, UUID, BOOLEAN) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_submit_attendance(UUID, TEXT, TEXT, JSONB, UUID, TEXT, UUID, TEXT, UUID, BOOLEAN) TO service_role;

REVOKE EXECUTE ON FUNCTION public.rpc_verify_location(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_verify_location(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO service_role;

REVOKE EXECUTE ON FUNCTION public.rpc_reset_device_binding(UUID, UUID, TEXT, TEXT) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_reset_device_binding(UUID, UUID, TEXT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.rpc_validate_session_token(TEXT, TEXT) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_validate_session_token(TEXT, TEXT) TO service_role;
