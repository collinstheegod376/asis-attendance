import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

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
 * and submit attendance via Supabase Edge Functions or RPC fallback.
 */
export const attendanceApi = {
  async validateSessionToken(rawToken: string) {
    const { data, error } = await supabase.rpc('rpc_validate_session_token', {
      p_raw_token: rawToken.trim(),
    });
    if (error) throw error;
    return data;
  },

  async lookupMatric(attemptId: string, attemptToken: string, rawMatric: string, deviceId: string) {
    const { data, error } = await supabase.rpc('rpc_lookup_matric', {
      p_attempt_id: attemptId,
      p_attempt_token: attemptToken,
      p_raw_matric: rawMatric.trim().toUpperCase(),
      p_device_id: deviceId,
    });
    if (error) throw error;
    return data;
  },

  async checkDevice(
    studentId: string,
    fingerprintHash: string,
    deviceId: string,
    incognitoSignal: boolean
  ): Promise<DeviceCheckResponse> {
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

      if (error) {
        console.warn('RPC rpc_device_check fallback error:', error);
        return {
          success: false,
          action: 'CONTACT_ADMIN',
          reference_code: 'BIND-204',
          reason: error.message || 'This device is not fully recognised. Contact the admin to reset your device, then try again.',
        };
      }

      return data as DeviceCheckResponse;
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
    const { data, error } = await supabase.rpc('rpc_verify_location', {
      p_attempt_id: attemptId,
      p_attempt_token: attemptToken,
      p_latitude: latitude,
      p_longitude: longitude,
      p_accuracy_m: accuracyM,
    });
    if (error) throw error;
    return data;
  },

  async uploadSelfie(sessionId: string, studentId: string, attemptId: string, fileBlob: Blob) {
    const path = `${sessionId}/${studentId}/${attemptId}.jpg`;
    const { data, error } = await supabase.storage.from('selfies').upload(path, fileBlob, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (error) {
      console.warn('Storage upload notice (falling back if bucket restricted):', error.message);
      return path;
    }
    return data?.path || path;
  },

  async submitAttendance(
    attemptId: string,
    attemptToken: string,
    selfiePath: string,
    deviceInfo: Record<string, unknown>,
    idempotencyKey?: string
  ) {
    // 1. Try Edge Function /submit-attendance first (which checks same-session multi-student and cookie)
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

    // 2. Direct RPC fallback
    const { data, error } = await supabase.rpc('rpc_submit_attendance', {
      p_attempt_id: attemptId,
      p_attempt_token: attemptToken,
      p_selfie_path: selfiePath,
      p_device_info: deviceInfo,
      p_idempotency_key: idempotencyKey,
    });
    if (error) throw error;
    return data;
  },
};
