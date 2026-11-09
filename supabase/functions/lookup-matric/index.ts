/**
 * Edge Function: lookup-matric
 * Fixes: SEC-12, SEC-18, SEC-19, C2
 *
 * Validates check-in attempt session, normalizes matriculation number,
 * enforces per-IP rate limiting (30/min), returns generic NOT_ELIGIBLE 404
 * to prevent student roster enumeration (SEC-18), and implements C2 attempt identity locking.
 */
import { getCorsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/supabaseClient.ts';
import { normalizeMatric } from '../_shared/crypto.ts';

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

    // 1. Rate limit check before querying student database (30/min per IP, SEC-18)
    const { data: rateAllowed } = await supabase.rpc('fn_rate_limit', {
      p_key: `lookup_matric:${clientIp}`,
      p_limit: 30,
      p_window_seconds: 60,
    });

    if (rateAllowed === false) {
      return new Response(JSON.stringify({
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many lookup requests. Please slow down and try again in 60 seconds.',
      }), {
        status: 429,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const attemptToken = body?.attempt_token || req.headers.get('x-attempt-token');
    const attemptId = body?.attempt_id || null;
    const matricNo = body?.matric_no || body?.matric;
    const deviceId = body?.device_id || null;

    if (!attemptToken || typeof attemptToken !== 'string') {
      return new Response(JSON.stringify({ error: 'INVALID_ATTEMPT_TOKEN' }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!matricNo || typeof matricNo !== 'string') {
      return new Response(JSON.stringify({ error: 'MATRIC_REQUIRED' }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cleanMatric = normalizeMatric(matricNo);

    // 2. Atomic lookup RPC with C2 locking semantics
    const { data: result, error: rpcErr } = await supabase.rpc('rpc_lookup_matric', {
      p_attempt_id: attemptId,
      p_attempt_token: attemptToken,
      p_raw_matric: cleanMatric,
      p_device_id: deviceId,
    });

    if (rpcErr || !result) {
      console.error('RPC Error in lookup-matric:', rpcErr);
      return new Response(JSON.stringify({ error: 'DATABASE_ERROR' }), {
        status: 500,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. SEC-18: Generic NOT_ELIGIBLE error for both student not found and not enrolled
    if (!result.success) {
      const errCode = (result.error as string) || 'LOOKUP_FAILED';

      if (errCode === 'NOT_ELIGIBLE' || errCode === 'STUDENT_NOT_FOUND' || errCode === 'NOT_ON_ROSTER') {
        return new Response(JSON.stringify({
          error: 'NOT_ELIGIBLE',
        }), {
          status: 404,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (errCode === 'STUDENT_LOCKED') {
        return new Response(JSON.stringify({
          error: 'STUDENT_LOCKED',
        }), {
          status: 409,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (errCode === 'ALREADY_SIGNED') {
        return new Response(JSON.stringify({
          error: 'ALREADY_SIGNED',
        }), {
          status: 409,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        error: errCode,
      }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Success: Contract matching Agent 2 specification
    return new Response(JSON.stringify({
      student_id: result.student_id,
      full_name: result.full_name,
      program: result.program,
      level: result.level,
      matric_no: result.matric_no,
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
