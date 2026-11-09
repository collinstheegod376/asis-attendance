-- ============================================================================
-- Migration: 20261109000006_fix_search_path_and_drop_old_overloads.sql
-- Description:
--   1. Drop legacy overloaded signatures for RPC functions created in initial schema.
--   2. Update search_path to 'public, extensions' on all transactional RPCs so
--      pgcrypto (digest, gen_random_bytes) and PostGIS functions resolve properly.
-- ============================================================================

-- 1. Drop obsolete overloads from initial schema
DROP FUNCTION IF EXISTS public.rpc_device_check(uuid, text, text, uuid, boolean, text, text);
DROP FUNCTION IF EXISTS public.rpc_lookup_matric(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.rpc_reset_device_binding(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.rpc_submit_attendance(uuid, text, text, jsonb, text, text, uuid);
DROP FUNCTION IF EXISTS public.rpc_validate_session_token(text);

-- 2. Update search_path on production RPCs to include extensions
ALTER FUNCTION public.rpc_validate_session_token(text, text) SET search_path = public, extensions;
ALTER FUNCTION public.rpc_lookup_matric(uuid, text, text, text) SET search_path = public, extensions;
ALTER FUNCTION public.rpc_device_check(uuid, text, text, uuid, boolean, uuid, text, text) SET search_path = public, extensions;
ALTER FUNCTION public.rpc_verify_location(uuid, text, double precision, double precision, double precision) SET search_path = public, extensions;
ALTER FUNCTION public.rpc_submit_attendance(uuid, text, text, jsonb, uuid, text, uuid, text, uuid, boolean) SET search_path = public, extensions;
ALTER FUNCTION public.rpc_reset_device_binding(uuid, uuid, text, text) SET search_path = public, extensions;
