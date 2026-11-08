/**
 * ADUN Attendance - Supabase Client Factory for Edge Functions & Services
 */
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import type { Database } from '../../types/database.types.ts';

export function getServiceClient(): SupabaseClient<Database> {
  const supabaseUrl =
    (typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_URL') : process.env.SUPABASE_URL) ||
    'http://127.0.0.1:54321';

  const supabaseServiceKey =
    (typeof Deno !== 'undefined'
      ? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      : process.env.SUPABASE_SERVICE_ROLE_KEY) ||
    '';

  if (!supabaseServiceKey) {
    console.warn('SUPABASE_SERVICE_ROLE_KEY is not set. Using empty key.');
  }

  return createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function getUserClient(authHeader?: string): SupabaseClient<Database> {
  const supabaseUrl =
    (typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_URL') : process.env.SUPABASE_URL) ||
    'http://127.0.0.1:54321';

  const supabaseAnonKey =
    (typeof Deno !== 'undefined'
      ? Deno.env.get('SUPABASE_ANON_KEY')
      : process.env.SUPABASE_ANON_KEY) ||
    '';

  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
    },
    global: {
      headers: authHeader ? { Authorization: authHeader } : {},
    },
  });
}
