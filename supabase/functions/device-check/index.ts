/**
 * Edge Function: device-check
 * Fixes: SEC-03, SEC-05, SEC-06, C1
 *
 * Implements Section 8 pseudocode of ADUN Strict Device Binding Specification (Option 2).
 * Validates device fingerprint with server salt, trusted-device HMAC cookie from request header only,
 * and local_device_id with UUID validation.
 * Sets HttpOnly signed cookie on initial bind.
 * NEVER leaks trusted_device_token in JSON response body.
 */
import { getCorsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/supabaseClient.ts';
import { sha256Hex } from '../_shared/crypto.ts';
import {
  parseCookies,
  createSignedCookieToken,
  verifySignedCookieToken,
  createDeviceCookieHeader,
} from '../_shared/cookie.ts';
import { hashWithSalt } from '../_shared/fingerprint.ts';

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
    const studentId = body?.student_id;
    const attemptToken = body?.attempt_token;
    let attemptId = body?.attempt_id || null;

    if (!studentId || !isValidUuid(studentId)) {
      return new Response(JSON.stringify({
        action: 'CONTACT_ADMIN',
        reason: 'INVALID_STUDENT_ID',
        reference_code: 'BIND-400-PARAMS',
      }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    const localDeviceIdRaw = body?.local_device_id ?? body?.device_id ?? null;
    const localDeviceIdValid = isValidUuid(localDeviceIdRaw) ? localDeviceIdRaw.trim() : null;

    const fingerprintRaw = body?.fingerprint ?? body?.fingerprint_hash;
    if (!fingerprintRaw || typeof fingerprintRaw !== 'string' || !fingerprintRaw.trim()) {
      return new Response(JSON.stringify({
        action: 'CONTACT_ADMIN',
        reason: 'FINGERPRINT_REQUIRED',
        reference_code: 'BIND-400-NOFP',
      }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Hash fingerprint using authoritative server-side salt (SEC-06)
    const fingerprintHash = await hashWithSalt(fingerprintRaw);

    // Extract trusted cookie ONLY from HTTP request headers (SEC-05)
    const cookies = parseCookies(req.headers.get('Cookie') ?? '');
    const trustedCookie = cookies['adun_trusted_device'] ?? null;

    let cookieHash: string | null = null;
    if (trustedCookie) {
      const verification = await verifySignedCookieToken(trustedCookie);
      if (verification.valid && verification.studentId === studentId) {
        cookieHash = await sha256Hex(trustedCookie);
      }
    }

    const supabase = getServiceClient();

    // Resolve attempt_id from attempt_token if not explicitly supplied
    if (!attemptId && attemptToken) {
      const attemptTokenHash = await sha256Hex(attemptToken);
      const { data: attempt } = await supabase
        .from('attendance_attempts')
        .select('id')
        .eq('attempt_token_hash', attemptTokenHash)
        .maybeSingle();

      if (attempt) {
        attemptId = attempt.id;
      }
    }

    const userAgent = req.headers.get('user-agent') ?? null;
    const clientIp =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      req.headers.get('cf-connecting-ip') ??
      req.headers.get('x-real-ip') ??
      null;

    // Call atomic transactional RPC implementing C1 Incognito Precedence
    const { data: result, error: rpcErr } = await supabase.rpc('rpc_device_check', {
      p_student_id: studentId,
      p_attempt_id: attemptId,
      p_fingerprint_hash: fingerprintHash,
      p_cookie_token_hash: cookieHash,
      p_local_device_id: localDeviceIdValid,
      p_incognito_signal: body?.incognito_signal === true,
      p_user_agent: userAgent,
      p_ip: clientIp,
    });

    if (rpcErr || !result) {
      console.error('RPC Error in rpc_device_check:', rpcErr);
      return new Response(JSON.stringify({
        action: 'CONTACT_ADMIN',
        reason: 'DATABASE_ERROR',
        reference_code: 'BIND-500-DB',
      }), {
        status: 500,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    const responseHeaders: Record<string, string> = {
      ...baseHeaders,
      'Content-Type': 'application/json',
    };

    // Issue signed HttpOnly cookie exclusively on initial bind (BIND-200 BOUND)
    if (result.action === 'OK' && result.reason === 'BOUND') {
      const newCookie = await createSignedCookieToken(studentId, fingerprintHash);
      const newCookieHash = await sha256Hex(newCookie);

      // Persist cookie hash on binding record
      if (result.binding_id) {
        await supabase
          .from('device_bindings')
          .update({ trusted_cookie_hash: newCookieHash })
          .eq('id', result.binding_id);
      }

      responseHeaders['Set-Cookie'] = createDeviceCookieHeader(newCookie);
    }

    // NEVER leak raw trusted_device_token in JSON body (SEC-05)
    return new Response(JSON.stringify({
      action: result.action,
      reason: result.reason,
      reference_code: result.reference_code,
    }), {
      status: 200,
      headers: responseHeaders,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return new Response(JSON.stringify({
      action: 'CONTACT_ADMIN',
      reason: message,
      reference_code: 'BIND-500-INTERNAL',
    }), {
      status: 500,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }
});
