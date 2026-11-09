-- ============================================================================
-- ADUN Attendance System - Security Hardening & RLS Privilege Lockdown
-- Migration: 20261109000002_fix_rls_and_permissions.sql
-- Defects Resolved: SEC-01, SEC-02, PERF-02
--
-- Description:
--   1. Re-enables Row-Level Security on all 11 core tables.
--   2. Revokes public/anon access to prevent table dumping and direct inserts.
--   3. Restricts attendance and device RPC execution strictly to service_role.
--   4. Configures least-privilege RLS policies for authenticated Admins and Lecturers.
--   5. Idempotently purges any remaining demo seed data.
--
-- Rollback Instructions:
--   To revert:
--     ALTER TABLE <table_name> DISABLE ROW LEVEL SECURITY;
--     GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
--     GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;
-- ============================================================================

-- STEP 1: ENABLE ROW LEVEL SECURITY ON ALL 11 TABLES (SEC-01)
ALTER TABLE IF EXISTS public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.students_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.course_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.lecture_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.attendance_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.device_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.device_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.settings ENABLE ROW LEVEL SECURITY;

-- STEP 2: REVOKE ALL PRIVILEGES FROM PUBLIC ROLES (SEC-01, SEC-02)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated, public;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated, public;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon, authenticated, public;

-- Grant schema usage
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Service role retains full administrative privileges
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;

-- Authenticated table grants (governed by RLS policies below)
GRANT SELECT ON public.students_master TO authenticated;
GRANT SELECT ON public.course_roster TO authenticated;
GRANT SELECT ON public.device_bindings TO authenticated;
GRANT SELECT ON public.device_events TO authenticated;
GRANT SELECT ON public.settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.courses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lecture_sessions TO authenticated;
GRANT SELECT, UPDATE ON public.users TO authenticated;
GRANT SELECT ON public.attendance_records TO authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT SELECT, UPDATE ON public.settings TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Direct anon table access: 0 rows, 0 writes (SEC-01)
-- (No table permissions granted to anon role)

-- STEP 3: SECURITY DEFINER ROLE HELPERS
CREATE OR REPLACE FUNCTION public.auth_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT role::text FROM public.users WHERE auth_id = auth.uid() OR id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.auth_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id FROM public.users WHERE auth_id = auth.uid() OR id = auth.uid() LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.auth_user_role() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.auth_user_role() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.auth_user_id() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.auth_user_id() TO authenticated, service_role;

-- STEP 4: DEFINE GRANULAR RLS POLICIES ACROSS ALL 11 TABLES

-- ----------------------------------------------------------------------------
-- 1. USERS TABLE
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "admin_all_users" ON public.users;
DROP POLICY IF EXISTS "lecturer_select_self" ON public.users;
DROP POLICY IF EXISTS "user_update_self" ON public.users;
DROP POLICY IF EXISTS "Admin full access on users" ON public.users;
DROP POLICY IF EXISTS "Lecturers can view and update own profile" ON public.users;

CREATE POLICY "admin_all_users" ON public.users
    FOR ALL
    TO authenticated
    USING (public.auth_user_role() = 'admin')
    WITH CHECK (public.auth_user_role() = 'admin');

CREATE POLICY "lecturer_select_self" ON public.users
    FOR SELECT
    TO authenticated
    USING (auth_id = auth.uid() OR id = auth.uid());

CREATE POLICY "user_update_self" ON public.users
    FOR UPDATE
    TO authenticated
    USING (auth_id = auth.uid() OR id = auth.uid())
    WITH CHECK (auth_id = auth.uid() OR id = auth.uid());

-- ----------------------------------------------------------------------------
-- 2. STUDENTS_MASTER TABLE (Read-only for clients, inserts via service_role)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "admin_select_students_master" ON public.students_master;
DROP POLICY IF EXISTS "lecturer_select_students_master" ON public.students_master;
DROP POLICY IF EXISTS "Admin full access on students_master" ON public.students_master;
DROP POLICY IF EXISTS "Lecturers can select enrolled students" ON public.students_master;

CREATE POLICY "admin_select_students_master" ON public.students_master
    FOR SELECT
    TO authenticated
    USING (public.auth_user_role() = 'admin');

