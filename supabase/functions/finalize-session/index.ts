/**
 * Edge Function: finalize-session
 *
 * Finalizes all attendance attempts for a lecture session.
 * Authenticates caller via Supabase Auth JWT, verifies active lecturer (owning
 * the session's course) or admin role, and calls rpc_finalize_session_attempts.
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

    // 4. Finalize session attempts via RPC
    const { data: result, error: rpcErr } = await supabase.rpc('rpc_finalize_session_attempts', {
      p_session_id: sessionId.trim(),
    });

    if (rpcErr || !result) {
      console.error('RPC Error in finalize-session:', rpcErr);
      return new Response(
        JSON.stringify({
          error: 'DATABASE_ERROR',
          message: rpcErr?.message || 'Database error occurred while finalizing session.',
        }),
        {
          status: 500,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (result.success === false || result.ok === false || result.error) {
      const errCode = (result.error as string) || 'FINALIZE_FAILED';
      const status =
        errCode === 'SESSION_NOT_FOUND'
          ? 404
          : errCode === 'FORBIDDEN' || errCode === 'SESSION_CLOSED'
          ? 403
          : 400;

      return new Response(
        JSON.stringify({
          error: errCode,
          message: result.message || 'Unable to finalize session attempts.',
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
        finalized_count: result.finalized_count ?? 0,
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
