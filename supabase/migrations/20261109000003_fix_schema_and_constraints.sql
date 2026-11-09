-- ============================================================================
-- ADUN Attendance System - Schema Corrections, Indexes & Audit Triggers
-- Migration: 20261109000003_fix_schema_and_constraints.sql
-- Defects Resolved: SEC-09, SEC-10, SEC-11, SEC-20, QA-01, PERF-01, PERF-06, PERF-08, PERF-13, C2
--
-- Description:
--   1. Adds missing columns to attendance_attempts (fingerprint_hash, device_bound).
--   2. Adds campus center coordinates and radius to settings table.
--   3. Seeds institutional settings with safe defaults (location_mode = 'evidence_only').
--   4. Creates partial unique index ensuring only 1 active binding per student.
--   5. Creates index on attendance_records(session_id, fingerprint_hash).
--   6. Enforces immutable append-only triggers on device_events and audit_logs.
--   7. Defines automated cleanup routine for expired records and documents pg_cron schedule.
--
-- Rollback Instructions:
--   DROP TRIGGER IF EXISTS trg_append_only_device_events ON public.device_events;
--   DROP TRIGGER IF EXISTS trg_append_only_audit_logs ON public.audit_logs;
--   DROP FUNCTION IF EXISTS public.fn_prevent_tamper_log();
--   DROP FUNCTION IF EXISTS public.fn_cleanup_expired_data();
--   DROP INDEX IF EXISTS public.one_active_binding_per_student;
--   DROP INDEX IF EXISTS public.idx_attendance_session_fingerprint;
--   ALTER TABLE public.attendance_attempts DROP COLUMN IF EXISTS fingerprint_hash;
--   ALTER TABLE public.attendance_attempts DROP COLUMN IF EXISTS device_bound;
--   ALTER TABLE public.settings DROP COLUMN IF EXISTS campus_center_lat;
--   ALTER TABLE public.settings DROP COLUMN IF EXISTS campus_center_lng;
--   ALTER TABLE public.settings DROP COLUMN IF EXISTS campus_radius_m;
-- ============================================================================

-- 1. EXTEND ATTENDANCE_ATTEMPTS TABLE (Fixes SEC-10, QA-01, PERF-01 crash, and C2)
ALTER TABLE public.attendance_attempts
    ADD COLUMN IF NOT EXISTS fingerprint_hash TEXT NULL;

ALTER TABLE public.attendance_attempts
    ADD COLUMN IF NOT EXISTS device_bound BOOLEAN NOT NULL DEFAULT false;

-- 2. EXTEND SETTINGS TABLE (Fixes SEC-09)
ALTER TABLE public.settings
    ADD COLUMN IF NOT EXISTS campus_center_lat DOUBLE PRECISION NULL;

ALTER TABLE public.settings
    ADD COLUMN IF NOT EXISTS campus_center_lng DOUBLE PRECISION NULL;

ALTER TABLE public.settings
    ADD COLUMN IF NOT EXISTS campus_radius_m DOUBLE PRECISION NULL DEFAULT 500.0;

-- 3. SEED SETTINGS WITH SAFE INSTITUTIONAL DEFAULTS
INSERT INTO public.settings (
    id,
    location_mode,
    campus_boundary_geojson,
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
    rate_limit_matric_per_minute
) VALUES (
    1,
    'evidence_only',   -- Safe default: evidence only until admin actively sets and verifies geofence
    NULL,
    NULL,
    NULL,
    500.0,
    50.0,
    60,
    180,
    180,
    10,
    9,
    60,
    30
) ON CONFLICT (id) DO UPDATE SET
    grace_minutes = COALESCE(public.settings.grace_minutes, 10),
    selfie_retention_days = COALESCE(public.settings.selfie_retention_days, 180),
    max_active_courses_per_lecturer = COALESCE(public.settings.max_active_courses_per_lecturer, 9),
    rate_limit_token_per_minute = COALESCE(public.settings.rate_limit_token_per_minute, 60),
    rate_limit_matric_per_minute = COALESCE(public.settings.rate_limit_matric_per_minute, 30);

-- 4. CONCURRENCY INDEXES (Fixes SEC-11, PERF-06)
-- Enforce at most ONE active device binding per student at the database level
CREATE UNIQUE INDEX IF NOT EXISTS one_active_binding_per_student
    ON public.device_bindings (student_id)
    WHERE status = 'active';

-- Session fingerprint index for fast collision detection in rpc_submit_attendance
-- Note: NOT unique to prevent iOS hardware fingerprint collision lockouts
CREATE INDEX IF NOT EXISTS idx_attendance_session_fingerprint
    ON public.attendance_records (session_id, fingerprint_hash)
    WHERE fingerprint_hash IS NOT NULL;

-- 5. IMMUTABLE APPEND-ONLY AUDIT & FORENSIC TRIGGERS (Fixes SEC-20)
CREATE OR REPLACE FUNCTION public.fn_prevent_tamper_log()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Table % is strictly append-only. UPDATE and DELETE operations are forbidden.', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS trg_append_only_device_events ON public.device_events;
CREATE TRIGGER trg_append_only_device_events
    BEFORE UPDATE OR DELETE ON public.device_events
    FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_tamper_log();

DROP TRIGGER IF EXISTS trg_append_only_audit_logs ON public.audit_logs;
CREATE TRIGGER trg_append_only_audit_logs
    BEFORE UPDATE OR DELETE ON public.audit_logs
    FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_tamper_log();

-- 6. DATA RETENTION & EXPIRATION CLEANUP ROUTINE (Fixes PERF-08, PERF-13)
CREATE OR REPLACE FUNCTION public.fn_cleanup_expired_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_retention_days INT := 180;
BEGIN
    SELECT selfie_retention_days INTO v_retention_days FROM public.settings WHERE id = 1;
    IF v_retention_days IS NULL THEN
        v_retention_days := 180;
    END IF;

    -- Hourly cleanup: purge attendance attempts expired > 24 hours ago
    DELETE FROM public.attendance_attempts
    WHERE expires_at < (clock_timestamp() - INTERVAL '24 hours');

    -- Daily cleanup: purge device events older than 365 days
    DELETE FROM public.device_events
    WHERE created_at < (clock_timestamp() - INTERVAL '365 days');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_cleanup_expired_data() FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.fn_cleanup_expired_data() TO service_role;

-- Documented pg_cron schedule commands:
-- In Supabase projects where pg_cron extension is enabled:
--   SELECT cron.schedule('hourly-cleanup-attempts', '0 * * * *', 'SELECT public.fn_cleanup_expired_data();');
--   SELECT cron.schedule('daily-cleanup-device-events', '0 3 * * *', 'SELECT public.fn_cleanup_expired_data();');
