/**
 * Edge Function: device-check
 * Implements Section 8 pseudocode of ADUN Strict Device Binding Specification (Option 2).
 * Validates device fingerprint, trusted-device HMAC cookie, and localStorage device ID.
 * Issues signed adun_trusted_device HttpOnly cookie on first bind.
 */
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/supabaseClient.ts';
import { sha256Hex, normalizeMatric } from '../_shared/crypto.ts';
import {
  parseCookies,
  hashFingerprint,
  createSignedCookieToken,
  verifySignedCookieToken,
  createDeviceCookieHeader,
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
    const rawFingerprint = body?.fingerprint;
    const providedFingerprintHash = body?.fingerprint_hash;
    const matricNo = body?.matric_no;
    let studentId = body?.student_id;
    const localDeviceId = body?.local_device_id || null;
    const incognitoSignal = Boolean(body?.incognito_signal);

    const userAgent = req.headers.get('user-agent') || body?.user_agent || null;
    const clientIp =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('cf-connecting-ip') ||
      req.headers.get('x-real-ip') ||
      null;

    const supabase = getServiceClient();

    // 1. Resolve student ID if matric_no provided
    if (!studentId && matricNo) {
      const cleanMatric = normalizeMatric(matricNo);
      const { data: student, error: studentErr } = await supabase
        .from('students_master')
        .select('id, matric_no')
        .eq('matric_no', cleanMatric)
        .maybeSingle();

      if (studentErr || !student) {
        return jsonResponse(
          {
            success: false,
            allowed: false,
            status: 404,
            error: 'STUDENT_NOT_FOUND',
            reason: 'Matric number not found in student database.',
            action: 'CONTACT_ADMIN',
            reference_code: 'BIND-404-NOTFOUND',
          },
          404,
          {},
          req
        );
      }
      studentId = student.id;
    }

    if (!studentId) {
      return jsonResponse(
        {
          success: false,
          allowed: false,
          status: 400,
          error: 'BAD_REQUEST',
          reason: 'student_id or valid matric_no is required.',
          action: 'CONTACT_ADMIN',
          reference_code: 'BIND-400-PARAMS',
        },
        400,
        {},
        req
      );
    }

    // 2. Hash device fingerprint (never store raw)
    let fingerprintHash = providedFingerprintHash;
    if (!fingerprintHash) {
      if (!rawFingerprint || !rawFingerprint.trim()) {
        return jsonResponse(
          {
            success: false,
            allowed: false,
            status: 400,
            error: 'FINGERPRINT_REQUIRED',
            reason: 'Device fingerprint could not be computed. Please reload or contact admin.',
            action: 'CONTACT_ADMIN',
            reference_code: 'BIND-400-NOFP',
          },
          400,
          {},
          req
        );
      }
      fingerprintHash = await hashFingerprint(rawFingerprint);
    }

    // 3. Extract and verify trusted-device cookie token
    const cookies = parseCookies(req.headers.get('cookie'));
    const cookieToken =
      cookies['adun_trusted_device'] ||
      req.headers.get('x-trusted-device-token') ||
      body?.trusted_device_token ||
      null;

    let cookieTokenHash: string | null = null;
    if (cookieToken) {
      const verification = await verifySignedCookieToken(cookieToken);
      if (verification.valid && verification.studentId === studentId) {
        cookieTokenHash = await sha256Hex(cookieToken);
      }
    }

    // 4. Execute atomic device check RPC
    const { data, error } = await supabase.rpc('rpc_device_check', {
      p_student_id: studentId,
      p_fingerprint_hash: fingerprintHash,
      p_cookie_token_hash: cookieTokenHash,
      p_local_device_id: localDeviceId,
      p_incognito_signal: incognitoSignal,
      p_user_agent: userAgent,
      p_ip: clientIp,
    });

    if (error) {
      console.error('RPC Error in rpc_device_check:', error);
      return errorResponse('DATABASE_ERROR', error.message, 500, {}, req);
    }

    const checkResult = data as Record<string, unknown>;

    // 5. Action: BOUND (First ever sign-in or after admin reset)
    if (checkResult.action === 'BOUND' && checkResult.binding_id) {
      const bindingId = checkResult.binding_id as string;
      const newSignedCookie = await createSignedCookieToken(studentId);
      const newCookieHash = await sha256Hex(newSignedCookie);

      // Persist the trusted cookie hash on the binding record
      await supabase
        .from('device_bindings')
        .update({ trusted_cookie_hash: newCookieHash })
        .eq('id', bindingId);

      const cookieHeader = createDeviceCookieHeader(newSignedCookie);

      return jsonResponse(
        {
          success: true,
          allowed: true,
          action: 'BOUND',
          status: 200,
          binding_id: bindingId,
          reference_code: checkResult.reference_code,
          is_new_binding: true,
          trusted_device_token: newSignedCookie,
          fingerprint_hash: fingerprintHash,
        },
        200,
        { 'Set-Cookie': cookieHeader },
        req
      );
    }

    // 6. Action: OK (Normal matching device)
    if (checkResult.action === 'OK' && checkResult.allowed) {
      return jsonResponse(
        {
          success: true,
          allowed: true,
          action: 'OK',
          status: 200,
          binding_id: checkResult.binding_id,
          reference_code: checkResult.reference_code,
          is_shared: checkResult.is_shared,
          fingerprint_hash: fingerprintHash,
        },
        200,
        {},
        req
      );
    }

    // 7. Action: Block (CONTACT_ADMIN or OPEN_NORMAL_BROWSER)
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
        status: httpStatus,
      },
      httpStatus,
      {},
      req
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error in device-check';
    return errorResponse('INTERNAL_SERVER_ERROR', message, 500, {}, req);
  }
});
