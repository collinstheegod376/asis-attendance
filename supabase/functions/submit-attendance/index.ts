/**
 * Edge Function: submit-attendance
 * Atomically records student attendance.
 * RE-RUNS STRICT DEVICE CHECK (GATE 4) immediately prior to record creation.
 * Enforces same-session multi-student collision checks, Africa/Lagos timestamping,
 * grace period calculation (present vs late), receipt generation, and device binding snapshot.
 */
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/supabaseClient.ts';
import { sha256Hex } from '../_shared/crypto.ts';
import {
  parseCookies,
  hashFingerprint,
  verifySignedCookieToken,
} from '../_shared/cookie.ts';

declare const Deno: any;

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'POST method required', 405, {}, req);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const attemptId = body?.attempt_id;
    const attemptToken = body?.attempt_token || req.headers.get('x-attempt-token');
    const selfiePath = body?.selfie_path;
    const deviceInfo = body?.device_info || {};
    const idempotencyKey =
      body?.idempotency_key || req.headers.get('x-idempotency-key') || null;

    if (!attemptId || !attemptToken) {
      return errorResponse('BAD_REQUEST', 'attempt_id and attempt_token are required.', 400, {}, req);
    }

    if (!selfiePath || typeof selfiePath !== 'string') {
      return errorResponse('BAD_REQUEST', 'selfie_path is required.', 400, {}, req);
    }

    const userAgent = req.headers.get('user-agent') || deviceInfo?.user_agent || null;
    const clientIp =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('cf-connecting-ip') ||
      req.headers.get('x-real-ip') ||
      null;

    const supabase = getServiceClient();

    // 1. Verify Attempt and Extract Student & Session Context
    const attemptHash = await sha256Hex(attemptToken);
    const { data: attempt, error: attemptErr } = await supabase
      .from('attendance_attempts')
      .select('*')
      .eq('id', attemptId)
      .eq('attempt_token_hash', attemptHash)
      .maybeSingle();

    if (attemptErr || !attempt) {
      return errorResponse('INVALID_ATTEMPT', 'Invalid or expired attempt session.', 401, {}, req);
    }

    const nowIso = new Date().toISOString();
    if (nowIso >= attempt.expires_at || attempt.completed_at) {
      return errorResponse('ATTEMPT_EXPIRED', 'This check-in attempt has expired. Please scan QR again.', 410, {}, req);
    }

    if (!attempt.student_id) {
      return errorResponse('IDENTITY_MISSING', 'Student identity has not been verified for this attempt.', 400, {}, req);
    }

    // 2. Resolve Fingerprint Hash
    let fingerprintHash = deviceInfo?.fingerprint_hash || body?.fingerprint_hash;
    if (!fingerprintHash) {
      const rawFp = deviceInfo?.fingerprint || body?.fingerprint;
      if (rawFp) {
        fingerprintHash = await hashFingerprint(rawFp);
      } else if (attempt.fingerprint_hash) {
        fingerprintHash = attempt.fingerprint_hash;
      }
    }

    // 3. Extract & Validate Trusted Device Cookie
    const cookies = parseCookies(req.headers.get('cookie'));
    const cookieToken =
      cookies['adun_trusted_device'] ||
      req.headers.get('x-trusted-device-token') ||
      deviceInfo?.trusted_device_token ||
      null;

    let cookieTokenHash: string | null = null;
    if (cookieToken) {
      const verification = await verifySignedCookieToken(cookieToken);
      if (verification.valid && verification.studentId === attempt.student_id) {
        cookieTokenHash = await sha256Hex(cookieToken);
      }
    }

    // 4. GATE 4: Re-Run Device Check immediately before record creation (Spec Section 8)
    let bindingId: string | null = null;
    if (fingerprintHash) {
      const localDeviceId =
        deviceInfo?.local_device_id ||
        body?.local_device_id ||
        attempt.device_id ||
        null;
      const incognitoSignal = Boolean(deviceInfo?.incognito_signal ?? body?.incognito_signal);

      const { data: devCheck, error: devCheckErr } = await supabase.rpc('rpc_device_check', {
        p_student_id: attempt.student_id,
        p_fingerprint_hash: fingerprintHash,
        p_cookie_token_hash: cookieTokenHash,
        p_local_device_id: localDeviceId,
        p_incognito_signal: incognitoSignal,
        p_user_agent: userAgent,
        p_ip: clientIp,
      });

      if (devCheckErr) {
        console.error('Pre-submit device check RPC error:', devCheckErr);
        return errorResponse('DATABASE_ERROR', devCheckErr.message, 500, {}, req);
      }

      const checkResult = devCheck as Record<string, unknown>;
      if (!checkResult.allowed) {
        const httpStatus =
          typeof checkResult.status === 'number'
            ? checkResult.status
            : checkResult.action === 'OPEN_NORMAL_BROWSER'
            ? 403
            : 409;

        return jsonResponse(
          {
            success: false,
            allowed: false,
            action: checkResult.action,
            error: checkResult.error || 'DEVICE_CHECK_FAILED',
            reason: checkResult.reason,
            reference_code: checkResult.reference_code,
          },
          httpStatus,
          {},
          req
        );
      }

      bindingId = (checkResult.binding_id as string) || null;
    }

    // 5. Atomic Attendance Submission + Belt-and-Braces Collision Check
    const enrichedDeviceInfo = {
      ...deviceInfo,
      user_agent: userAgent,
      ip: clientIp,
      fingerprint_hash: fingerprintHash,
      binding_id: bindingId,
    };

    const { data, error } = await supabase.rpc('rpc_submit_attendance', {
      p_attempt_id: attemptId,
      p_attempt_token: attemptToken,
      p_selfie_path: selfiePath.trim(),
      p_device_info: enrichedDeviceInfo,
      p_idempotency_key: idempotencyKey,
      p_fingerprint_hash: fingerprintHash || null,
      p_binding_id: bindingId || null,
    });

    if (error) {
      console.error('RPC Error in submit-attendance:', error);
      return errorResponse('DATABASE_ERROR', error.message, 500, {}, req);
    }

    const result = data as Record<string, unknown>;

    if (!result.success) {
      const errCode = (result.error as string) || 'SUBMISSION_FAILED';
      const status =
        errCode === 'PROXY_DETECTED'
          ? 403
          : errCode === 'ALREADY_SIGNED'
          ? 409
          : errCode === 'ATTEMPT_EXPIRED' || errCode === 'SESSION_EXPIRED'
          ? 410
          : 400;

      return jsonResponse(result, status, {}, req);
    }

    return jsonResponse(result, 201, {}, req);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return errorResponse('INTERNAL_SERVER_ERROR', message, 500, {}, req);
  }
});
