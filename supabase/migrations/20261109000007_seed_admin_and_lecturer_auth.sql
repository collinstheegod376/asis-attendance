-- ============================================================================
-- Migration: 20261109000007_seed_admin_and_lecturer_auth.sql
-- Description:
--   Seeds auth.users, auth.identities, and links public.users for:
--   1. admin (username: admin, email: admin@adun.edu.ng, initial password: admin)
--   2. Mr Tega (username: tega, email: tega@adun.edu.ng, initial password: admin)
-- ============================================================================

DO $$
DECLARE
  v_admin_id UUID := '00000000-0000-0000-0000-000000000001';
  v_admin_email TEXT := 'admin@adun.edu.ng';
  v_admin_pw TEXT := extensions.crypt('admin', extensions.gen_salt('bf', 10));

  v_tega_id UUID := '00000000-0000-0000-0000-000000000002';
  v_tega_email TEXT := 'tega@adun.edu.ng';
  v_tega_pw TEXT := extensions.crypt('admin', extensions.gen_salt('bf', 10));
BEGIN
  -- 1. SEED ADMIN
  DELETE FROM auth.identities WHERE user_id = v_admin_id;
  DELETE FROM auth.users WHERE id = v_admin_id;

  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change,
    email_change_token_current,
    phone_change,
    phone_change_token,
    reauthentication_token,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_admin_id,
    'authenticated',
    'authenticated',
    v_admin_email,
    v_admin_pw,
    now(),
    '', '', '', '', '', '', '', '',
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('role', 'admin', 'name', 'System Administrator'),
    now(),
    now()
  );

  INSERT INTO auth.identities (
    id,
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    v_admin_id::text,
    v_admin_id,
    jsonb_build_object('sub', v_admin_id::text, 'email', v_admin_email, 'email_verified', true, 'phone_verified', false),
    'email',
    now(),
    now(),
    now()
  );

  UPDATE public.users
  SET auth_id = v_admin_id,
      email = v_admin_email,
      must_change_password = true,
      status = 'active'
  WHERE id = v_admin_id;

  -- 2. SEED LECTURER MR TEGA
  DELETE FROM auth.identities WHERE user_id = v_tega_id;
  DELETE FROM auth.users WHERE id = v_tega_id;

  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change,
    email_change_token_current,
    phone_change,
    phone_change_token,
    reauthentication_token,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_tega_id,
    'authenticated',
    'authenticated',
    v_tega_email,
    v_tega_pw,
    now(),
    '', '', '', '', '', '', '', '',
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('role', 'lecturer', 'name', 'Mr Tega'),
    now(),
    now()
  );

  INSERT INTO auth.identities (
    id,
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    v_tega_id::text,
    v_tega_id,
    jsonb_build_object('sub', v_tega_id::text, 'email', v_tega_email, 'email_verified', true, 'phone_verified', false),
    'email',
    now(),
    now(),
    now()
  );

  INSERT INTO public.users (
    id,
    auth_id,
    role,
    username,
    email,
    password_hash,
    status,
    must_change_password,
    created_at
  ) VALUES (
    v_tega_id,
    v_tega_id,
    'lecturer',
    'tega',
    v_tega_email,
    v_tega_pw,
    'active',
    false,
    now()
  ) ON CONFLICT (id) DO UPDATE SET
    auth_id = v_tega_id,
    email = v_tega_email,
    role = 'lecturer',
    status = 'active';

END $$;
