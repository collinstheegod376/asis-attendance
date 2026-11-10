/**
 * Edge Function: validate-session-token
 * Fixes: SEC-22
 *
 * Validates session raw token from QR/link, enforces per-IP rate limiting (60/min),
 * accepts X-Attempt-Token to reuse valid unexpired attempts, and prevents unbounded
 * duplicate attempts generation on page reloads (SEC-22).
 */
import { getCorsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/supabaseClient.ts';

declare const Deno: any;

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
    const clientIp =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      req.headers.get('cf-connecting-ip') ??
      req.headers.get('x-real-ip') ??
      '127.0.0.1';

    const supabase = getServiceClient();

    // 1. Rate limit check per IP (60 requests per minute)
    const { data: rateAllowed } = await supabase.rpc('fn_rate_limit', {
      p_key: `validate_token:${clientIp}`,
      p_limit: 60,
      p_window_seconds: 60,
    });

    if (rateAllowed === false) {
      return new Response(JSON.stringify({
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded: maximum 60 requests per minute per IP.',
      }), {
        status: 429,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const token = body?.token || body?.session_token;
    const existingAttemptToken = req.headers.get('x-attempt-token') || body?.attempt_token || null;

    if (!token || typeof token !== 'string') {
      return new Response(JSON.stringify({
        error: 'INVALID_TOKEN',
        message: 'Session token is required.',
      }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Call atomic transactional RPC with attempt reuse capability
    const { data: result, error: rpcErr } = await supabase.rpc('rpc_validate_session_token', {
      p_raw_token: token.trim(),
      p_existing_attempt_token: existingAttemptToken,
    });

    if (rpcErr || !result) {
      console.error('RPC Error in validate-session-token:', rpcErr);
      return new Response(JSON.stringify({
        error: 'DATABASE_ERROR',
        message: rpcErr?.message || 'Database error occurred during token validation.',
      }), {
        status: 500,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!result.success) {
      const errCode = (result.error as string) || 'VALIDATION_FAILED';
      const status =
        errCode === 'SESSION_EXPIRED'
          ? 410
          : errCode === 'SESSION_NOT_STARTED'
          ? 425
          : errCode === 'SESSION_CLOSED'
          ? 403
          : 400;

      return new Response(JSON.stringify({
        error: errCode,
        message: result.message,
      }), {
        status,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Success: return exact contract shape for Agent 2
    return new Response(JSON.stringify({
      attempt_id: result.attempt_id,
      attempt_token: result.attempt_token,
      session_id: result.session_id,
      course_id: result.course_id,
      expires_at: result.expires_at,
      step: result.step,
      student_id: result.student_id ?? null,
      location_enabled: Boolean(result.location_enabled),
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
