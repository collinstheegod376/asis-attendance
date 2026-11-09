/**
 * Supabase client and API adapter for Student PWA.
 * In compliance with ADUN Security Architecture:
 * - Anon has 0 direct table or RPC access in production.
 * - All calls MUST go through Edge Functions under `/api/*` via same-origin reverse proxy.
 * Fixes: SEC-01, SEC-02, PERF-04, PERF-05
 */
import { createClient } from '@supabase/supabase-js';
import { attendanceService } from './attendanceService';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export { attendanceService };
export const attendanceApi = attendanceService;