CREATE POLICY "lecturer_select_students_master" ON public.students_master
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_role() = 'lecturer' AND id IN (
            SELECT r.student_id FROM public.course_roster r
            JOIN public.courses c ON c.id = r.course_id
            WHERE c.lecturer_id = public.auth_user_id()
        )
    );

-- ----------------------------------------------------------------------------
-- 3. COURSES TABLE
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "admin_all_courses" ON public.courses;
DROP POLICY IF EXISTS "lecturer_all_own_courses" ON public.courses;
DROP POLICY IF EXISTS "Admin full access on courses" ON public.courses;
DROP POLICY IF EXISTS "Lecturers manage own courses" ON public.courses;

CREATE POLICY "admin_all_courses" ON public.courses
    FOR ALL
    TO authenticated
    USING (public.auth_user_role() = 'admin')
    WITH CHECK (public.auth_user_role() = 'admin');

CREATE POLICY "lecturer_all_own_courses" ON public.courses
    FOR ALL
    TO authenticated
    USING (lecturer_id = public.auth_user_id())
    WITH CHECK (lecturer_id = public.auth_user_id());

-- ----------------------------------------------------------------------------
-- 4. COURSE_ROSTER TABLE
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "admin_all_course_roster" ON public.course_roster;
DROP POLICY IF EXISTS "lecturer_manage_roster" ON public.course_roster;
DROP POLICY IF EXISTS "Admin full access on course_roster" ON public.course_roster;
DROP POLICY IF EXISTS "Lecturers manage roster for own courses" ON public.course_roster;

CREATE POLICY "admin_all_course_roster" ON public.course_roster
    FOR ALL
    TO authenticated
    USING (public.auth_user_role() = 'admin')
    WITH CHECK (public.auth_user_role() = 'admin');

CREATE POLICY "lecturer_manage_roster" ON public.course_roster
    FOR ALL
    TO authenticated
    USING (
        course_id IN (SELECT id FROM public.courses WHERE lecturer_id = public.auth_user_id())
    )
    WITH CHECK (
        course_id IN (SELECT id FROM public.courses WHERE lecturer_id = public.auth_user_id())
    );

-- ----------------------------------------------------------------------------
-- 5. LECTURE_SESSIONS TABLE
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "admin_all_lecture_sessions" ON public.lecture_sessions;
DROP POLICY IF EXISTS "lecturer_manage_sessions" ON public.lecture_sessions;
DROP POLICY IF EXISTS "Admin full access on lecture_sessions" ON public.lecture_sessions;
DROP POLICY IF EXISTS "Lecturers manage own lecture sessions" ON public.lecture_sessions;

CREATE POLICY "admin_all_lecture_sessions" ON public.lecture_sessions
    FOR ALL
    TO authenticated
    USING (public.auth_user_role() = 'admin')
    WITH CHECK (public.auth_user_role() = 'admin');

CREATE POLICY "lecturer_manage_sessions" ON public.lecture_sessions
    FOR ALL
    TO authenticated
    USING (
        course_id IN (SELECT id FROM public.courses WHERE lecturer_id = public.auth_user_id())
    )
    WITH CHECK (
        course_id IN (SELECT id FROM public.courses WHERE lecturer_id = public.auth_user_id())
    );

-- ----------------------------------------------------------------------------
-- 6. ATTENDANCE_RECORDS TABLE (Strictly read-only for clients, append via service_role)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "admin_select_attendance_records" ON public.attendance_records;
DROP POLICY IF EXISTS "lecturer_select_attendance_records" ON public.attendance_records;
DROP POLICY IF EXISTS "Admin full view and export on records" ON public.attendance_records;
DROP POLICY IF EXISTS "Lecturers view attendance for their courses" ON public.attendance_records;

CREATE POLICY "admin_select_attendance_records" ON public.attendance_records
    FOR SELECT
    TO authenticated
    USING (public.auth_user_role() = 'admin');

CREATE POLICY "lecturer_select_attendance_records" ON public.attendance_records
    FOR SELECT
    TO authenticated
    USING (
        course_id IN (SELECT id FROM public.courses WHERE lecturer_id = public.auth_user_id())
    );

