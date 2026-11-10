-- ============================================================================
-- Migration: 20261110000002_fix_device_binding_rpc_and_schema.sql
-- Description:
--   1. Schema alignments for device_bindings & device_events:
--      - Adds updated_at and metadata columns to device_bindings
--      - Adds device_id column to device_events
--      - Makes fingerprint_hash in device_events nullable for admin reset events
--   2. Rewrites rpc_device_check:
--      - Fixes column names: first_bound_at and last_seen_at instead of first_seen_at / last_used_at
--      - Corrects enum values in device_events to valid device_event_type:
--        'bind', 'match', 'mismatch', 'cookie_missing', 'cookie_mismatch', 'proxy_detected'
--      - Gracefully handles initial bind, returning student, incognito, mismatches, and shared devices
--      - Complies with C1 (Incognito Precedence) and C2 (Identity Attempt Locking)
--   3. Rewrites rpc_submit_attendance device binding gate:
--      - Fixes column names on atomic device binding creation
--      - Confirms same-session hardware collision check (BIND-203)
--   4. Rewrites rpc_reset_device_binding:
--      - Sets status = 'revoked', reset_by, reset_at, and updated_at
--      - Logs forensic admin_reset event with fingerprint and device context
--   5. Enforces strict service_role privilege lockdown.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SCHEMA ALIGNMENT
-- ----------------------------------------------------------------------------
ALTER TABLE public.device_bindings 
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    ADD COLUMN IF NOT EXISTS metadata JSONB NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.device_events
    ADD COLUMN IF NOT EXISTS device_id UUID NULL,
    ALTER COLUMN fingerprint_hash DROP NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. REWRITE rpc_device_check
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
    -- 1. Advisory transaction lock on physical fingerprint (Fixes SEC-11)
    PERFORM pg_advisory_xact_lock(hashtextextended(p_fingerprint_hash, 0));

    -- 2. Lookup active binding for p_student_id
    SELECT * INTO v_binding
    FROM public.device_bindings
    WHERE student_id = p_student_id AND status = 'active'
    FOR UPDATE;

    -- 3. Binding exists AND binding.fingerprint_hash matches:
    IF v_binding.id IS NOT NULL AND v_binding.fingerprint_hash = p_fingerprint_hash THEN
        -- Evaluate cookie validity
        IF p_cookie_token_hash IS NOT NULL AND (v_binding.trusted_cookie_hash IS NULL OR v_binding.trusted_cookie_hash = p_cookie_token_hash) THEN
            v_cookie_valid := true;
        END IF;

        -- Evaluate local device ID match
        IF p_local_device_id IS NOT NULL AND (v_binding.device_id IS NULL OR v_binding.device_id = p_local_device_id) THEN
            v_device_match := true;
        END IF;

        IF v_cookie_valid AND v_device_match THEN
            -- Update binding timestamps and backfill any missing identifiers
            UPDATE public.device_bindings
            SET last_seen_at = clock_timestamp(),
                updated_at = clock_timestamp(),
                user_agent = COALESCE(p_user_agent, user_agent),
                device_id = COALESCE(v_binding.device_id, p_local_device_id),
                trusted_cookie_hash = COALESCE(v_binding.trusted_cookie_hash, p_cookie_token_hash)
            WHERE id = v_binding.id;

            -- If attempt provided, ensure fingerprint and device_bound are set (locks attempt per C2)
            IF p_attempt_id IS NOT NULL THEN
                UPDATE public.attendance_attempts
                SET fingerprint_hash = p_fingerprint_hash,
                    device_bound = true
                WHERE id = p_attempt_id;
            END IF;

            -- Log verification success event ('match')
            INSERT INTO public.device_events (
                student_id, fingerprint_hash, device_id, event_type, reference_code, metadata, ip, user_agent
            ) VALUES (
                p_student_id, p_fingerprint_hash, p_local_device_id, 'match'::device_event_type, 'BIND-200',
                jsonb_build_object('binding_id', v_binding.id, 'user_agent', p_user_agent, 'ip', p_ip),
                p_ip, p_user_agent
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
                student_id, fingerprint_hash, device_id, event_type, reference_code, metadata, ip, user_agent
            ) VALUES (
                p_student_id, p_fingerprint_hash, p_local_device_id, 'cookie_missing'::device_event_type, 'BIND-205',
                jsonb_build_object('user_agent', p_user_agent, 'ip', p_ip, 'incognito_signal', true),
                p_ip, p_user_agent
            );

            RETURN jsonb_build_object(
                'action', 'OPEN_NORMAL_BROWSER',
                'reason', 'INCOGNITO_MODE',
                'reference_code', 'BIND-205'
            );
        ELSE
            -- Known fingerprint, cookie missing/invalid or device_id mismatch, incognito signal false
            INSERT INTO public.device_events (
                student_id, fingerprint_hash, device_id, event_type, reference_code, metadata, ip, user_agent
            ) VALUES (
                p_student_id, p_fingerprint_hash, p_local_device_id,
                CASE 
                    WHEN p_cookie_token_hash IS NOT NULL AND v_binding.trusted_cookie_hash IS NOT NULL AND p_cookie_token_hash <> v_binding.trusted_cookie_hash 
                    THEN 'cookie_mismatch'::device_event_type 
                    ELSE 'cookie_missing'::device_event_type 
                END,
                'BIND-204',
                jsonb_build_object('user_agent', p_user_agent, 'ip', p_ip, 'cookie_present', p_cookie_token_hash IS NOT NULL, 'device_id_match', v_device_match),
                p_ip, p_user_agent
            );

            RETURN jsonb_build_object(
                'action', 'CONTACT_ADMIN',
                'reason', 'UNRECOGNIZED_DEVICE',
                'reference_code', 'BIND-204'
            );
        END IF;

    -- 4. Binding exists AND fingerprint differs:
    ELSIF v_binding.id IS NOT NULL AND v_binding.fingerprint_hash <> p_fingerprint_hash THEN
        INSERT INTO public.device_events (
            student_id, fingerprint_hash, device_id, event_type, reference_code, metadata, ip, user_agent
        ) VALUES (
            p_student_id, p_fingerprint_hash, p_local_device_id, 'mismatch'::device_event_type, 'BIND-201',
            jsonb_build_object('user_agent', p_user_agent, 'ip', p_ip, 'bound_fp', v_binding.fingerprint_hash, 'attempted_fp', p_fingerprint_hash),
            p_ip, p_user_agent
        );

        RETURN jsonb_build_object(
            'action', 'CONTACT_ADMIN',
            'reason', 'FINGERPRINT_MISMATCH',
            'reference_code', 'BIND-201'
        );

    -- 5. No active binding for this student:
    ELSIF v_binding.id IS NULL THEN
        -- Check if physical device is already bound to another active student
        SELECT * INTO v_other_binding
        FROM public.device_bindings
        WHERE fingerprint_hash = p_fingerprint_hash AND status = 'active' AND student_id <> p_student_id
        LIMIT 1;

        IF v_other_binding.id IS NOT NULL THEN
            INSERT INTO public.device_events (
                student_id, fingerprint_hash, device_id, event_type, reference_code, metadata, ip, user_agent
            ) VALUES (
                p_student_id, p_fingerprint_hash, p_local_device_id, 'proxy_detected'::device_event_type, 'BIND-202',
                jsonb_build_object('other_student_id', v_other_binding.student_id, 'conflict_binding_id', v_other_binding.id, 'user_agent', p_user_agent, 'ip', p_ip),
                p_ip, p_user_agent
            );

            RETURN jsonb_build_object(
                'action', 'CONTACT_ADMIN',
                'reason', 'DEVICE_BOUND_TO_ANOTHER_STUDENT',
                'reference_code', 'BIND-202'
            );

        -- 6. Incognito signal on first-ever bind (C1 case 2)
        ELSIF p_incognito_signal = true THEN
            INSERT INTO public.device_events (
                student_id, fingerprint_hash, device_id, event_type, reference_code, metadata, ip, user_agent
            ) VALUES (
                p_student_id, p_fingerprint_hash, p_local_device_id, 'cookie_missing'::device_event_type, 'BIND-205',
                jsonb_build_object('user_agent', p_user_agent, 'ip', p_ip, 'incognito_signal', true),
                p_ip, p_user_agent
            );

            RETURN jsonb_build_object(
                'action', 'OPEN_NORMAL_BROWSER',
                'reason', 'INCOGNITO_MODE',
                'reference_code', 'BIND-205'
            );

        -- 7. Initial bind: create new active binding
        ELSE
            INSERT INTO public.device_bindings (
                student_id,
                fingerprint_hash,
                device_id,
                trusted_cookie_hash,
                user_agent,
                first_bound_at,
                last_seen_at,
                status,
                metadata,
                updated_at
            ) VALUES (
                p_student_id,
                p_fingerprint_hash,
                p_local_device_id,
                p_cookie_token_hash,
                p_user_agent,
                clock_timestamp(),
                clock_timestamp(),
                'active',
                jsonb_build_object('user_agent', p_user_agent, 'ip', p_ip),
                clock_timestamp()
            ) RETURNING id INTO v_new_binding_id;

            IF p_attempt_id IS NOT NULL THEN
                UPDATE public.attendance_attempts
                SET fingerprint_hash = p_fingerprint_hash,
                    device_bound = true
                WHERE id = p_attempt_id;
            END IF;

            INSERT INTO public.device_events (
                student_id, fingerprint_hash, device_id, event_type, reference_code, metadata, ip, user_agent
            ) VALUES (
                p_student_id, p_fingerprint_hash, p_local_device_id, 'bind'::device_event_type, 'BIND-200',
                jsonb_build_object('binding_id', v_new_binding_id, 'user_agent', p_user_agent, 'ip', p_ip),
                p_ip, p_user_agent
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
-- 3. REWRITE rpc_reset_device_binding
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_reset_device_binding(
    p_student_id UUID,
    p_actor_id UUID,
    p_reason TEXT,
    p_actor_ip TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor RECORD;
    v_binding RECORD;
    v_allowed BOOLEAN := false;
    v_reset_count INT := 0;
BEGIN
    -- Validate mandatory reason
    IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'REASON_REQUIRED', 'message', 'A reason is mandatory for resetting a student device binding.');
    END IF;

    -- Lookup actor role
    SELECT * INTO v_actor FROM public.users WHERE id = p_actor_id AND status = 'active';
    IF v_actor.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'Actor not found or inactive.');
    END IF;

    -- Role-based rate limiting & authorization
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

    -- Lookup active binding before revoking
    SELECT * INTO v_binding
    FROM public.device_bindings
    WHERE student_id = p_student_id AND status = 'active'
    FOR UPDATE;

    IF v_binding.id IS NOT NULL THEN
        -- Deactivate current active device binding
        UPDATE public.device_bindings
        SET status = 'revoked',
            reset_by = p_actor_id,
            reset_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE id = v_binding.id;

        GET DIAGNOSTICS v_reset_count = ROW_COUNT;
    END IF;

    -- Append-only forensic logging to device_events (BIND-206)
    INSERT INTO public.device_events (
        student_id, fingerprint_hash, device_id, event_type, reference_code, metadata, ip
    ) VALUES (
        p_student_id,
        COALESCE(v_binding.fingerprint_hash, 'ADMIN_RESET_NO_BINDING'),
        v_binding.device_id,
        'admin_reset'::device_event_type,
        'BIND-206',
        jsonb_build_object('reset_reason', p_reason, 'actor_id', p_actor_id, 'actor_role', v_actor.role, 'revoked_binding_id', v_binding.id),
        p_actor_ip
    );

    -- Append-only audit log
    INSERT INTO public.audit_logs (
        actor_id, actor_role, action, entity, entity_id, metadata
    ) VALUES (
        p_actor_id,
        v_actor.role,
        'RESET_DEVICE_BINDING',
        'device_bindings',
        COALESCE(v_binding.id, p_student_id),
        jsonb_build_object('reason', p_reason, 'revoked_count', v_reset_count, 'student_id', p_student_id)
    );

    RETURN jsonb_build_object(
        'success', true,
        'reset_count', v_reset_count,
        'student_id', p_student_id
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. REWRITE rpc_submit_attendance (ensure device binding gate and same-session check are aligned)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_submit_attendance(
    p_attempt_id UUID,
    p_attempt_token TEXT,
    p_selfie_path TEXT,
    p_device_info JSONB,
    p_course_id UUID DEFAULT NULL,
    p_fingerprint_hash TEXT DEFAULT NULL,
    p_local_device_id UUID DEFAULT NULL,
    p_cookie_token_hash TEXT DEFAULT NULL,
    p_session_id UUID DEFAULT NULL,
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

    -- 2. Verify identity step was completed
    IF v_attempt.student_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'IDENTITY_REQUIRED', 'message', 'Identity verification is incomplete.');
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
            RETURN jsonb_build_object(
                'success', false,
                'error', 'GEOFENCE_NOT_CONFIGURED',
                'message', 'Campus boundary has not been configured in university settings.'
            );
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
                student_id, fingerprint_hash, device_id, trusted_cookie_hash, status, first_bound_at, last_seen_at, metadata, updated_at
            ) VALUES (
                v_attempt.student_id, v_fingerprint_hash, p_local_device_id, p_cookie_token_hash, 'active', clock_timestamp(), clock_timestamp(), COALESCE(p_device_info, '{}'::jsonb), clock_timestamp()
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
        INSERT INTO public.device_events (
            student_id, fingerprint_hash, device_id, event_type, reference_code, metadata
        ) VALUES (
            v_attempt.student_id, v_fingerprint_hash, p_local_device_id, 'proxy_detected'::device_event_type, 'BIND-203',
            jsonb_build_object('attempt_id', v_attempt.id, 'session_id', v_attempt.session_id, 'collision', 'SAME_SESSION_DEVICE_REUSE')
        );

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
    v_signed_at := clock_timestamp();

    -- 13. Atomic Insert into attendance_records
    INSERT INTO public.attendance_records (
        session_id,
        course_id,
        student_id,
        fingerprint_hash,
        latitude,
        longitude,
        accuracy_m,
        selfie_path,
        receipt_id,
        status,
        signed_at,
        device_info
    ) VALUES (
        v_attempt.session_id,
        v_session.course_id,
        v_attempt.student_id,
        v_fingerprint_hash,
        v_attempt.latitude,
        v_attempt.longitude,
        v_attempt.accuracy_m,
        v_expected_path,
        v_receipt_id,
        v_status::attendance_status,
        v_signed_at,
        p_device_info
    );

    -- 14. Mark attempt completed
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
-- 5. PERMISSIONS LOCKDOWN
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.rpc_device_check(UUID, TEXT, TEXT, UUID, BOOLEAN, UUID, TEXT, TEXT) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_device_check(UUID, TEXT, TEXT, UUID, BOOLEAN, UUID, TEXT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.rpc_reset_device_binding(UUID, UUID, TEXT, TEXT) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_reset_device_binding(UUID, UUID, TEXT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.rpc_submit_attendance(UUID, TEXT, TEXT, JSONB, UUID, TEXT, UUID, TEXT, UUID, BOOLEAN) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_submit_attendance(UUID, TEXT, TEXT, JSONB, UUID, TEXT, UUID, TEXT, UUID, BOOLEAN) TO service_role;
