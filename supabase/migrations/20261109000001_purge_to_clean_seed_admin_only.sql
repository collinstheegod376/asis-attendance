-- ============================================================================
-- ADUN Attendance System - Database Clean Slate / Reset
-- Migration: 20261109000001_purge_to_clean_seed_admin_only.sql
-- Description:
--   Purges all student records, course rosters, courses, lecture sessions,
--   attendance records, attempts, device bindings, events, and audit logs.
--   Preserves ONLY the default institutional seed admin account (admin / admin).
-- ============================================================================

-- 1. PURGE ATTENDANCE & SESSIONS DATA
DELETE FROM attendance_records;
DELETE FROM attendance_attempts;
DELETE FROM device_events;
DELETE FROM device_bindings;
DELETE FROM lecture_sessions;

-- 2. PURGE COURSE & ROSTER DATA
DELETE FROM course_roster;
DELETE FROM courses;

-- 3. PURGE STUDENTS DIRECTORY
DELETE FROM students_master;

-- 4. PURGE AUDIT LOGS
DELETE FROM audit_logs;

-- 5. PURGE NON-ADMIN USERS (PRESERVE ONLY DEFAULT ADMIN)
DELETE FROM users WHERE username != 'admin';

-- 6. ENSURE SEED ADMIN EXISTS AND IS ACTIVE
INSERT INTO users (
    id,
    role,
    username,
    email,
    password_hash,
    status,
    must_change_password,
    created_at
) VALUES (
    '00000000-0000-0000-0000-000000000001'::uuid,
    'admin',
    'admin',
    'admin@adun.edu.ng',
    crypt('admin', gen_salt('bf', 10)),
    'active',
    true,
    timezone('utc', now())
) ON CONFLICT (username) DO UPDATE SET
    status = 'active',
    role = 'admin',
    must_change_password = true;

-- Verification
SELECT 'users' AS table_name, count(*)::text AS record_count FROM users
UNION ALL SELECT 'students_master', count(*)::text FROM students_master
UNION ALL SELECT 'courses', count(*)::text FROM courses
UNION ALL SELECT 'course_roster', count(*)::text FROM course_roster
UNION ALL SELECT 'lecture_sessions', count(*)::text FROM lecture_sessions
UNION ALL SELECT 'attendance_records', count(*)::text FROM attendance_records
UNION ALL SELECT 'device_bindings', count(*)::text FROM device_bindings
UNION ALL SELECT 'device_events', count(*)::text FROM device_events
UNION ALL SELECT 'audit_logs', count(*)::text FROM audit_logs
UNION ALL SELECT 'settings', count(*)::text FROM settings;
