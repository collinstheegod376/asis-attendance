/**
 * ADUN Attendance System - Authenticated Edge Function API Client
 * Automatically attaches Supabase JWT in Authorization header.
 * Dispatches to /api reverse-proxy path with seamless direct Supabase Functions fallback.
 * Fixes: SEC-15, QA-02, PERF-16
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';

const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL || '';

export async function getAuthToken(): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

export async function callEdgeFunction<T = any>(
  functionName: string,
  body: any
): Promise<{ success: boolean; data?: T; error?: string; status: number }> {
  const token = await getAuthToken();

  if (!token) {
    return {
      success: false,
      error: 'Authentication session expired. Please sign in again.',
      status: 401,
    };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  // Primary endpoint: /api/<functionName>
  // Fallback endpoint: <SUPABASE_URL>/functions/v1/<functionName>
  const endpoints = [
    `/api/${functionName}`,
    `${SUPABASE_URL}/functions/v1/${functionName}`,
  ];

  let lastStatus = 500;
  let lastError = 'Unknown error';

  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      lastStatus = response.status;
      const resJson = await response.json().catch(() => ({}));

      if (response.ok) {
        return {
          success: true,
          data: resJson as T,
          status: response.status,
        };
      }

      // If 404 on /api, continue to fallback
      if (response.status === 404 && url.startsWith('/api')) {
        continue;
      }

      const errorMessage =
        resJson?.message ||
        resJson?.error ||
        `Server returned error status ${response.status}`;

      return {
        success: false,
        error: errorMessage,
        status: response.status,
      };
    } catch (err: any) {
      lastError = err?.message || 'Network connection failed';
      // If network error on /api, try fallback
      continue;
    }
  }

  return {
    success: false,
    error: lastError,
    status: lastStatus,
  };
}
