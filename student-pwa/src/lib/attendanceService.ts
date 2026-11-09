/**
 * ADUN Attendance Service
 * Strictly calls Edge Functions under `/api/*` with credentials: 'include'.
 * Never calls Supabase tables or RPCs directly.
 * Fixes: PERF-04, PERF-05, SEC-01, SEC-02, SEC-05, SEC-18
 */

export interface ValidateSessionTokenResponse {
  attempt_id: string;
  attempt_token: string;
  session_id: string;
  course_id: string;
  expires_at: string;
  step: string;
  student_id: string | null;
}

export interface LookupMatricResponse {
  student_id: string;
  full_name: string;
  program: string;
  level: number;
  matric_no: string;
}

export interface DeviceCheckResponse {
  action: 'OK' | 'CONTACT_ADMIN' | 'OPEN_NORMAL_BROWSER';
  reason?: string;
  reference_code: string;
}

export interface VerifyLocationResponse {
  success: boolean;
  inside_boundary: boolean;
  error?: string;
  message?: string;
}

export interface UploadSelfieResponse {
  selfie_path: string;
}

export interface SubmitAttendanceResponse {
  receipt_id: string;
  signed_at: string;
  status: 'present' | 'late';
  already_signed?: boolean;
}

export class ApiError extends Error {
  status: number;
  code: string;
  data: any;

  constructor(status: number, code: string, message: string, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export const attendanceService = {
  /**
   * Validates raw QR session token and returns check-in attempt details.
   * Can accept optional existing attempt token for attempt reuse (Fixes SEC-22).
   */
  async validateSessionToken(token: string, existingAttemptToken?: string): Promise<ValidateSessionTokenResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (existingAttemptToken) {
      headers['X-Attempt-Token'] = existingAttemptToken;
    }

    const res = await fetch('/api/validate-session-token', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ token: token.trim(), attempt_token: existingAttemptToken }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(res.status, json.error || 'VALIDATION_FAILED', json.message || 'Failed to validate session token.', json);
    }

    return json as ValidateSessionTokenResponse;
  },

  /**
   * Looks up student by matric number for the current attempt.
   * Debounced and rate-limited.
   */
  async lookupMatric(attemptToken: string, matricNo: string): Promise<LookupMatricResponse> {
    const res = await fetch('/api/lookup-matric', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        attempt_token: attemptToken,
        matric_no: matricNo,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(res.status, json.error || 'LOOKUP_FAILED', json.message || 'Student not eligible or not found.', json);
    }

    return json as LookupMatricResponse;
  },

  /**
   * Performs server-side device check and binding.
   * Sets adun_trusted_device HttpOnly cookie on first bind.
   */
  async checkDevice(params: {
    attemptToken: string;
    studentId: string;
    fingerprint: string;
    localDeviceId: string;
    incognitoSignal: boolean;
  }): Promise<DeviceCheckResponse> {
    const res = await fetch('/api/device-check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        attempt_token: params.attemptToken,
        student_id: params.studentId,
        fingerprint: params.fingerprint,
        local_device_id: params.localDeviceId,
        incognito_signal: params.incognitoSignal,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(res.status, json.error || 'DEVICE_CHECK_FAILED', json.reason || json.message || 'Device verification failed.', json);
    }

    return json as DeviceCheckResponse;
  },

  /**
   * Verifies GPS coordinates against institutional campus boundary.
   * Fail closed: returns error if coordinates are invalid or outside boundary.
   */
  async verifyLocation(params: {
    attemptToken: string;
    latitude: number;
    longitude: number;
    accuracyM: number;
  }): Promise<VerifyLocationResponse> {
    const res = await fetch('/api/verify-location', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        attempt_token: params.attemptToken,
        latitude: params.latitude,
        longitude: params.longitude,
        accuracy_m: params.accuracyM,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(res.status, json.error || 'LOCATION_VERIFICATION_FAILED', json.message || 'Location could not be verified.', json);
    }

    return json as VerifyLocationResponse;
  },

  /**
   * Uploads selfie image proof to secure private bucket via server-side Edge Function.
   * Returns canonical storage path. Never fabricates a path on failure.
   */
  async uploadSelfie(attemptToken: string, imageBase64: string): Promise<UploadSelfieResponse> {
    const res = await fetch('/api/upload-selfie', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        attempt_token: attemptToken,
        image_base64: imageBase64,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(res.status, json.error || 'UPLOAD_FAILED', json.message || 'Failed to upload selfie.', json);
    }

    return json as UploadSelfieResponse;
  },

  /**
   * Submits final attendance atomically.
   * Inlines Gate 4 check. Returns receipt on 200 or 409 ALREADY_SIGNED.
   */
  async submitAttendance(params: {
    attemptToken: string;
    selfiePath: string;
    fingerprintHash: string;
    deviceInfo: Record<string, unknown>;
    idempotencyKey?: string;
  }): Promise<SubmitAttendanceResponse> {
    const res = await fetch('/api/submit-attendance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(params.idempotencyKey ? { 'x-idempotency-key': params.idempotencyKey } : {}),
      },
      credentials: 'include',
      body: JSON.stringify({
        attempt_token: params.attemptToken,
        selfie_path: params.selfiePath,
        fingerprint_hash: params.fingerprintHash,
        device_info: params.deviceInfo,
        idempotency_key: params.idempotencyKey,
      }),
    });

    const json = await res.json().catch(() => ({}));

    // 409 with receipt_id means ALREADY_SIGNED idempotent success!
    if (res.status === 409 && json.receipt_id) {
      return {
        ...json,
        already_signed: true,
      } as SubmitAttendanceResponse;
    }

    if (!res.ok) {
      throw new ApiError(res.status, json.error || 'SUBMIT_FAILED', json.message || json.reason || 'Attendance submission failed.', json);
    }

    return json as SubmitAttendanceResponse;
  },
};
