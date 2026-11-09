-- ============================================================================
-- Migration: 20261109000008_fix_admin_table_grants_and_policies.sql
-- Description:
--   1. Grants INSERT, UPDATE, DELETE on public.users to authenticated (restricted by admin RLS).
--   2. Grants INSERT, UPDATE, DELETE on public.students_master to authenticated and defines admin write policy.
--   3. Grants INSERT, UPDATE, DELETE on public.course_roster to authenticated (governed by existing RLS).
--   4. Grants INSERT on public.audit_logs to authenticated with insert policy.
-- ============================================================================

-- 1. USERS TABLE GRANTS
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO authenticated;

-- 2. STUDENTS_MASTER TABLE GRANTS & ADMIN FULL ACCESS POLICY
GRANT SELECT, INSERT, UPDATE, DELETE ON public.students_master TO authenticated;

DROP POLICY IF EXISTS "admin_select_students_master" ON public.students_master;
DROP POLICY IF EXISTS "admin_all_students_master" ON public.students_master;
CREATE POLICY "admin_all_students_master" ON public.students_master
    FOR ALL
    TO authenticated
    USING (public.auth_user_role() = 'admin')
    WITH CHECK (public.auth_user_role() = 'admin');

-- 3. COURSE_ROSTER TABLE GRANTS
GRANT SELECT, INSERT, UPDATE, DELETE ON public.course_roster TO authenticated;

-- 4. AUDIT_LOGS TABLE GRANTS & INSERT POLICY
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;

DROP POLICY IF EXISTS "authenticated_insert_audit_logs" ON public.audit_logs;
CREATE POLICY "authenticated_insert_audit_logs" ON public.audit_logs
    FOR INSERT
    TO authenticated
    WITH CHECK (true);