-- ----------------------------------------------------------------------------
-- 7. ATTENDANCE_ATTEMPTS TABLE (Service-role only)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin can view attempts" ON public.attendance_attempts;
DROP POLICY IF EXISTS "admin_select_attempts" ON public.attendance_attempts;

-- No client policies created; accessible exclusively via service_role.

-- ----------------------------------------------------------------------------
-- 8. DEVICE_BINDINGS TABLE
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "admin_select_device_bindings" ON public.device_bindings;
DROP POLICY IF EXISTS "lecturer_select_device_bindings" ON public.device_bindings;
DROP POLICY IF EXISTS "Admin manage device bindings" ON public.device_bindings;
DROP POLICY IF EXISTS "Lecturers view and reset device bindings for their students" ON public.device_bindings;

CREATE POLICY "admin_select_device_bindings" ON public.device_bindings
    FOR SELECT
    TO authenticated
    USING (public.auth_user_role() = 'admin');

CREATE POLICY "lecturer_select_device_bindings" ON public.device_bindings
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_role() = 'lecturer' AND student_id IN (
            SELECT r.student_id FROM public.course_roster r
            JOIN public.courses c ON c.id = r.course_id
            WHERE c.lecturer_id = public.auth_user_id()
        )
    );

-- ----------------------------------------------------------------------------
-- 9. DEVICE_EVENTS TABLE
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "admin_select_device_events" ON public.device_events;
DROP POLICY IF EXISTS "lecturer_select_device_events" ON public.device_events;
DROP POLICY IF EXISTS "Admin view device events" ON public.device_events;
DROP POLICY IF EXISTS "Lecturers view device events for their students" ON public.device_events;

CREATE POLICY "admin_select_device_events" ON public.device_events
    FOR SELECT
    TO authenticated
    USING (public.auth_user_role() = 'admin');

CREATE POLICY "lecturer_select_device_events" ON public.device_events
    FOR SELECT
    TO authenticated
    USING (
        public.auth_user_role() = 'lecturer' AND student_id IN (
            SELECT r.student_id FROM public.course_roster r
            JOIN public.courses c ON c.id = r.course_id
            WHERE c.lecturer_id = public.auth_user_id()
        )
    );

-- ----------------------------------------------------------------------------
-- 10. AUDIT_LOGS TABLE
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "admin_select_audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Admin view audit logs" ON public.audit_logs;

CREATE POLICY "admin_select_audit_logs" ON public.audit_logs
    FOR SELECT
    TO authenticated
    USING (public.auth_user_role() = 'admin');

-- ----------------------------------------------------------------------------
-- 11. SETTINGS TABLE
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "admin_all_settings" ON public.settings;
DROP POLICY IF EXISTS "authenticated_select_settings" ON public.settings;
DROP POLICY IF EXISTS "Admin manage settings" ON public.settings;
DROP POLICY IF EXISTS "Authenticated view settings" ON public.settings;

CREATE POLICY "admin_all_settings" ON public.settings
    FOR ALL
    TO authenticated
    USING (public.auth_user_role() = 'admin')
    WITH CHECK (public.auth_user_role() = 'admin');

CREATE POLICY "authenticated_select_settings" ON public.settings
    FOR SELECT
    TO authenticated
    USING (true);

-- STEP 5: IDEMPOTENT REMOVAL OF ALL DEMO SEED DATA
DELETE FROM public.attendance_records
WHERE session_id IN (SELECT id FROM public.lecture_sessions WHERE course_id IN (SELECT id FROM public.courses WHERE course_code = 'ADUN CYB 201'));

DELETE FROM public.course_roster
WHERE course_id IN (SELECT id FROM public.courses WHERE course_code = 'ADUN CYB 201');

DELETE FROM public.lecture_sessions
WHERE course_id IN (SELECT id FROM public.courses WHERE course_code = 'ADUN CYB 201');

DELETE FROM public.courses
WHERE course_code = 'ADUN CYB 201';

DELETE FROM public.users
WHERE username = 'tega';

DELETE FROM public.students_master
WHERE matric_no LIKE 'ADUN/2024/CYB/%' OR matric_no LIKE 'ADUN/FS/COM/25/%';
