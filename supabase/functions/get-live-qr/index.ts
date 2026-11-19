/**
 * Edge Function: get-live-qr
 *
 * Returns a rotating live QR bucket and signature for an active lecture session.
 * Authenticates caller via Supabase Auth JWT, verifies active lecturer/admin role
 * and course ownership, enforces per-session rate limiting, and delegates to rpc_get_live_qr.
 */
import { getCorsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/supabaseClient.ts';
import {
  authenticateStaffCaller,
  isValidUuid,
  verifySessionOwnership,
} from '../_shared/auth.ts';

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
    const supabase = getServiceClient();

    // 1. Authenticate caller via Supabase Auth JWT and verify active lecturer/admin role
    const authResult = await authenticateStaffCaller(req, supabase, baseHeaders);
    if (authResult.errorResponse) return authResult.errorResponse;
    const staffUser = authResult.user;

    // 2. Parse and validate session_id
    const body = await req.json().catch(() => ({}));
    const sessionId = body?.session_id;

    if (!isValidUuid(sessionId)) {
      return new Response(
        JSON.stringify({
          error: 'BAD_REQUEST',
          message: 'Valid session_id UUID is required.',
        }),
        {
          status: 400,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // 3. Verify course ownership if caller is a lecturer
    const ownershipResult = await verifySessionOwnership(
      supabase,
      sessionId.trim(),
      staffUser,
      baseHeaders
    );
    if (ownershipResult.errorResponse) return ownershipResult.errorResponse;

    // 4. Rate limit check (2 requests per 45 seconds per session)
    const { data: rateAllowed } = await supabase.rpc('rpc_check_rate_limit', {
      p_key: `get_live_qr:${sessionId.trim()}`,
      p_limit: 2,
      p_window_seconds: 45,
    });

    if (
      rateAllowed === false ||
      (typeof rateAllowed === 'object' && rateAllowed !== null && rateAllowed.allowed === false)
    ) {
      return new Response(
        JSON.stringify({
          error: 'RATE_LIMITED',
          message: 'Rate limit exceeded for live QR generation.',
        }),
        {
          status: 429,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // 5. Fetch live QR payload via RPC
    const { data: result, error: rpcErr } = await supabase.rpc('rpc_get_live_qr', {
      p_session_id: sessionId.trim(),
    });

    if (rpcErr || !result) {
      console.error('RPC Error in get-live-qr:', rpcErr);
      return new Response(
        JSON.stringify({
          error: 'DATABASE_ERROR',
          message: rpcErr?.message || 'Database error occurred while generating live QR.',
        }),
        {
          status: 500,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (result.success === false || result.ok === false || result.error) {
      const errCode = (result.error as string) || 'LIVE_QR_FAILED';
      const status =
        errCode === 'SESSION_NOT_FOUND'
          ? 404
          : errCode === 'SESSION_ENDED' || errCode === 'SESSION_EXPIRED'
          ? 410
          : errCode === 'SESSION_CLOSED' || errCode === 'FORBIDDEN'
          ? 403
          : 400;

      return new Response(
        JSON.stringify({
          error: errCode,
          message: result.message || 'Unable to generate live QR.',
        }),
        {
          status,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        bucket: result.bucket,
        signature: result.signature,
        expires_at: result.expires_at,
        test_mode: Boolean(result.test_mode),
      }),
      {
        status: 200,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown internal error';
    return new Response(JSON.stringify({ error: 'INTERNAL_SERVER_ERROR', message }), {
      status: 500,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }
});
