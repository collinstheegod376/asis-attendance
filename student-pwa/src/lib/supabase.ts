import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder';

const isRealSupabase =
  Boolean(SUPABASE_URL && SUPABASE_ANON_KEY) &&
  !SUPABASE_URL.includes('127.0.0.1:54321') &&
  !SUPABASE_URL.includes('<your-project-id>') &&
  SUPABASE_ANON_KEY !== 'your_supabase_anon_key_here';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function callLocalRpc(fn: string, args: Record<string, unknown>): Promise<any> {
  const res = await fetch('/api/local-rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ fn, args }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `Server error (${res.status})`);
  }
  return res.json();
}

export interface DeviceCheckResponse {
  success?: boolean;
  action?: 'ALLOW' | 'OK' | 'OPEN_NORMAL_BROWSER' | 'CONTACT_ADMIN' | 'SHARED_DEVICE' | 'NEW_DEVICE' | 'DEVICE_IN_USE';
  reason?: string;
  reference_code?: string;
  statusCode?: number;
  error?: string;
  message?: string;
}

/**
 * Service to validate tokens, lookup matric, verify location, check device binding,
 * and submit attendance via Supabase Edge Functions / RPC or local synced engine.
 */
export const attendanceApi = {
  async validateSessionToken(rawToken: string) {
    const cleanToken = rawToken.trim();
    if (isRealSupabase) {
      try {
        const { data, error } = await supabase.rpc('rpc_validate_session_token', {
          p_raw_token: cleanToken,
        });
        if (!error && data && data.success) return data;
      } catch {
        // Fallback to local sync engine
      }
    }
    return callLocalRpc('rpc_validate_session_token', { p_raw_token: cleanToken });
  },

  async lookupMatric(attemptId: string, attemptToken: string, rawMatric: string, deviceId: string) {
    const args = {
      p_attempt_id: attemptId,
      p_attempt_token: attemptToken,
      p_raw_matric: rawMatric.trim().toUpperCase(),
      p_device_id: deviceId,
    };
    if (isRealSupabase && !attemptId.startsWith('att_')) {
      try {
        const { data, error } = await supabase.rpc('rpc_lookup_matric', args);
        if (!error && data) return data;
      } catch {
        // Fallback to local sync engine
      }
    }
    return callLocalRpc('rpc_lookup_matric', args);
  },

  async checkDevice(
    studentId: string,
    fingerprintHash: string,
    deviceId: string,
    incognitoSignal: boolean
  ): Promise<DeviceCheckResponse> {
    if (isRealSupabase && !studentId.startsWith('std_')) {
      // 1. Try Edge Function /device-check first (reads & sets HttpOnly trusted device cookie)
      try {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/device-check`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
          },
          credentials: 'include',
          body: JSON.stringify({
            student_id: studentId,
            fingerprint_hash: fingerprintHash,
            device_id: deviceId,
            incognito_signal: incognitoSignal,
            user_agent: navigator.userAgent,
          }),
        });

        if (response.ok || response.status === 403 || response.status === 409 || response.status === 400) {
          const json = await response.json();
          return {
            statusCode: response.status,
            ...json,
          };
        }
      } catch (e) {
        console.warn('Edge function /device-check unreachable, attempting RPC fallback:', e);
      }

      // 2. Direct RPC fallback
      try {
        const { data, error } = await supabase.rpc('rpc_device_check', {
          p_student_id: studentId,
          p_fingerprint_hash: fingerprintHash,
          p_cookie_token_hash: null,
          p_local_device_id: deviceId,
          p_incognito_signal: incognitoSignal,
          p_user_agent: navigator.userAgent,
          p_ip: null,
        });

        if (!error && data) {
          return data as DeviceCheckResponse;
        }
      } catch {
        // Fallback to local sync engine
      }
    }

    try {
      return await callLocalRpc('rpc_device_check', {
        p_student_id: studentId,
        p_fingerprint_hash: fingerprintHash,
        p_local_device_id: deviceId,
        p_incognito_signal: incognitoSignal,
        p_user_agent: navigator.userAgent,
      });
    } catch (rpcErr: unknown) {
      const msg = rpcErr instanceof Error ? rpcErr.message : String(rpcErr);
      return {
        success: false,
        action: 'CONTACT_ADMIN',
        reference_code: 'BIND-204',
        reason: msg || 'Device verification failed.',
      };
    }
  },

  async verifyLocation(attemptId: string, attemptToken: string, latitude: number, longitude: number, accuracyM: number) {
    const args = {
      p_attempt_id: attemptId,
      p_attempt_token: attemptToken,
      p_latitude: latitude,
      p_longitude: longitude,
      p_accuracy_m: accuracyM,
    };
    if (isRealSupabase && !attemptId.startsWith('att_')) {
      try {
        const { data, error } = await supabase.rpc('rpc_verify_location', args);
        if (!error && data) return data;
      } catch {
        // Fallback to local sync engine
      }
    }
    return callLocalRpc('rpc_verify_location', args);
  },

  async uploadSelfie(sessionId: string, studentId: string, attemptId: string, fileBlob: Blob) {
    const path = `${sessionId}/${studentId}/${attemptId}.jpg`;
    if (isRealSupabase && !attemptId.startsWith('att_')) {
      try {
        const { data, error } = await supabase.storage.from('selfies').upload(path, fileBlob, {
          contentType: 'image/jpeg',
          upsert: true,
        });
        if (!error && data?.path) return data.path;
      } catch {
        // Fallback to local path
      }
    }
    return path;
  },

  async submitAttendance(
    attemptId: string,
    attemptToken: string,
    selfiePath: string,
    deviceInfo: Record<string, unknown>,
    idempotencyKey?: string
  ) {
    const args = {
      p_attempt_id: attemptId,
      p_attempt_token: attemptToken,
      p_selfie_path: selfiePath,
      p_device_info: deviceInfo,
      p_idempotency_key: idempotencyKey,
    };

    if (isRealSupabase && !attemptId.startsWith('att_')) {
      try {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/submit-attendance`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
          },
          credentials: 'include',
          body: JSON.stringify({
            attempt_id: attemptId,
            attempt_token: attemptToken,
            selfie_path: selfiePath,
            device_info: deviceInfo,
            idempotency_key: idempotencyKey,
          }),
        });

        if (response.ok || response.status === 403 || response.status === 409 || response.status === 410 || response.status === 400) {
          const json = await response.json();
          return json;
        }
      } catch (e) {
        console.warn('Edge function /submit-attendance unreachable, falling back to RPC:', e);
      }

      try {
        const { data, error } = await supabase.rpc('rpc_submit_attendance', args);
        if (!error && data) return data;
      } catch {
        // Fallback to local sync engine
      }
    }

    return callLocalRpc('rpc_submit_attendance', args);
  },
};
