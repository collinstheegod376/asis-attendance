/**
 * Edge Function: submit-attendance
 * Fixes: SEC-05, SEC-08, SEC-10, SEC-11, QA-01, PERF-01, PERF-07, C1
 *
 * Atomically submits attendance. Calls rpc_submit_attendance which:
 * - Inlines Gate 4 device verification inside the database transaction
 * - Strips selfie_data_url from device_info (PERF-07)
 * - Reads trusted-device cookie strictly from Cookie header (SEC-05)
 * - Returns 409 ALREADY_SIGNED with existing receipt_id on duplicate
 */
import { getCorsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/supabaseClient.ts';
import { sha256Hex } from '../_shared/crypto.ts';
import { parseCookies, verifySignedCookieToken } from '../_shared/cookie.ts';

declare const Deno: any;

function isValidUuid(id: unknown): boolean {
  if (typeof id !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id.trim());
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const baseHeaders = getCorsHeaders(req);

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const attemptToken = body?.attempt_token || req.headers.get('x-attempt-token');
    const selfiePath = body?.selfie_path;
    const fingerprintHash = body?.fingerprint_hash;
    const idempotencyKey = body?.idempotency_key || req.headers.get('x-idempotency-key') || null;

    // 1. Mandatory fingerprint_hash requirement (SEC-10)
    if (!fingerprintHash || typeof fingerprintHash !== 'string' || !fingerprintHash.trim()) {
      return new Response(JSON.stringify({
        error: 'FINGERPRINT_REQUIRED',
        message: 'fingerprint_hash is strictly required for attendance submission.',
      }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!attemptToken || typeof attemptToken !== 'string') {
      return new Response(JSON.stringify({
        error: 'INVALID_ATTEMPT_TOKEN',
        message: 'attempt_token is required.',
      }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!selfiePath || typeof selfiePath !== 'string') {
      return new Response(JSON.stringify({
        error: 'INVALID_SELFIE_PATH',
        message: 'selfie_path is required.',
      }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = getServiceClient();

    // 2. Resolve attempt
    const attemptTokenHash = await sha256Hex(attemptToken);
    let attemptId = body?.attempt_id || null;

    const { data: attempt, error: attemptErr } = await supabase
      .from('attendance_attempts')
      .select('*')
      .eq('attempt_token_hash', attemptTokenHash)
      .maybeSingle();

    if (attemptErr || !attempt) {
      return new Response(JSON.stringify({
        error: 'INVALID_ATTEMPT',
        message: 'Invalid or expired check-in attempt session.',
      }), {
        status: 401,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    attemptId = attempt.id;

    if (new Date().toISOString() >= attempt.expires_at || attempt.completed_at) {
      return new Response(JSON.stringify({
        error: 'ATTEMPT_EXPIRED',
        message: 'This check-in attempt has expired. Please scan QR again.',
      }), {
        status: 410,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!attempt.student_id) {
      return new Response(JSON.stringify({
        error: 'IDENTITY_MISSING',
        message: 'Student identity has not been verified for this attempt.',
      }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Clean device_info payload: NEVER store base64 string in database (PERF-07)
    const rawDeviceInfo = body?.device_info || {};
    const deviceInfo: Record<string, unknown> = { ...rawDeviceInfo };
    if ('selfie_data_url' in deviceInfo) {
      delete deviceInfo.selfie_data_url;
    }

    const userAgent = req.headers.get('user-agent') ?? (deviceInfo?.user_agent as string) ?? null;
    const clientIp =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      req.headers.get('cf-connecting-ip') ??
      req.headers.get('x-real-ip') ??
      null;

    deviceInfo.user_agent = userAgent;
    deviceInfo.ip = clientIp;
    deviceInfo.fingerprint_hash = fingerprintHash;

    // 4. Extract and verify trusted cookie strictly from Cookie header (SEC-05)
    const cookies = parseCookies(req.headers.get('Cookie') ?? '');
    const trustedCookie = cookies['adun_trusted_device'] ?? null;

    let cookieHash: string | null = null;
    if (trustedCookie) {
      const verification = await verifySignedCookieToken(trustedCookie);
      if (verification.valid && verification.studentId === attempt.student_id) {
        cookieHash = await sha256Hex(trustedCookie);
      }
    }

    const localDeviceIdRaw = deviceInfo?.local_device_id ?? body?.local_device_id ?? null;
    const localDeviceId = isValidUuid(localDeviceIdRaw) ? localDeviceIdRaw : null;
    const incognitoSignal = Boolean(deviceInfo?.incognito_signal ?? body?.incognito_signal);

    // 5. Atomic submission RPC (executes inlined Gate 4 device check + same-session collision check)
    const { data: result, error: rpcErr } = await supabase.rpc('rpc_submit_attendance', {
      p_attempt_id: attemptId,
      p_attempt_token: attemptToken,
      p_selfie_path: selfiePath.trim(),
      p_device_info: deviceInfo,
      p_idempotency_key: idempotencyKey,
      p_fingerprint_hash: fingerprintHash,
      p_binding_id: null,
      p_cookie_token_hash: cookieHash,
      p_local_device_id: localDeviceId,
      p_incognito_signal: incognitoSignal,
    });

    if (rpcErr || !result) {
      console.error('RPC Error in rpc_submit_attendance:', rpcErr);
      const isGeofenceUnconfigured = rpcErr?.message?.includes('GEOFENCE_NOT_CONFIGURED');
      return new Response(JSON.stringify({
        error: isGeofenceUnconfigured ? 'GEOFENCE_NOT_CONFIGURED' : 'DATABASE_ERROR',
        message: rpcErr?.message || 'Database error occurred during submission.',
      }), {
        status: isGeofenceUnconfigured ? 400 : 500,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 6. Idempotent Retry: Already signed returns 409 with existing receipt
    if (result.already_signed === true) {
      return new Response(JSON.stringify({
        receipt_id: result.receipt_id,
        signed_at: result.signed_at,
        status: result.status,
      }), {
        status: 409,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 7. Handle failures
    if (!result.success) {
      const errCode = (result.error as string) || 'SUBMISSION_FAILED';
      const status =
        errCode === 'PROXY_DETECTED' || result.reference_code === 'BIND-203'
          ? 403
          : errCode === 'DEVICE_CHECK_FAILED' || errCode === 'OUTSIDE_CLASSROOM_BOUNDARY' || errCode === 'OUTSIDE_CAMPUS_BOUNDARY'
          ? 403
          : errCode === 'ATTEMPT_EXPIRED' || errCode === 'SESSION_EXPIRED'
          ? 410
          : 400;

      return new Response(JSON.stringify({
        error: errCode,
        message: result.message,
        reason: result.reason,
        action: result.action,
        reference_code: result.reference_code,
        ...(result.distance_m !== undefined ? { distance_m: result.distance_m } : {}),
        ...(result.allowed_radius_m !== undefined ? { allowed_radius_m: result.allowed_radius_m } : {}),
      }), {
        status,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 8. Success: Return 200 with receipt contract
    return new Response(JSON.stringify({
      receipt_id: result.receipt_id,
      signed_at: result.signed_at,
      status: result.status,
    }), {
      status: 200,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown internal error';
    return new Response(JSON.stringify({ error: 'INTERNAL_SERVER_ERROR', message }), {
      status: 500,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }
});
