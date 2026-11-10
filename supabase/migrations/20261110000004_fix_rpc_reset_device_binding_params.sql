-- ============================================================================
-- Migration: 20261110000004_fix_rpc_reset_device_binding_params.sql
-- Description: Fix rpc_reset_device_binding parameter mismatch and overloading.
--              Resolves PostgREST PGRST202 error caused by missing p_actor_role
--              parameter when called by the reset-device-binding Edge Function.
-- ============================================================================

-- Drop old function signatures to prevent overloading ambiguity in PostgREST
DROP FUNCTION IF EXISTS public.rpc_reset_device_binding(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.rpc_reset_device_binding(UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.rpc_reset_device_binding(UUID, UUID, TEXT, TEXT, TEXT);

-- ----------------------------------------------------------------------------
-- 1. PRIMARY IMPLEMENTATION (5 parameters)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_reset_device_binding(
    p_student_id UUID,
    p_actor_id UUID,
    p_reason TEXT,
    p_actor_ip TEXT DEFAULT NULL,
    p_role TEXT DEFAULT NULL
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
        RETURN jsonb_build_object(
            'success', false,
            'error', 'REASON_REQUIRED',
            'message', 'A reason is mandatory for resetting a student device binding.'
        );
    END IF;

    -- Lookup actor role and active status
    SELECT * INTO v_actor FROM public.users WHERE id = p_actor_id AND status = 'active';
    IF v_actor.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'UNAUTHORIZED',
            'message', 'Actor not found or inactive.'
        );
    END IF;

    -- Role-based rate limiting & authorization
    IF v_actor.role = 'admin' THEN
        v_allowed := public.fn_rate_limit('reset_binding_admin:' || p_actor_id::text, 50, 3600);
        IF NOT v_allowed THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'RATE_LIMIT_EXCEEDED',
                'message', 'Admin reset rate limit exceeded (max 50/hour).'
            );
        END IF;
    ELSIF v_actor.role = 'lecturer' THEN
        v_allowed := public.fn_rate_limit('reset_binding_lecturer:' || p_actor_id::text, 10, 3600);
        IF NOT v_allowed THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'RATE_LIMIT_EXCEEDED',
                'message', 'Lecturer reset rate limit exceeded (max 10/hour).'
            );
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
        RETURN jsonb_build_object(
            'success', false,
            'error', 'FORBIDDEN',
            'message', 'Unauthorized role.'
        );
    END IF;

    -- Lookup active binding before revoking
    SELECT * INTO v_binding
    FROM public.device_bindings
    WHERE student_id = p_student_id AND status = 'active'
    ORDER BY first_bound_at DESC
    LIMIT 1
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

    -- Append-only forensic logging to device_events (BIND-200)
    INSERT INTO public.device_events (
        student_id,
        fingerprint_hash,
        device_id,
        event_type,
        reference_code,
        metadata,
        ip
    ) VALUES (
        p_student_id,
        COALESCE(v_binding.fingerprint_hash, 'ADMIN_RESET_NO_BINDING'),
        v_binding.device_id,
        'admin_reset'::device_event_type,
        'BIND-200',
        jsonb_build_object(
            'reason', p_reason,
            'reset_by', p_actor_id,
            'actor_id', p_actor_id,
            'actor_role', COALESCE(p_role, v_actor.role::text),
            'revoked_binding_id', v_binding.id
        ),
        p_actor_ip
    );

    -- Append-only audit log
    INSERT INTO public.audit_logs (
        actor_id,
        actor_role,
        action,
        entity,
        entity_id,
        metadata
    ) VALUES (
        p_actor_id,
        v_actor.role,
        'RESET_DEVICE_BINDING',
        'device_bindings',
        COALESCE(v_binding.id, p_student_id),
        jsonb_build_object(
            'reason', p_reason,
            'reset_by', p_actor_id,
            'revoked_count', v_reset_count,
            'student_id', p_student_id
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'reset_count', v_reset_count,
        'student_id', p_student_id
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. 4-PARAMETER OVERLOAD VARIANT (p_student_id, p_actor_id, p_actor_role, p_reason)
--    Delegates directly to the 5-parameter primary implementation.
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
BEGIN
    RETURN public.rpc_reset_device_binding(
        p_student_id := p_student_id,
        p_actor_id := p_actor_id,
        p_reason := p_reason,
        p_actor_ip := NULL,
        p_role := p_actor_role
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. PERMISSIONS LOCKDOWN
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.rpc_reset_device_binding(UUID, UUID, TEXT, TEXT, TEXT) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_reset_device_binding(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.rpc_reset_device_binding(UUID, UUID, TEXT, TEXT) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rpc_reset_device_binding(UUID, UUID, TEXT, TEXT) TO service_role;

-- Reload PostgREST schema cache immediately
NOTIFY pgrst, 'reload schema';
