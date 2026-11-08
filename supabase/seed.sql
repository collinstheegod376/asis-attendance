-- ============================================================================
-- ADUN Attendance System - Standalone Database Seed
-- STRICT POLICY: ZERO DEMO DATA. NO DUMMY STUDENTS. NO DUMMY COURSES.
-- Only the mandatory seed admin account and system settings.
-- ============================================================================

-- Ensure default settings exist
INSERT INTO public.settings (
    id,
    location_mode,
    campus_boundary_geojson,
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
    'evidence_only',
    NULL,
    50.0,
    60,
    180,
    180,
    10,
    9,
    60,
    30
) ON CONFLICT (id) DO UPDATE SET
    default_session_duration_minutes = EXCLUDED.default_session_duration_minutes,
    max_session_duration_minutes = EXCLUDED.max_session_duration_minutes,
    location_accuracy_threshold_m = EXCLUDED.location_accuracy_threshold_m,
    grace_minutes = EXCLUDED.grace_minutes,
    max_active_courses_per_lecturer = EXCLUDED.max_active_courses_per_lecturer;

-- Ensure mandatory seed admin account exists
-- Username: admin
-- Password: admin
-- Role: admin
-- Must Change Password: true
INSERT INTO public.users (
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
    must_change_password = true;
