-- ============================================================================
-- ADUN Attendance System - Rate Limiting Infrastructure
-- Migration: 20261109000004_rate_limit_table.sql
-- Defects Resolved: SEC-15, SEC-18, SEC-22, PERF-18
--
-- Description:
--   1. Creates rate_limits tracking table for high-throughput Edge Function and RPC gating.
--   2. Creates atomic fn_rate_limit() with 64-bit transaction advisory locks.
--   3. Automatically resets windows when expired and enforces limits without race conditions.
--
-- Rollback Instructions:
--   DROP FUNCTION IF EXISTS public.fn_rate_limit(TEXT, INT, INT);
--   DROP TABLE IF EXISTS public.rate_limits;
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rate_limits (
    key TEXT PRIMARY KEY,
    count INT NOT NULL DEFAULT 1,
    window_start TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Enable RLS on rate_limits table
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Deny all client access, allow service_role only
REVOKE ALL ON public.rate_limits FROM anon, authenticated, public;
GRANT ALL ON public.rate_limits TO service_role;

-- Atomic Rate Limiting Function using 64-bit Transaction Advisory Lock
CREATE OR REPLACE FUNCTION public.fn_rate_limit(
    p_key TEXT,
    p_limit INT,
    p_window_seconds INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_window_start TIMESTAMPTZ;
    v_count INT;
BEGIN
    -- Acquire transaction-scoped 64-bit advisory lock on hashed key
    PERFORM pg_advisory_xact_lock(hashtextextended(p_key, 0));

    SELECT count, window_start INTO v_count, v_window_start
    FROM public.rate_limits
    WHERE key = p_key;

    IF NOT FOUND THEN
        INSERT INTO public.rate_limits (key, count, window_start)
        VALUES (p_key, 1, v_now);
        RETURN true;
    END IF;

    -- Check if active window has elapsed
    IF v_now >= v_window_start + (p_window_seconds || ' seconds')::INTERVAL THEN
        UPDATE public.rate_limits
        SET count = 1,
            window_start = v_now
        WHERE key = p_key;
        RETURN true;
    ELSE
        -- Within active window
        IF v_count >= p_limit THEN
            RETURN false; -- Limit exceeded
        ELSE
            UPDATE public.rate_limits
            SET count = count + 1
            WHERE key = p_key;
            RETURN true; -- Allowed
        END IF;
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_rate_limit(TEXT, INT, INT) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.fn_rate_limit(TEXT, INT, INT) TO service_role;
